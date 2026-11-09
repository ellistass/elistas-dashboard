// lib/swing/trades.ts — server side of the Trades page: settings, the evening
// refresh, and the action lines each open trade needs tonight.
//
// You enter the real fills once. Everything else — best price since entry, R
// now, +1R touched, the trailing stop, stop/cap hits, days held — is worked out
// from completed daily bars of the trade's feed. Calculations always use YOUR
// order lines (entryPrice / initialStop / currentStop), never the card's.

import { db } from "@/lib/db";
import {
  DEFAULT_ACCOUNTS, MAX_HOLD, addDays, fmtPx, levelMismatch, specClass, specFor, trackTrade,
  type InstrumentSpecCfg, type StopMove, type SwingAccountCfg, type Side, type Tracked,
} from "./core";
import { fetchFeedBars } from "./feeds";
import { INDEX_TRAIL_ATR } from "./vol";
import { logBreak } from "./discipline";
import { instrumentInfo } from "@/lib/wyckoff/basket";

const T = () => (db as any).swingTrade;

export async function loadAccounts(): Promise<SwingAccountCfg[]> {
  let rows: any[] = [];
  try { rows = await (db as any).swingAccount.findMany(); } catch { /* table missing → defaults */ }
  return DEFAULT_ACCOUNTS.map((d) => {
    const r = rows.find((x) => x.key === d.key);
    return r ? { ...d, name: r.name, balance: r.balance, riskPerTrade: r.riskPerTrade, monthlyStop: r.monthlyStop,
      monthlyTarget: r.monthlyTarget, gradesAllowed: r.gradesAllowed, maxSlots: r.maxSlots } : d;
  });
}

export async function loadSpecs(): Promise<InstrumentSpecCfg[]> {
  try { return await (db as any).instrumentSpec.findMany(); } catch { return []; }
}

export interface Action { tradeId: string; instrument: string; kind: "stop-hit" | "cap-hit" | "move-stop" | "time-exit" | "event-exit" | "mismatch" | "pending" | "filled" | "scale-in"; text: string; urgent: boolean }

/** Does the feed carry the CARD's prices (the future / stock the card was drawn on)? Indices
 *  are tracked on the cash index and commodities on the future, so a pending order is checked
 *  in whichever series its level belongs to. */
const feedIsCardSeries = (t: any) => !!t.cardEntry && t.feed === `yahoo:${instrumentInfo(t.instrument)?.yahoo ?? ""}`;

/**
 * A pending order against the bars after it was placed. Returns the update, or null (still waiting).
 *   next-open (springs): fills at the first open after the card's bar; skipped if it opens past the stop.
 *   limit: fills on the first bar that trades through it within `pendingBars`. Range retests
 *          (futures/stocks) are cancelled on a gap through the edge (the card's cancelIf); forex
 *          limits fill at the open on a gap. Not filled in time → expired.
 */
export function settlePending(t: any, bars: { date: string; o: number; h: number; l: number; c: number }[]): Record<string, unknown> | null {
  if (t.status !== "pending" || !t.orderPlacedDate) return null;
  const long = t.side === "long";
  const card = feedIsCardSeries(t) && !t.samePrices;
  const lvl = card ? t.cardEntry : t.entryPrice;
  const stopLvl = card && t.cardStop != null ? t.cardStop : t.initialStop;
  const after = bars.filter((b) => b.date > t.orderPlacedDate);
  const fill = (date: string, price: number) => ({ status: "open", entryDate: date, entryPrice: price, cancelReason: null });
  const cancel = (date: string, why: string) => ({ status: "cancelled", cancelReason: why, exitDate: date, exitReason: "cancelled" });

  if (t.cardEntryKind === "open") {
    const b = after[0];
    if (!b) return null;
    if (long ? b.o <= stopLvl : b.o >= stopLvl) return cancel(b.date, `opened past the stop on ${b.date} — the card says skip`);
    return fill(b.date, card ? t.entryPrice : b.o);           // your prices = the feed's: the open; else keep yours (edit to your broker's fill)
  }
  const n = t.pendingBars ?? 5;
  for (const b of after.slice(0, n)) {
    const touched = long ? b.l <= lvl : b.h >= lvl;
    if (!touched) continue;
    const gap = long ? b.o < lvl : b.o > lvl;
    if (gap && t.market === "futures") return cancel(b.date, `opened through the limit on ${b.date} — the card says cancel`);
    return fill(b.date, gap && !card ? b.o : t.entryPrice);
  }
  if (after.length >= n) return cancel(after[n - 1].date, `limit not filled in ${n} bar${n === 1 ? "" : "s"} — expired`);
  return null;
}

