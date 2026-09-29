// lib/swing/core.ts — the swing system's pure maths (spec: "Elistas Dashboard —
// Swing Trading Spec"). No database, no fetches: the pages, the setup cards,
// the gate and the nightly job all import from here so the numbers can't drift.
//
//   accounts     — the two books the rules talk about (50k, 15k) and their limits
//   specs        — how many dollars one unit moves per point, and its margin
//   correlation  — which trades are really the same bet
//   tracking     — best price, R now, +1R touched, trailing stop, stop/cap hits
//   ledger       — realised, open risk, locked, worst case, house pot, slots

// ── Accounts ─────────────────────────────────────────────────────────────────

export type AccountKey = "50k" | "15k";

export interface SwingAccountCfg {
  key: AccountKey;
  name: string;
  balance: number;
  riskPerTrade: number;
  monthlyStop: number;      // positive dollars
  monthlyTarget: number;
  gradesAllowed: string[];
  maxSlots: number;
}

/** Spec defaults. Balances are edited on the Month page (settings). */
export const DEFAULT_ACCOUNTS: SwingAccountCfg[] = [
  { key: "50k", name: "50k (recovery)", balance: 46500, riskPerTrade: 100, monthlyStop: 500, monthlyTarget: 600, gradesAllowed: ["A"], maxSlots: 3 },
  { key: "15k", name: "15k (growth)", balance: 14700, riskPerTrade: 100, monthlyStop: 400, monthlyTarget: 600, gradesAllowed: ["A", "B"], maxSlots: 3 },
];

/** $100 for an A, $50 for a B (one failed check). */
export const riskForGrade = (grade: string, base = 100) => (grade === "A" ? base : base / 2);

/** Which accounts a grade belongs in. */
export const accountsForGrade = (grade: string, accounts: SwingAccountCfg[]) =>
  accounts.filter((a) => a.gradesAllowed.includes(grade)).map((a) => a.key);

// ── Instrument specs (size + margin) ─────────────────────────────────────────

export interface InstrumentSpecCfg {
  instrument: string;
  unit: string;              // "lot" | "share" | "contract" | "unit"
  valuePerPoint: number;     // USD per 1.0 price move per 1 unit
  marginPerUnit: number | null; // USD; null = use the default % of price
  sector: string | null;
}

// Rough USD value of one unit of each currency, for sizing crosses. Within a few
// percent is enough for a size check; override per instrument in settings.
const USD_PER: Record<string, number> = { USD: 1, EUR: 1.1, GBP: 1.3, AUD: 0.66, NZD: 0.6, CAD: 0.73, CHF: 1.15, JPY: 0.0067 };

const CCY_FUT: Record<string, string> = { "6E": "EURUSD", "6B": "GBPUSD", "6A": "AUDUSD", "6N": "NZDUSD", "6C": "USDCAD", "6J": "USDJPY", "6S": "USDCHF" };
const INDEX = new Set(["ES", "NQ", "YM", "RTY", "DAX", "STOXX", "FTSE", "CAC", "NKY", "HSI", "ASX"]);
const LOT_SIZE: Record<string, number> = { GC: 100, SI: 5000, PL: 100, PA: 100, HG: 25000, CL: 1000, BZ: 1000, NG: 10000 };

export const isFxPair = (s: string) => /^[A-Z]{6}$/.test(s) && !!USD_PER[s.slice(0, 3)] && !!USD_PER[s.slice(3)];
/** The spot pair a basket symbol executes as, if it's a currency. */
export const fxPairFor = (instrument: string) => (isFxPair(instrument) ? instrument : CCY_FUT[instrument] ?? null);

export type SpecClass = "forex" | "stock" | "index" | "commodity";
export function specClass(instrument: string): SpecClass {
  if (fxPairFor(instrument)) return "forex";
  if (INDEX.has(instrument)) return "index";
  if (/^[A-Z]{1,5}$/.test(instrument) && !LOT_SIZE[instrument] && !/^(ZC|ZW|ZS|ZL|ZM|SB|KC|CT|CC|HO|RB)$/.test(instrument)) return "stock";
  return "commodity";
}

const MARGIN_PCT: Record<SpecClass, number> = { forex: 1 / 30, stock: 0.2, index: 0.05, commodity: 0.1 };

