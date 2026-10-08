// app/api/cron/setup-alert/route.ts — the evening Telegram: what fired at tonight's close.
//
// Schedule (vercel.json): 21:45 and 22:45 UTC Mon–Fri. The first run that lands at
// or after 17:30 New York sends; a marker row (SetupScanCache key "setup-alert")
// stops the second one repeating it. Whatever US daylight saving is doing, one
// goes out: ~22:45 Lagos in US summer, ~23:45 in winter. That's after the 17:15 NY
// futures cutoff and the 17:30 NY forex cutoff, and ~15 min before the 18:00 NY
// futures reopen — the fill for an aggressive (spring/upthrust) entry.
//
// Uses the same stored scans as the page, forced fresh, so what you're sent is what
// /setups shows. A quiet night still sends "none" so you know the job ran.
//
// Manual trigger: GET /api/cron/setup-alert?force=1 with the CRON_SECRET bearer.

export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { scanSetups, lastClosedSession, type InstrumentSetup } from "@/lib/setups/scan";
import { scanForexDrivers, type DriverSetup } from "@/lib/setups/forexDriver";
import { cachedScan } from "@/lib/setups/scanCache";
import { sendTelegramMessage } from "@/lib/telegram";
import { db } from "@/lib/db";

const MARK = "setup-alert";
const marker = () => (db as any).setupScanCache;
async function alreadySent(session: string): Promise<boolean> {
  try { return (await marker().findUnique({ where: { key: MARK } }))?.payload?.session === session; }
  catch { return false; }          // DB down: better a duplicate than no alert
}
async function markSent(session: string) {
  const row = { payload: { session }, computedAt: new Date() };
  try { await marker().upsert({ where: { key: MARK }, create: { key: MARK, ...row }, update: row }); } catch { /* best-effort */ }
}

const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nyMinutes = (d: Date) => { const [h, m] = nyClock.format(d).split(":").map(Number); return h * 60 + m; };

const px = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 20 ? x.toFixed(3) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toFixed(5));
const dir = (long: boolean) => (long ? "BUY" : "SELL");

function futuresLine(s: InstrumentSetup): string {
  const long = s.side === "long";
  const exec = s.inverted && s.executeSymbol ? ` → trade ${s.executeSymbol} ${dir(!long)}` : "";
  const how = s.entry === "aggressive" ? `${long ? "spring" : "upthrust"} · entry next open (ref ${px(s.entryPrice)})` : `break · limit ${px(s.entryPrice)}`;
  return `*${s.instrument}* ${dir(long)}${exec} · ${s.entry} · grade ${s.grade}` +
    `\n  ${how} · stop ${px(s.stop)} · +1R ${px(s.breakevenAt)} · cap ${px(s.target)}` +
    (s.volumeUnverified ? "\n  ⚠ volume unverified — check the live contract" : "") +
    (s.grade === "B" ? "\n  B-grade: half size" : "");
}

function forexLine(s: DriverSetup): string {
  return `*${s.pair}* ${dir(s.side === "long")} · forex · grade ${s.grade}` +
    `\n  limit ${px(s.order.entry)} · stop ${px(s.order.stopLoss)} · +1R ${px(s.order.breakEven)} · good ${s.order.goodForBars} bars`;
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const force = new URL(req.url).searchParams.get("force") === "1";
  const mins = nyMinutes(now);
  if (!force && mins < 17 * 60 + 30) {
    return NextResponse.json({ skipped: `NY ${nyClock.format(now)} — before 17:30, the later run sends tonight` });
  }
  const session = lastClosedSession(now);
  if (!force && await alreadySent(session)) return NextResponse.json({ skipped: `already sent for ${session}` });

  const errors: string[] = [];
  let fut: InstrumentSetup[] = [];
  let fx: DriverSetup[] = [];
  try { fut = (await cachedScan("futures", () => scanSetups(true), true)).setups; }
  catch (e) { errors.push(`futures/stocks scan failed: ${e instanceof Error ? e.message : String(e)}`); }
  try { fx = (await cachedScan("forex", () => scanForexDrivers(true), true)).setups; }
  catch (e) { errors.push(`forex scan failed: ${e instanceof Error ? e.message : String(e)}`); }

  // New tonight = fired on the session that just closed. Stale (feed gap) never goes out as new.
  const newFut = fut.filter((s) => s.signalDate === session && s.state !== "filled" && !s.feedGap);
  const newFx = fx.filter((s) => !s.skip && s.state === "armed" && s.barsSinceBreak === 0);
  // Still waiting = limit orders from earlier breaks that are still good.
  const waitFut = fut.filter((s) => s.entry === "conservative" && s.state === "armed" && s.signalDate !== session);
  const waitFx = fx.filter((s) => !s.skip && s.state === "armed" && (s.barsSinceBreak ?? 0) > 0);

  const parts: string[] = [`*Setups tonight* · ${session}`];
  const fresh = [...newFut.map(futuresLine), ...newFx.map(forexLine)];
  parts.push(fresh.length ? fresh.join("\n\n") : "_No new setups at this close._");
  if (newFut.some((s) => s.entry === "aggressive")) parts.push("Futures reopen 18:00 New York — place next-open orders now.");
  const waiting = [
    ...waitFut.map((s) => `${s.instrument} ${dir(s.side === "long")} limit ${px(s.entryPrice)}${s.barsLeft != null ? ` (${s.barsLeft} bars left)` : ""}`),
    ...waitFx.map((s) => `${s.pair} ${dir(s.side === "long")} limit ${px(s.order.entry)} (${s.order.goodForBars} bars left)`),
  ];
  if (waiting.length) parts.push(`*Limits still working*\n${waiting.join("\n")}`);
  const stale = fut.filter((s) => s.feedGap);
  if (stale.length) parts.push(`⚠ Yahoo missing a bar (${[...new Set(stale.map((s) => s.feedGap))].join(", ")}): ${stale.map((s) => s.instrument).join(", ")} — check before acting.`);
  if (errors.length) parts.push(`⚠ ${errors.join(" · ")}`);

  const sent = await sendTelegramMessage(parts.join("\n\n"));
  if (sent && !force) await markSent(session);
  return NextResponse.json({ sent, session, new: fresh.length, waiting: waiting.length, stale: stale.length, errors });
}
