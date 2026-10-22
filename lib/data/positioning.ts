// lib/data/positioning.ts — what big money and short sellers did during a range.
//
// FUTURES (and ETFs mapped to their future): CFTC weekly positioning, futures only.
//   Indices — Traders in Financial Futures: commercials = dealers, speculators = leveraged funds.
//   Commodities — Disaggregated: commercials = producer/merchant, speculators = managed money.
// STOCKS: FINRA consolidated short interest (twice a month).
//
// Tested 22 Oct 2026, as-of-day replay 2018–Oct 2026 (project docs cot-positioning-basket-oct2026,
// stock-positioning-insiders-short-interest-oct2026):
//   Retests work WITH the speculators and in uncrowded stocks; springs work AGAINST them
//   (commercials buying, speculators / short sellers trapped). Full system: 56% win, +0.54R,
//   +2.66R/month, 29 of 106 months losing, max DD −8.2R (was 48%, +0.27R, +1.43R, 48, −8.7R).
// Found in-sample — forward test before trusting the size.

import { rangeFlowZ, type CotPoint } from "./cot";

const FIN: Record<string, string> = { ES: "13874A", NQ: "209742", YM: "124603", RTY: "239742", NKY: "240741" };
const DIS: Record<string, string> = {
  GC: "088691", SI: "084691", HG: "085692", PL: "076651", PA: "075651", CL: "067651", BZ: "06765T",
  NG: "023651", RB: "111659", HO: "022651", ZC: "002602", ZW: "001602", ZS: "005602", ZL: "007601",
  ZM: "026603", SB: "080732", KC: "083731", CT: "033661", CC: "073732",
};
const ETF_TO_FUT: Record<string, string> = { SPY: "ES", QQQ: "NQ", IWM: "RTY", DIA: "YM", GLD: "GC", SLV: "SI", XLE: "CL" };

/** The COT symbol behind a basket instrument (itself, or the future behind an ETF). null = no COT. */
export const cotSymbolFor = (sym: string): string | null =>
  FIN[sym] || DIS[sym] ? sym : ETF_TO_FUT[sym] ?? null;

const plusDays = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export interface CotGroups { comm: CotPoint[]; spec: CotPoint[] }   // am = group net ÷ open interest
export type FuturesCot = Record<string, CotGroups>;

let cotCache: { at: number; data: FuturesCot } | null = null;
const COT_TTL = 6 * 3600 * 1000;