export function defaultSpec(instrument: string): InstrumentSpecCfg {
  const cls = specClass(instrument);
  const pair = fxPairFor(instrument);
  if (pair) return { instrument, unit: "lot", valuePerPoint: 100000 * USD_PER[pair.slice(3)], marginPerUnit: null, sector: null };
  if (cls === "stock") return { instrument, unit: "share", valuePerPoint: 1, marginPerUnit: null, sector: SECTOR[instrument] ?? null };
  if (cls === "index") return { instrument, unit: "lot", valuePerPoint: 1, marginPerUnit: null, sector: null };
  return { instrument, unit: "lot", valuePerPoint: LOT_SIZE[instrument] ?? 1, marginPerUnit: null, sector: null };
}

export function specFor(instrument: string, overrides: InstrumentSpecCfg[] = []): InstrumentSpecCfg {
  const d = defaultSpec(instrument);
  const o = overrides.find((x) => x.instrument === instrument);
  return o ? { ...d, ...o, sector: o.sector ?? d.sector } : d;
}

/** Units to trade so that entry→stop costs `riskUsd`. Lots round down to 0.01, shares to 1. */
export function sizeFor(riskUsd: number, entry: number, stop: number, spec: InstrumentSpecCfg): number {
  const perUnit = Math.abs(entry - stop) * spec.valuePerPoint;
  if (!(perUnit > 0)) return 0;
  const raw = riskUsd / perUnit;
  // Small epsilon: 100 / (0.005 × 100000) is 0.19999… in floating point.
  return spec.unit === "share" ? Math.floor(raw + 1e-9) : Math.floor(raw * 100 + 1e-9) / 100;
}

export function marginFor(size: number, price: number, spec: InstrumentSpecCfg): number {
  if (spec.marginPerUnit != null) return size * spec.marginPerUnit;
  const pair = fxPairFor(spec.instrument);
  const notional = pair ? size * 100000 * USD_PER[pair.slice(0, 3)] : size * price * spec.valuePerPoint;
  return notional * MARGIN_PCT[specClass(spec.instrument)];
}

// ── Correlation ──────────────────────────────────────────────────────────────
// Forex: split each pair into long base / short quote; two trades sharing a leg
// in the same direction are one bet. Stocks: same sector, same direction. Gold
// and silver count as short USD; NQ counts with tech; ES/YM/RTY and every stock
// count as "US equities".

export const SECTOR: Record<string, string> = {
  AAPL: "tech", MSFT: "tech", NVDA: "tech", AMD: "tech", TSLA: "tech", AMZN: "tech", GOOGL: "tech", META: "tech",
  NFLX: "tech", INTC: "tech", MU: "tech", CRM: "tech", ORCL: "tech", CSCO: "tech", ADBE: "tech", QCOM: "tech",
  AVGO: "tech", QQQ: "tech", XLK: "tech",
  JPM: "financials", BAC: "financials", WFC: "financials", V: "financials", MA: "financials", XLF: "financials",
  XLE: "energy", CVX: "energy", XOM: "energy",
  KO: "consumer", PG: "consumer", WMT: "consumer", COST: "consumer", MCD: "consumer", NKE: "consumer", HD: "consumer", DIS: "consumer",
  PFE: "health", JNJ: "health", UNH: "health",
  T: "telecom", VZ: "telecom", BA: "industrials",
};

export interface Exposure { factor: string; sign: 1 | -1 }
export type Side = "long" | "short";

/** `side` is the direction you EXECUTE (buy/sell the pair or CFD). */
export function exposures(instrument: string, side: Side, sectorOverride?: string | null): Exposure[] {
  const d: 1 | -1 = side === "long" ? 1 : -1;
  const neg = (-d) as 1 | -1;
  const pair = fxPairFor(instrument);
  if (pair) return [{ factor: `ccy:${pair.slice(0, 3)}`, sign: d }, { factor: `ccy:${pair.slice(3)}`, sign: neg }];
  if (instrument === "GC" || instrument === "GLD" || instrument === "XAUUSD") return [{ factor: "ccy:USD", sign: neg }, { factor: "gold", sign: d }];
  if (instrument === "SI" || instrument === "SLV" || instrument === "XAGUSD") return [{ factor: "ccy:USD", sign: neg }, { factor: "silver", sign: d }];
  if (instrument === "NQ") return [{ factor: "sector:tech", sign: d }, { factor: "equities", sign: d }];
  if (["ES", "YM", "RTY", "SPY", "DIA", "IWM"].includes(instrument)) return [{ factor: "equities", sign: d }];
  if (["CL", "BZ", "RB", "HO"].includes(instrument)) return [{ factor: "sector:energy", sign: d }];
  const sector = sectorOverride ?? SECTOR[instrument];
  if (specClass(instrument) === "stock") {
    return [...(sector ? [{ factor: `sector:${sector}`, sign: d }] : []), { factor: "equities", sign: d }, { factor: `inst:${instrument}`, sign: d }];
  }
  return [{ factor: `inst:${instrument}`, sign: d }];
}