/** What this trade needs from you tonight, in plain words. */
export function actionsFor(t: any, _i?: number, all?: any[]): Action[] {
  const base = { tradeId: t.id, instrument: t.instrument };
  if (t.status === "pending") {
    const what = t.cardEntryKind === "open" ? `market at the next open (ref ${fmtPx(t.entryPrice)})` : `limit ${fmtPx(t.entryPrice)}, live ${t.pendingBars ?? 5} bars from ${t.orderPlacedDate}`;
    return [{ ...base, kind: "pending", urgent: false, text: `${t.instrument}: order waiting — ${what}. Not a trade until it fills.` }];
  }
  if (t.status !== "open") return [];
  const out: Action[] = [];
  if (t.orderPlacedDate && t.lastDate === t.entryDate)
    out.push({ ...base, kind: "filled", urgent: true, text: `${t.instrument}: your order filled on ${t.entryDate} at ${fmtPx(t.entryPrice)} — check the stop ${fmtPx(t.currentStop)} is on${t.samePrices ? "" : ", and enter your broker's fill price if it differs"}` });
  const R = Math.abs(t.entryPrice - t.initialStop);
  if (t.stopHitDate) out.push({ ...base, kind: "stop-hit", urgent: true, text: `${t.instrument}: stop ${fmtPx(t.stopHitPrice ?? t.currentStop)} traded on ${t.stopHitDate} — record the exit` });
  else if (t.capHitDate) out.push({ ...base, kind: "cap-hit", urgent: true, text: `${t.instrument}: cap ${fmtPx(t.capPrice)} reached on ${t.capHitDate} — record the exit` });
  else {
    if (t.suggestedStop != null && Math.abs(t.suggestedStop - t.currentStop) > R * 0.01) {
      const toBe = Math.abs(t.suggestedStop - t.entryPrice) <= R * 0.01;
      out.push({ ...base, kind: "move-stop", urgent: true, text: toBe
        ? `${t.instrument}: +1R touched, stop to breakeven ${fmtPx(t.suggestedStop)}`
        : `${t.instrument}: new ${t.side === "long" ? "high" : "low"}, move stop to ${fmtPx(t.suggestedStop)}` });
    }
    // Planned event exit: show from 5 days out until it's done.
    if (t.plannedExitDate && t.lastDate && t.lastDate <= t.plannedExitDate && t.lastDate >= addDays(t.plannedExitDate, -5))
      out.push({ ...base, kind: "event-exit", urgent: true, text: `${t.instrument}: exit before ${t.plannedExitDate}'s close (event after it)` });
    if ((t.daysHeld ?? 0) >= MAX_HOLD) out.push({ ...base, kind: "time-exit", urgent: true, text: `${t.instrument}: ${t.daysHeld} bars held — time exit at the close` });
  }
  // Forex scale-in (Nov 2026 test): +1R touched and yields supporting → add a 2nd position, half size.
  if (t.market === "forex" && !t.parentTradeId && t.scaleIn === "supporting" && t.touched1R && !t.stopHitDate
      && !(all ?? []).some((x: any) => x.parentTradeId === t.id)) {
    const add = t.entryPrice + (t.side === "long" ? R : -R);
    out.push({ ...base, kind: "scale-in", urgent: false,
      text: `${t.instrument}: +1R reached and yields support — scale in: 2nd position, half size, near ${fmtPx(add)}, stop ${fmtPx(t.entryPrice)} (1R behind the add)` });
  }
  const mm = mismatch(t);
  if (mm) out.push({ ...base, kind: "mismatch", urgent: false, text: `${t.instrument}: ${mm}` });
  return out;
}

/** The fill doesn't match the card (same rule the gate uses). */
export const mismatch = (t: any) =>
  levelMismatch({ entryPrice: t.entryPrice, initialStop: t.initialStop, cardEntry: t.cardEntry, cardStop: t.cardStop,
    cardEntryKind: t.cardEntryKind, samePrices: !!t.samePrices });

export const trackInput = (t: any) => ({
  side: t.side as Side, entryDate: t.entryDate, entryPrice: t.entryPrice, initialStop: t.initialStop,
  currentStop: t.currentStop, capPrice: t.capPrice, brokerBest: t.brokerBest, stopMoves: (t.stopMoves ?? []) as StopMove[],
  // Index RETESTS trail 2×ATR; springs/upthrusts (market at the open) trail 1R.
  trailAtr: specClass(t.instrument) === "index" && t.cardEntryKind !== "open" ? INDEX_TRAIL_ATR : null,
});

const trackedFields = (k: Tracked) => ({
  lastDate: k.lastDate, lastClose: k.lastClose, bestPrice: k.bestPrice, bestDate: k.bestDate, rNow: k.rNow,
  peakR: k.peakR, touched1R: k.touched1R, suggestedStop: k.suggestedStop, stopHitDate: k.stopHitDate,
  stopHitPrice: k.stopHitPrice, capHitDate: k.capHitDate, daysHeld: k.daysHeld,
});

