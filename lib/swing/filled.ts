// lib/swing/filled.ts — every setup the system made, played out under the card's rules, live,
// and run through the account rules (lib/swing/rulesSim.ts).
//
// A setup leaves /setups the bar after it fills ("it's a trade now, not a setup").
// This replays the last LOOKBACK_DAYS of logged setups against today's completed
// bars — the same simulate() the Journal runs nightly, run live here — plus the trend
// and crypto slots (55-day breakouts, replayed from the bars: they aren't logged).
// Then:
//   · event exit — an event (earnings, central bank, delivery; Discipline page → Event
//     dates) inside the hold exits at the close of the day before, as the gate plans it
//   · rules — every account's rules pass: which fills it takes, which it skips and why
// and sorts them: open, won, lost, breakeven, never filled. Charts are fetched one at a time.

import { db } from "@/lib/db";
import { instrumentInfo, BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import { completedBars } from "@/lib/setups/scan";
import { trendHistory, cryptoDone, TREND_MARKETS, CRYPTO_MARKETS, type TrendSetup } from "@/lib/setups/trend";
import { addDays, todayUtc, type DayBar } from "./core";
import { barsFor, simInputFor } from "./outcomes";
import { simulate, type SimInput, type SimResult } from "./simulate";
import { applyRules, type RuleCall, type RuleCand, type RuleSlot } from "./rulesSim";
import { loadAccounts, loadSpecs } from "./trades";
import { symbolsFor } from "./events";
import { specClass } from "./core";
import { ETF } from "@/lib/data/eps";
import { stockLayers, indexLayers, commodityLayers } from "@/lib/setups/layers";
import { fetchRealYield, fetchYields, yieldRead, type YieldSeries } from "@/lib/data/yields";
import { breadthSeries, marketReadAt, type MarketRead } from "@/lib/setups/market";

const LOOKBACK_DAYS = 150;   // simulate caps a hold at 60 bars ≈ 85 calendar days
/** The rules start from an empty account at the window start, so the first weeks can take
 *  more than was really possible. Rows filled before this many days in are flagged. */
export const WARMUP_DAYS = 30;
const TREND_STOP_ATR = 2, TREND_TRAIL_ATR = 3, TREND_MAX_HOLD = 400;   // trend.ts rules; no time exit

export type FilledStatus = "open" | "win" | "loss" | "be" | "expired";

export interface FilledRow {
  id: string; market: string; instrument: string; executeSymbol: string; inverted: boolean;
  side: string; entry: string; grade: string; status: FilledStatus;
  /** Slot the trade uses and its risk weight (trend/crypto = ½ risk). */
  slot: RuleSlot | null; weight: number;
  rangeLo: number; rangeHi: number; rangeStart: string; signalDate: string | null; firstBarDate: string;
  entryPrice: number; origStop: number; breakevenAt: number; target: number | null;
  fillDate: string | null; fillPrice: number | null;
  /** Stop for the next session; stopPrev = what it was before the last close. null = n/a. */
  stopNow: number | null; stopPrev: number | null; stopMoved: boolean; newFill: boolean;
  /** R the current stop locks in: −1 = full risk, 0 = breakeven, >0 = profit locked. */
  lockedR: number | null;
  lastDate: string | null; lastClose: number | null;
  openR: number | null; peakR: number | null; barsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: string | null; resultR: number | null;
  /** Open trade with an event ahead: exit at this day's close (the day before the event). */
  plannedExit: { date: string; event: string } | null;
  /** The account rules' call, per account key. null = never filled / paper. */
  rules: Record<string, RuleCall> | null;
  warmup: boolean;
  taken: { account: string; status: string } | null;
  /** Inside the tested edge (Nov 2026: grade A + every layer rule) — what /setups now shows. */
  edge: boolean;
}

export interface RealTrade {
  id: string; account: string; instrument: string; executeSymbol: string | null; side: string; grade: string;
  entryDate: string; exitDate: string | null; status: string; resultR: number | null; rNow: number | null; pnlUsd: number | null;
}

export interface FilledChart {
  row: FilledRow;
  /** The stop in force on each bar from the fill on (the trail, step by step). */
  stops: { date: string; stop: number }[];
}

interface Evt { date: string; symbol: string; type: string }

/** Cut a played-out trade at the close before the first event inside its hold. */
function withEventExit(sim: SimResult, input: SimInput, bars: DayBar[], events: Evt[], seriesLong: boolean) {
  if (!sim.fillDate || sim.fillPrice == null) return { sim, plannedExit: null };
  const ev = events.find((e) => e.date > sim.fillDate! && (sim.exitDate == null || e.date <= sim.exitDate));
  if (!ev) return { sim, plannedExit: null };
  const label = `${ev.type} ${ev.symbol} ${ev.date}`;
  const before = bars.filter((b) => b.date >= sim.fillDate! && b.date < ev.date);
  const cut = before.at(-1);
  const last = bars.at(-1);
  if (!cut || (last && cut.date === last.date && sim.exitDate == null)) {
    // The exit day hasn't closed yet (or is today): still open, exit planned.
    return { sim, plannedExit: { date: cut?.date ?? addDays(ev.date, -1), event: label } };
  }
  const R = Math.abs(sim.fillPrice - input.stop) || 1e-9;
  const d = seriesLong ? 1 : -1;
  const res = (d * (cut.c - sim.fillPrice)) / R;
  return {
    plannedExit: null,
    sim: {
      ...sim,
      outcome: (res > 0.05 ? "win" : res < -0.05 ? "loss" : "be") as SimResult["outcome"],
      exitDate: cut.date, exitPrice: cut.c, exitReason: `event exit (${label})` as any,
      resultR: +res.toFixed(3), stopNow: null,
      stops: (sim.stops ?? []).filter((p) => p.date <= cut.date),
    },
  };
}

interface Built { r: FilledRow; sim: SimResult; input: SimInput; bars: DayBar[]; cardSkip: string | null; seriesLong: boolean }

function build(base: Omit<FilledRow, "status" | "fillDate" | "fillPrice" | "stopNow" | "stopPrev" | "stopMoved" | "newFill" | "lockedR" |
  "lastDate" | "lastClose" | "openR" | "peakR" | "barsHeld" | "exitDate" | "exitPrice" | "exitReason" | "resultR" | "plannedExit" | "rules" | "warmup" | "origStop" | "entryPrice" | "target" | "edge">,
  input: SimInput, bars: DayBar[], events: Evt[], cardSkip: string | null): Built | null {
  const seriesLong = input.side === "long";
  const raw = simulate(input, bars);
  if (raw.outcome === "open" && !raw.fillDate) return null;               // still waiting for its fill: that's /setups
  const { sim, plannedExit } = withEventExit(raw, input, bars, events, seriesLong);
  const open = sim.outcome === "open";
  const prevRaw = open ? simulate(input, bars.slice(0, -1)) : null;      // as of the close before
  const d = seriesLong ? 1 : -1;
  const R = sim.fillPrice != null ? Math.abs(sim.fillPrice - input.stop) : 0;
  const stopNow = open ? sim.stopNow ?? null : null;
  const stopPrev = prevRaw && prevRaw.outcome === "open" && prevRaw.fillDate ? prevRaw.stopNow ?? null : null;
  const fillDate = sim.fillDate;
  return {
    sim, input, bars, cardSkip, seriesLong,
    r: {
      ...base, status: sim.outcome,
      entryPrice: input.entryPrice, origStop: input.stop, target: input.cap,
      fillDate, fillPrice: sim.fillPrice,
      stopNow, stopPrev,
      stopMoved: stopNow != null && stopPrev != null && Math.abs(stopNow - stopPrev) > 1e-9,
      newFill: open && !prevRaw?.fillDate,
      lockedR: stopNow != null && R > 0 && sim.fillPrice != null ? +((d * (stopNow - sim.fillPrice)) / R).toFixed(2) : null,
      lastDate: bars.at(-1)?.date ?? null, lastClose: bars.at(-1)?.c ?? null,
      openR: open ? sim.resultR : null, peakR: sim.peakR,
      barsHeld: fillDate ? bars.filter((b) => b.date >= fillDate && (!sim.exitDate || b.date <= sim.exitDate)).length : 0,
      exitDate: sim.exitDate, exitPrice: sim.exitPrice, exitReason: sim.exitReason, resultR: open ? null : sim.resultR,
      plannedExit, rules: null, warmup: false,
      edge: (base.grade === "A" || base.grade === "trend") && !cardSkip,
    },
  };
}

/** What the card itself says about taking it (before any account rule). */
function cardSkipFor(row: any): string | null {
  const s = row.snapshot ?? {};
  if (s.ruleSkip) return s.ruleSkip;
  if (row.market === "futures") {
    const inst = instrumentInfo(row.instrument);
    if (inst && !inst.executeSymbol) return "not on FTMO — information only";
    const heavy = (s.checks ?? []).find((c: any) => typeof c.label === "string" && c.label.startsWith("4h: first candle") && c.pass === false);
    if (heavy) return `4h heavy first drop (${heavy.value ?? "heavy"}) — limit cancelled`;
  }
  if (row.market === "forex" && row.entry !== "abcd" && s.skip) return `card skip: ${s.skip}`;
  return null;
}

/** What every logged row is re-judged with (the Nov 2026 layers), loaded once per request. */
interface LayerCtx { marketAt: ((date: string) => MarketRead | null) | null; realYield: [string, number][] | null; yields: YieldSeries | null }

async function loadLayerCtx(logs: any[]): Promise<LayerCtx> {
  const needStocks = logs.some((r) => r.market === "futures" && specClass(r.instrument) === "stock" && !ETF.has(r.instrument));
  let marketAt: LayerCtx["marketAt"] = null;
  if (needStocks) {
    try {
      const spx = completedBars(await fetchDailyBars("^GSPC", "5y"));
      const stocks = BASKET.filter((i) => specClass(i.symbol) === "stock" && !ETF.has(i.symbol));
      const all: any[][] = [];
      for (let i = 0; i < stocks.length; i += 8)   // same 5y feed as the scan → mostly cache hits
        all.push(...await Promise.all(stocks.slice(i, i + 8).map((s) => fetchDailyBars(s.yahoo, "5y").then(completedBars).catch(() => []))));
      const breadth = breadthSeries(all.filter((b) => b.length >= 200));
      marketAt = (date) => marketReadAt(spx, breadth, date);
    } catch { marketAt = null; }
  }
  const [realYield, yields] = await Promise.all([
    fetchRealYield().catch(() => null),
    logs.some((r) => r.market === "forex") ? fetchYields().catch(() => null) : Promise.resolve(null),
  ]);
  return { marketAt, realYield, yields };
}

/** The layer rule a logged setup fails, re-judged from its bars as of its signal (no look-ahead).
 *  Rows logged before the layers existed get the same rules as today's cards. */
function layerSkipFor(row: any, bars: DayBar[], ctx: LayerCtx | null): string | null {
  if (!ctx || row.entry === "abcd") return null;
  const s = row.snapshot ?? {}, sig = row.signalDate ?? row.firstBarDate;
  if (row.market === "forex") {
    if (!ctx.yields) return null;
    const B = row.instrument.slice(0, 3), Q = row.instrument.slice(3);
    const [buy, sell] = row.side === "long" ? [B, Q] : [Q, B];
    const y = yieldRead(ctx.yields, buy, sell, sig);
    return y && !y.supporting ? `yields against (10y gap ${y.change} over 3 months)` : null;
  }
  const b = bars as any[];
  const cls = specClass(row.instrument);
  if (cls === "stock" && !ETF.has(row.instrument)) {
    const m = ctx.marketAt?.(sig);
    if (m && m.state !== "healthy") return `market ${m.state} — stock setups only in a healthy market`;
    return stockLayers(b, row.side, sig, s.setupRead?.agrees ?? null, s.setupRead?.verdict ?? "n/a").skip;
  }
  if (cls === "index") return indexLayers(b, row.side, row.rangeStart, row.rangeLo, row.rangeHi, sig).skip;
  if (cls === "commodity") return commodityLayers(b, row.instrument, row.side, sig, ctx.realYield).skip;
  return null;
}

function evaluateLogged(row: any, bars: DayBar[], events: Evt[], taken: FilledRow["taken"], ctx: LayerCtx | null = null): Built | null {
  const input = simInputFor(row);
  if (!input) return null;
  const inst = row.market === "futures" ? instrumentInfo(row.instrument) : undefined;
  const paper = row.entry === "abcd";
  const layerSkip = layerSkipFor(row, bars, ctx);
  // Index / commodity B → A: a retest after a reversal break that passes the layers (same as scan.ts).
  const upCls = row.market === "futures" ? specClass(row.instrument) : null;
  const upgrade = !!ctx && (upCls === "index" || upCls === "commodity") && row.grade === "B"
    && row.entry === "conservative" && row.snapshot?.context?.daily === "reversal" && !layerSkip;
  return build({
    id: row.id, market: row.market, instrument: row.instrument,
    executeSymbol: inst?.executeSymbol || row.instrument, inverted: inst?.inverted ?? false,
    side: row.side, entry: row.entry, grade: upgrade ? "A" : row.grade,
    slot: paper ? null : "range", weight: 1,
    rangeLo: row.rangeLo, rangeHi: row.rangeHi, rangeStart: row.rangeStart, signalDate: row.signalDate, firstBarDate: row.firstBarDate,
    breakevenAt: row.breakevenAt, taken,
  }, input, bars, events, cardSkipFor(row) ?? layerSkip);
}

/** A trend/crypto breakout → a row. Stop re-measured from the next open (the card: "re-measure from your fill"). */
function evaluateTrend(t: TrendSetup, bars: DayBar[], events: Evt[], taken: FilledRow["taken"], inverted: boolean): Built | null {
  const next = bars.find((b) => b.date > t.signalDate);
  const long = t.side === "long", d = long ? 1 : -1;
  const ref = next?.o ?? t.close;
  const stop = ref - d * TREND_STOP_ATR * t.atr;
  const input: SimInput = {
    side: t.side, entryKind: "open", entryPrice: ref, stop, cap: null,
    firstBarDate: t.signalDate, goodFor: 1, maxHold: TREND_MAX_HOLD, trailAtr: TREND_TRAIL_ATR,
  };
  return build({
    id: `${t.slot}:${t.instrument}:${t.signalDate}`, market: t.slot, instrument: t.instrument,
    executeSymbol: t.executeSymbol, inverted, side: t.side, entry: "trend", grade: "trend",
    slot: t.slot, weight: 0.5,
    rangeLo: t.channelLo, rangeHi: t.channelHi, rangeStart: t.channelStart, signalDate: t.signalDate, firstBarDate: t.signalDate,
    breakevenAt: ref + d * TREND_STOP_ATR * t.atr, taken,
  }, input, bars, events, t.ruleSkip ?? null);
}

async function loadEvents(from: string): Promise<Evt[]> {
  try { return await (db as any).tradingEvent.findMany({ where: { date: { gte: from } }, orderBy: { date: "asc" } }); }
  catch { return []; }
}
const eventsOf = (all: Evt[], instrument: string) => { const syms = new Set(symbolsFor(instrument)); return all.filter((e) => syms.has(e.symbol)); };

async function realTrades(from: string): Promise<any[]> {
  try {
    return await (db as any).swingTrade.findMany({
      where: { OR: [{ entryDate: { gte: from } }, { exitDate: { gte: from } }, { status: "open" }] },
    });
  } catch { return []; }
}

/** Trend/crypto trades aren't logged: match a real trade by market + entry within 3 days of the fill. */
function takenTrend(real: any[], instrument: string, executeSymbol: string, fillDate: string | null) {
  if (!fillDate) return null;
  const t = real.find((x) => !x.setupLogId && (x.instrument === instrument || x.executeSymbol === executeSymbol)
    && Math.abs(Date.parse(x.entryDate) - Date.parse(fillDate)) <= 3 * 86400e3);
  return t ? { account: t.account, status: t.status } : null;
}

async function trendBuilt(from: string, events: Evt[], real: any[], only?: string): Promise<{ built: Built[]; errors: { instrument: string; error: string }[] }> {
  const built: Built[] = [], errors: { instrument: string; error: string }[] = [];
  const jobs: { sym: string; slot: "trend" | "crypto"; exec: string; inverted: boolean; load: () => Promise<DayBar[]> }[] = [];
  for (const sym of TREND_MARKETS) {
    const inst = BASKET.find((x) => x.symbol === sym);
    if (!inst) continue;
    jobs.push({ sym, slot: "trend", exec: inst.executeSymbol || sym, inverted: inst.inverted ?? false,
      load: async () => completedBars(await fetchDailyBars(inst.yahoo, "5y")) });
  }
  for (const [sym, m] of Object.entries(CRYPTO_MARKETS))
    jobs.push({ sym, slot: "crypto", exec: m.ftmo, inverted: false, load: async () => cryptoDone(await fetchDailyBars(m.yahoo, "5y")) });
  await Promise.all(jobs.filter((j) => !only || j.sym === only).map(async (j) => {
    try {
      const bars = await j.load();
      const ev = eventsOf(events, j.sym);
      for (const t of trendHistory(bars as any, j.sym, j.exec, j.slot, from)) {
        const b = evaluateTrend(t, bars, ev, null, j.inverted);
        if (b) { b.r.taken = takenTrend(real, j.sym, j.exec, b.r.fillDate); built.push(b); }
      }
    } catch (e) { errors.push({ instrument: j.sym, error: e instanceof Error ? e.message : String(e) }); }
  }));
  return { built, errors };
}

/** Every built row → the rules' call for each account. */
async function runRules(built: Built[], windowStart: string) {
  const [accounts, specs] = await Promise.all([loadAccounts(), loadSpecs()]);
  const cands: RuleCand[] = [];
  for (const b of built) {
    const r = b.r;
    if (!r.slot || !r.fillDate || r.fillPrice == null) continue;
    const execLong = r.inverted ? !b.seriesLong : b.seriesLong;
    cands.push({
      id: r.id, slot: r.slot, instrument: r.instrument, side: execLong ? "long" : "short", grade: r.grade,
      firstBarDate: r.firstBarDate, fillDate: r.fillDate, fillPrice: r.fillPrice, origStop: r.origStop, seriesLong: b.seriesLong,
      exitDate: r.exitDate, resultR: r.status === "open" ? null : r.resultR,
      stops: b.sim.stops ?? [], closes: b.bars.filter((x) => x.date >= r.fillDate!).map((x) => ({ date: x.date, c: x.c })),
      weight: r.weight, cardSkip: b.cardSkip,
    });
  }
  const calls = accounts.map((a) => ({ key: a.key, map: applyRules(cands, a, specs) }));
  const warmEnd = addDays(windowStart, WARMUP_DAYS);
  for (const b of built) {
    if (!b.r.fillDate) continue;
    b.r.warmup = b.r.fillDate < warmEnd;
    if (!b.r.slot) { b.r.rules = Object.fromEntries(accounts.map((a) => [a.key, { taken: false, slot: "range" as RuleSlot, reason: "AB=CD paper — not part of the system" }])); continue; }
    b.r.rules = Object.fromEntries(calls.map((c) => [c.key, c.map.get(b.r.id)!]).filter(([, v]) => v));
  }
  return accounts.map((a) => ({ key: a.key, name: a.name, gradesAllowed: a.gradesAllowed, maxSlots: a.maxSlots, stopR: a.riskPerTrade ? a.monthlyStop / a.riskPerTrade : null }));
}

async function allBuilt() {
  const from = addDays(todayUtc(), -LOOKBACK_DAYS);
  const [logs, events, real] = await Promise.all([
    (db as any).setupLog.findMany({ where: { firstBarDate: { gte: from } } }),
    loadEvents(addDays(from, -1)),
    realTrades(from),
  ]);
  const takenBy = new Map<string, { account: string; status: string }>(
    real.filter((t: any) => t.setupLogId).map((t: any) => [t.setupLogId, { account: t.account, status: t.status }]));

  const ctx = await loadLayerCtx(logs);
  const groups = new Map<string, any[]>();
  for (const r of logs) {
    const k = `${r.market}|${r.instrument}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const built: Built[] = [];
  const errors: { instrument: string; error: string }[] = [];
  for (const [k, list] of groups) {
    const [market, instrument] = k.split("|");
    let bars: DayBar[];
    try { bars = await barsFor(market, instrument); }
    catch (e) { errors.push({ instrument, error: e instanceof Error ? e.message : String(e) }); continue; }
    const ev = eventsOf(events, instrument);
    for (const row of list) {
      const b = evaluateLogged(row, bars, ev, takenBy.get(row.id) ?? null, ctx);
      if (b) built.push(b);
    }
  }
  const tr = await trendBuilt(from, events, real);
  built.push(...tr.built); errors.push(...tr.errors);
  const accounts = await runRules(built, from);
  return { built, errors, accounts, real, from };
}

export async function filledSetups() {
  const { built, errors, accounts, real, from } = await allBuilt();
  const rows = built.map((b) => b.r);
  // Newest action first: open by fill date, closed by exit date, never-filled by when it was seen.
  const key = (r: FilledRow) => r.exitDate ?? r.fillDate ?? r.firstBarDate;
  rows.sort((a, b) => key(b).localeCompare(key(a)));
  const realOut: RealTrade[] = real.map((t: any) => ({
    id: t.id, account: t.account, instrument: t.instrument, executeSymbol: t.executeSymbol ?? null, side: t.side, grade: t.grade,
    entryDate: t.entryDate, exitDate: t.exitDate ?? null, status: t.status, resultR: t.resultR ?? null, rNow: t.rNow ?? null, pnlUsd: t.pnlUsd ?? null,
  }));
  return { rows, errors, accounts, real: realOut, windowStart: from, warmupDays: WARMUP_DAYS };
}

/** One setup's stop trail for its chart (the chart loads its own bars, like /setups). */
export async function filledChart(id: string): Promise<FilledChart | null> {
  const from = addDays(todayUtc(), -LOOKBACK_DAYS);
  const events = await loadEvents(addDays(from, -1));
  if (/^(trend|crypto):/.test(id)) {
    const sym = id.split(":")[1];
    const { built } = await trendBuilt(from, events, [], sym);
    const b = built.find((x) => x.r.id === id);
    return b ? { row: b.r, stops: b.sim.stops ?? [] } : null;
  }
  const row = await (db as any).setupLog.findUnique({ where: { id } });
  if (!row) return null;
  const bars = await barsFor(row.market, row.instrument);
  const b = evaluateLogged(row, bars, eventsOf(events, row.instrument), null);
  return b ? { row: b.r, stops: b.sim.stops ?? [] } : null;
}