export function correlated(a: Exposure[], b: Exposure[]): string | null {
  for (const x of a) for (const y of b) if (x.factor === y.factor && x.sign === y.sign) return x.factor;
  return null;
}

/** Group trades into correlated clusters (union-find). Each cluster is one slot. */
export function correlationGroups<T extends { instrument: string; side: string; sector?: string | null }>(trades: T[]): T[][] {
  const ex = trades.map((t) => exposures(t.instrument, t.side as Side, t.sector));
  const parent = trades.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < trades.length; i++)
    for (let j = i + 1; j < trades.length; j++)
      if (correlated(ex[i], ex[j])) parent[find(i)] = find(j);
  const groups = new Map<number, T[]>();
  trades.forEach((t, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), t]); });
  return [...groups.values()];
}

// ── Trade tracking ───────────────────────────────────────────────────────────

export interface DayBar { o: number; h: number; l: number; c: number; date: string }

export interface StopMove { date: string; from: number; to: number; byRule: boolean }

export interface TrackInput {
  side: Side;
  entryDate: string;
  entryPrice: number;
  initialStop: number;
  currentStop: number;
  capPrice: number | null;
  brokerBest: number | null;
  stopMoves: StopMove[];
}

export interface Tracked {
  lastDate: string | null;
  lastClose: number | null;
  bestPrice: number;
  bestDate: string | null;
  rNow: number | null;
  peakR: number;
  touched1R: boolean;
  /** Where the rule puts the stop tonight (never worse than the current stop). */
  suggestedStop: number;
  lockedR: number;
  stopHitDate: string | null;
  stopHitPrice: number | null;
  capHitDate: string | null;
  daysHeld: number;
}

export const MAX_HOLD = 60;

/**
 * Evening maths on completed daily bars. Stops are adjusted once a day after
 * the close, so the stop in force on a day is the last one moved BEFORE it.
 * Best price = the most favourable extreme since entry, or your broker's print
 * (CFD pre/after-market) when that's further.
 */
export function trackTrade(t: TrackInput, bars: DayBar[]): Tracked {
  const d = t.side === "long" ? 1 : -1;
  const R = Math.abs(t.entryPrice - t.initialStop);
  const after = bars.filter((b) => b.date >= t.entryDate);
  const moves = [...t.stopMoves].sort((a, b) => a.date.localeCompare(b.date));
  const stopOn = (date: string) => {
    let s = t.initialStop;
    for (const m of moves) if (m.date < date) s = m.to;
    return s;
  };
  let best = t.entryPrice, bestDate: string | null = null;
  let stopHitDate: string | null = null, stopHitPrice: number | null = null, capHitDate: string | null = null;
  for (const b of after) {
    const stop = stopOn(b.date);
    // The fill day can't be judged against its own range order; start checks the day after.
    if (b.date > t.entryDate) {
      if (d > 0 ? b.l <= stop : b.h >= stop) { stopHitDate = b.date; stopHitPrice = stop; break; }
      if (t.capPrice != null && (d > 0 ? b.h >= t.capPrice : b.l <= t.capPrice)) { capHitDate = b.date; break; }
    }
    const ext = d > 0 ? b.h : b.l;
    if (d * (ext - best) > 0) { best = ext; bestDate = b.date; }
  }
  if (t.brokerBest != null && d * (t.brokerBest - best) > 0) best = t.brokerBest;

  const peakR = R > 0 ? (d * (best - t.entryPrice)) / R : 0;
  const touched1R = peakR >= 1;
  const ruleStop = touched1R ? best - d * R : t.initialStop;
  const suggestedStop = d > 0 ? Math.max(t.currentStop, ruleStop) : Math.min(t.currentStop, ruleStop);
  const last = after[after.length - 1] ?? null;
  return {
    lastDate: last?.date ?? null,
    lastClose: last?.c ?? null,
    bestPrice: best,
    bestDate,
    rNow: last && R > 0 ? (d * (last.c - t.entryPrice)) / R : null,
    peakR,
    touched1R,
    suggestedStop,
    lockedR: R > 0 ? Math.max(0, (d * (t.currentStop - t.entryPrice)) / R) : 0,
    stopHitDate,
    stopHitPrice,
    capHitDate,
    daysHeld: after.length,
  };
}