async function socrata(dataset: string, select: string[], codes: string[], since: string) {
  const qs = new URLSearchParams({
    $select: ["report_date_as_yyyy_mm_dd", "cftc_contract_market_code", "open_interest_all", ...select].join(","),
    $where: `cftc_contract_market_code in(${codes.map((c) => `'${c}'`).join(",")}) AND report_date_as_yyyy_mm_dd > '${since}'`,
    $order: "report_date_as_yyyy_mm_dd",
    $limit: "50000",
  });
  const res = await fetch(`https://publicreporting.cftc.gov/resource/${dataset}.json?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`CFTC ${dataset} ${res.status}`);
  return (await res.json()) as Record<string, string>[];
}

/** ~5 years of weekly commercial/speculator positioning for every futures market in the basket. */
export async function fetchFuturesCot(force = false): Promise<FuturesCot> {
  if (!force && cotCache && Date.now() - cotCache.at < COT_TTL) return cotCache.data;
  const since = plusDays(new Date().toISOString(), -5 * 365);
  const [fin, dis] = await Promise.all([
    socrata("gpe5-46if", ["dealer_positions_long_all", "dealer_positions_short_all", "lev_money_positions_long", "lev_money_positions_short"], Object.values(FIN), since),
    socrata("72hh-3qpy", ["prod_merc_positions_long", "prod_merc_positions_short", "m_money_positions_long_all", "m_money_positions_short_all"], Object.values(DIS), since),
  ]);
  const data: FuturesCot = {};
  const put = (sym: string, r: Record<string, string>, cl: string, cs: string, sl: string, ss: string) => {
    const oi = +r.open_interest_all;
    if (!(oi > 0)) return;
    const date = r.report_date_as_yyyy_mm_dd.slice(0, 10), known = plusDays(date, 3);   // Tuesday → Friday release
    const g = (data[sym] ??= { comm: [], spec: [] });
    g.comm.push({ date, known, am: (+r[cl] - +r[cs]) / oi });
    g.spec.push({ date, known, am: (+r[sl] - +r[ss]) / oi });
  };
  const finBy = Object.fromEntries(Object.entries(FIN).map(([s, c]) => [c, s]));
  const disBy = Object.fromEntries(Object.entries(DIS).map(([s, c]) => [c, s]));
  for (const r of fin) { const s = finBy[r.cftc_contract_market_code]; if (s) put(s, r, "dealer_positions_long_all", "dealer_positions_short_all", "lev_money_positions_long", "lev_money_positions_short"); }
  for (const r of dis) { const s = disBy[r.cftc_contract_market_code]; if (s) put(s, r, "prod_merc_positions_long", "prod_merc_positions_short", "m_money_positions_long_all", "m_money_positions_short_all"); }
  for (const g of Object.values(data)) { g.comm.sort((a, b) => a.date.localeCompare(b.date)); g.spec.sort((a, b) => a.date.localeCompare(b.date)); }
  cotCache = { at: Date.now(), data };
  return data;
}

export interface CotRead {
  symbol: string;
  reportDate: string | null;
  /** Range flow z, signed to the TRADE: + = moving with your trade, − = against it. */
  commZ: number | null;
  specZ: number | null;
  /** Speculators' net now vs their own last 3 years, in trade terms: 1 = most on your side, 0 = most against. */
  specLevel: number | null;
}

/** Percentile of the latest known value vs the prior `n` reports (null if too little history). */
function levelPct(s: CotPoint[], asOf: string, n = 156): number | null {
  let i = -1;
  for (let k = 0; k < s.length; k++) if (s[k].known <= asOf) i = k;
  if (i < n) return null;
  const now = s[i].am, hist = s.slice(i - n, i);
  return hist.filter((p) => p.am < now).length / hist.length;
}

export function cotRead(cot: FuturesCot, instrument: string, side: "long" | "short", rangeStart: string, asOf: string): CotRead | null {
  const sym = cotSymbolFor(instrument);
  const g = sym ? cot[sym] : undefined;
  if (!sym || !g) return null;
  const d = side === "long" ? 1 : -1;
  const c = rangeFlowZ(g.comm, rangeStart, asOf), s = rangeFlowZ(g.spec, rangeStart, asOf);
  const lv = levelPct(g.spec, asOf);
  return {
    symbol: sym, reportDate: s?.asOf ?? c?.asOf ?? null,
    commZ: c ? +(d * c.z).toFixed(2) : null,
    specZ: s ? +(d * s.z).toFixed(2) : null,
    specLevel: lv == null ? null : +(d > 0 ? lv : 1 - lv).toFixed(2),
  };
}

// ── Short interest (stocks) ─────────────────────────────────────────────────

export interface SiPoint { date: string; known: string; shares: number; dtc: number }
const siCache = new Map<string, { at: number; pts: SiPoint[] }>();
const SI_TTL = 12 * 3600 * 1000;

/** FINRA consolidated short interest for one stock. Empty on any failure — the scan never breaks on it. */
export async function fetchShortInterest(symbol: string): Promise<SiPoint[]> {
  const hit = siCache.get(symbol);
  if (hit && Date.now() - hit.at < SI_TTL) return hit.pts;
  try {
    const res = await fetch("https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fields: ["settlementDate", "currentShortPositionQuantity", "daysToCoverQuantity"],
        compareFilters: [{ fieldName: "symbolCode", fieldValue: symbol, compareType: "EQUAL" }],
        limit: 5000,
      }),
    });
    if (!res.ok) throw new Error(`FINRA ${res.status}`);
    const rows: any[] = await res.json();
    const pts = rows
      .map((r) => ({ date: String(r.settlementDate).slice(0, 10), shares: Number(r.currentShortPositionQuantity), dtc: Number(r.daysToCoverQuantity) }))
      .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.shares > 0)
      .map((p) => ({ ...p, known: plusDays(p.date, 11) }))      // published ~8 business days after settlement
      .sort((a, b) => a.date.localeCompare(b.date));
    siCache.set(symbol, { at: Date.now(), pts });
    return pts;
  } catch {
    return hit?.pts ?? [];
  }
}

export interface SiRead {
  reportDate: string;
  /** % change in shares short from the report known at the range start to the one known at the signal. */
  changePct: number | null;
  /** Days-to-cover and shares short now vs the stock's own last 48 reports (~2 years): 0–1. */
  dtcPct: number | null;
  levelPct: number | null;
}

export function siRead(pts: SiPoint[], rangeStart: string, asOf: string): SiRead | null {
  let i0 = -1, i1 = -1;
  for (let k = 0; k < pts.length; k++) { if (pts[k].known <= rangeStart) i0 = k; if (pts[k].known <= asOf) i1 = k; }
  if (i1 < 0) return null;
  let changePct = i0 >= 0 ? Math.round((pts[i1].shares / pts[i0].shares - 1) * 100) : null;
  if (changePct != null && Math.abs(changePct) > 100) changePct = null;   // splits / bad prints
  let dtcPct: number | null = null, levelPct: number | null = null;
  if (i1 >= 48) {
    const h = pts.slice(i1 - 48, i1);
    dtcPct = +(h.filter((p) => p.dtc < pts[i1].dtc).length / h.length).toFixed(2);
    levelPct = +(h.filter((p) => p.shares < pts[i1].shares).length / h.length).toFixed(2);
  }
  return { reportDate: pts[i1].date, changePct, dtcPct, levelPct };
}

// ── The grading rules (exactly as tested) ───────────────────────────────────

export interface PosCheck { label: string; pass: boolean; value?: string }
export interface PosVerdict { checks: PosCheck[]; downgrade: boolean; upgrade: boolean }

const f = (x: number | null, d = 2) => (x == null ? "n/a" : x.toFixed(d));

/** entry: conservative = retest, aggressive = spring/upthrust. grade is the setup's grade before positioning. */
export function positioningVerdict(entry: "conservative" | "aggressive", side: "long" | "short", grade: "A" | "B",
  cot: CotRead | null, si: SiRead | null): PosVerdict {
  const checks: PosCheck[] = [];
  let downgrade = false, upgrade = false;
  if (cot) {
    if (entry === "conservative") {
      const against = (cot.specLevel != null && cot.specLevel <= 0.2) || (cot.specZ != null && cot.specZ <= -1);
      checks.push({ label: "COT: speculators not against the retest", pass: !against, value: `level ${f(cot.specLevel)} · flow z ${f(cot.specZ)}` });
      if (against) downgrade = true;
    } else {
      const selling = cot.commZ != null && cot.commZ <= -1;
      checks.push({ label: "COT: commercials not selling into the range", pass: !selling, value: `z ${f(cot.commZ)}` });
      if (selling) downgrade = true;
      const supports = (cot.specZ != null && cot.specZ <= -1) || (cot.commZ != null && cot.commZ >= 1);
      if (supports) checks.push({ label: "COT: speculators trapped / commercials buying", pass: true, value: `spec z ${f(cot.specZ)} · comm z ${f(cot.commZ)}` });
      if (grade === "B" && supports && !selling) upgrade = true;
    }
  }
  if (si) {
    const v = `short interest ${si.changePct == null ? "n/a" : `${si.changePct > 0 ? "+" : ""}${si.changePct}%`} · days-to-cover pct ${f(si.dtcPct)} · level pct ${f(si.levelPct)}`;
    if (entry === "conservative") {
      const jumped = si.changePct != null && si.changePct > 10;
      const crowded = side === "long" && si.dtcPct != null && si.dtcPct >= 0.7;
      checks.push({ label: "Short interest: retest in an uncrowded stock", pass: !jumped && !crowded, value: v });
      if (jumped || crowded) downgrade = true;
    } else if (side === "short") {
      const crowded = (si.dtcPct != null && si.dtcPct >= 0.7) || (si.levelPct != null && si.levelPct >= 0.7);
      checks.push({ label: "Short interest: upthrust not into a crowded short", pass: !crowded, value: v });
      if (crowded) downgrade = true;
    } else {
      const piled = si.changePct != null && si.changePct > 10;
      checks.push({ label: "Short interest: shorts piled in during the range (trapped fuel)", pass: piled, value: v });
      if (grade === "B" && piled) upgrade = true;
    }
  }
  return { checks, downgrade, upgrade: upgrade && !downgrade };
}