/** Candles for the trade card: ~20 bars before entry through the last bar (max 90). */
function chartBars(bars: { date: string; o: number; h: number; l: number; c: number }[], entryDate: string) {
  const i = bars.findIndex((b) => b.date >= entryDate);
  const from = Math.max(0, (i < 0 ? bars.length : i) - 20, bars.length - 90);
  return bars.slice(from).map((b) => [b.date, b.o, b.h, b.l, b.c]);
}

/** Recompute every open trade from its feed. One fetch per feed; a bad feed only fails its own trades. */
export async function refreshOpenTrades(): Promise<{ refreshed: number; errors: { id: string; error: string }[] }> {
  // Pending orders first: a fill turns them into open trades, tracked below in the same run.
  const pending = await T().findMany({ where: { status: "pending" } });
  for (const t of pending) {
    try {
      const upd = settlePending(t, await fetchFeedBars(t.feed));
      if (upd) await T().update({ where: { id: t.id }, data: { ...upd, trackError: null, trackedAt: new Date() } });
    } catch (e) {
      await T().update({ where: { id: t.id }, data: { trackError: e instanceof Error ? e.message : String(e), trackedAt: new Date() } });
    }
  }
  const open = await T().findMany({ where: { status: "open" } });
  const byFeed = new Map<string, any[]>();
  for (const t of open) byFeed.set(t.feed, [...(byFeed.get(t.feed) ?? []), t]);
  const errors: { id: string; error: string }[] = [];
  let refreshed = 0;
  for (const [feed, trades] of byFeed) {
    let bars;
    try { bars = await fetchFeedBars(feed); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const t of trades) { errors.push({ id: t.id, error: msg }); await T().update({ where: { id: t.id }, data: { trackError: msg, trackedAt: new Date() } }); }
      continue;
    }
    for (const t of trades) {
      const k = trackTrade(trackInput(t), bars);
      await T().update({ where: { id: t.id }, data: { ...trackedFields(k), recentBars: chartBars(bars, t.entryDate), trackError: null, trackedAt: new Date(), ...(await eveningChecks(t, k)) } });
      refreshed++;
    }
  }
  return { refreshed, errors };
}

/**
 * The rules the evening can see being broken, logged once each:
 *   Management — the rule stop moved but yours didn't by the next evening
 *   Exits      — a planned event exit date passed with the trade still open
 * Keyed on bar dates, so running it again the same day (the page's refresh) logs nothing twice.
 */
async function eveningChecks(t: any, k: Tracked): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const R = Math.abs(t.entryPrice - t.initialStop);
  const due = !k.stopHitDate && !k.capHitDate && Math.abs(k.suggestedStop - t.currentStop) > R * 0.01;
  if (!due) out.moveDueSince = null;
  else if (!t.moveDueSince) out.moveDueSince = k.lastDate;
  else if (k.lastDate && k.lastDate > t.moveDueSince && t.moveMissLoggedFor !== t.moveDueSince) {
    await logBreak({ date: k.lastDate, instrument: t.instrument, rule: "Management", tradeId: t.id, auto: true,
      detail: `stop not moved to the rule stop on the evening of ${t.moveDueSince} (still ${fmtPx(t.currentStop)}, rule ${fmtPx(k.suggestedStop)})` });
    out.moveMissLoggedFor = t.moveDueSince;
  }
  if (t.plannedExitDate && !t.exitMissLogged && k.lastDate && k.lastDate > t.plannedExitDate) {
    await logBreak({ date: k.lastDate, instrument: t.instrument, rule: "Exits", tradeId: t.id, auto: true,
      detail: `planned exit before ${t.plannedExitDate}'s close (event) not taken` });
    out.exitMissLogged = true;
  }
  return out;
}

/** Recompute one trade (after you edit it). */
export async function refreshTrade(id: string) {
  let t = await T().findUnique({ where: { id } });
  if (t?.status === "pending") {
    try {
      const upd = settlePending(t, await fetchFeedBars(t.feed));
      t = await T().update({ where: { id }, data: { ...(upd ?? {}), trackError: null, trackedAt: new Date() } });
    } catch (e) {
      return await T().update({ where: { id }, data: { trackError: e instanceof Error ? e.message : String(e), trackedAt: new Date() } });
    }
  }
  if (!t || t.status !== "open") return t;
  try {
    const bars = await fetchFeedBars(t.feed);
    const k = trackTrade(trackInput(t), bars);
    return await T().update({ where: { id }, data: { ...trackedFields(k), recentBars: chartBars(bars, t.entryDate), trackError: null, trackedAt: new Date() } });
  } catch (e) {
    return await T().update({ where: { id }, data: { trackError: e instanceof Error ? e.message : String(e), trackedAt: new Date() } });
  }
}

export { specFor };