/** Result in R and dollars for an exit price. */
export function resultOf(side: Side, entry: number, initialStop: number, exit: number, riskUsd: number) {
  const R = Math.abs(entry - initialStop);
  const r = R > 0 ? ((side === "long" ? 1 : -1) * (exit - entry)) / R : 0;
  return { resultR: +r.toFixed(3), pnlUsd: +(r * riskUsd).toFixed(2) };
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export interface LedgerTrade {
  account: string; instrument: string; side: string; sector?: string | null;
  status: string; entryPrice: number; initialStop: number; currentStop: number;
  riskUsd: number; exitDate: string | null; pnlUsd: number | null; rNow?: number | null;
}

export interface Ledger {
  realised: number;       // closed this month
  openRisk: number;       // dollars still at risk on open trades
  locked: number;         // dollars locked in by stops beyond breakeven
  worstCase: number;      // realised − open risk + locked
  stopRemaining: number;  // how far worst case is from the monthly stop
  housePot: number;       // max(0, worst case)
  slotsUsed: number;
  openCount: number;
  progress: number;       // realised ÷ target
  stopHit: boolean;
}

export function riskParts(t: LedgerTrade) {
  const R = Math.abs(t.entryPrice - t.initialStop);
  const d = t.side === "long" ? 1 : -1;
  const atStop = R > 0 ? (d * (t.currentStop - t.entryPrice)) / R : -1;   // R at the current stop
  return { open: Math.max(0, -atStop) * t.riskUsd, locked: Math.max(0, atStop) * t.riskUsd };
}

export function ledger(acc: SwingAccountCfg, trades: LedgerTrade[], month: string): Ledger {
  const mine = trades.filter((t) => t.account === acc.key);
  const realised = mine.filter((t) => t.status === "closed" && t.exitDate?.startsWith(month)).reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const open = mine.filter((t) => t.status === "open");
  let openRisk = 0, locked = 0;
  for (const t of open) { const p = riskParts(t); openRisk += p.open; locked += p.locked; }
  const worstCase = realised - openRisk + locked;
  return {
    realised, openRisk, locked, worstCase,
    stopRemaining: acc.monthlyStop + worstCase,
    housePot: Math.max(0, worstCase),
    slotsUsed: correlationGroups(open).length,
    openCount: open.length,
    progress: acc.monthlyTarget ? realised / acc.monthlyTarget : 0,
    stopHit: realised <= -acc.monthlyStop,
  };
}

// ── Levels vs the card ───────────────────────────────────────────────────────

export interface LevelInput {
  entryPrice: number; initialStop: number;
  cardEntry: number | null; cardStop: number | null;
  /** "limit" = the card's entry is a level; "open" = market at the next open (entry is only a reference). */
  cardEntryKind: string | null;
  /** Card and fill are in the same prices (stocks, spot FX). */
  samePrices: boolean;
}

/** Why the order lines don't match the card, or null. Rule: entry, stop and take-profit exactly as the card. */
export function levelMismatch(t: LevelInput): string | null {
  if (t.cardStop == null) return null;
  const R = Math.abs(t.entryPrice - t.initialStop);
  const cardR = t.cardEntry != null ? Math.abs(t.cardEntry - t.cardStop) : R;
  if (!(cardR > 0)) return null;
  if (t.samePrices) {
    if (Math.abs(t.initialStop - t.cardStop) > 0.1 * cardR) return `stop ${fmtPx(t.initialStop)} vs the card's ${fmtPx(t.cardStop)}`;
    if (t.cardEntryKind !== "open" && t.cardEntry != null && Math.abs(t.entryPrice - t.cardEntry) > 0.1 * cardR)
      return `entry ${fmtPx(t.entryPrice)} vs the card's ${fmtPx(t.cardEntry)}`;
    return null;
  }
  // Different price series (futures card, CFD fill): only the stop DISTANCE is comparable.
  if (t.cardEntryKind !== "open" && t.cardEntry != null && Math.abs(R - cardR) / cardR > 0.1)
    return `stop distance ${fmtPx(R)} vs the card's ${fmtPx(cardR)} — the card's stop wasn't used`;
  return null;
}

// ── Small helpers ────────────────────────────────────────────────────────────

export const fmtPx = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toFixed(5);
export const fmtUsd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const fmtR = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`);
export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const monthOf = (d: string) => d.slice(0, 7);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
