// lib/data/cot.ts — what REAL MONEY (asset managers) did in each currency during a range.
//
// Source: CFTC "Traders in Financial Futures — futures only", the public Socrata
// feed (same numbers as the weekly files). Positions are as of TUESDAY and are
// published FRIDAY 15:30 New York (20:30 Lagos) — so a report only counts from
// the Friday after its date. Weekly, never daily: ranges run for weeks, so a
// range usually spans 3–12 reports.
//
// The read (tested Sep 2026, forex reversal-break retests, fair fills):
//   the currency you SELL — real money kept BUYING it through the range (trapped,
//   the Composite Man's counterparty): +0.48R (2023–26, n=37) / +0.34R (2021–23, n=21)
//   … real money already SELLING it (your side, late):  −0.39R (n=24) / −0.16R (n=13)
//   The currency you BUY showed nothing consistent — displayed, not graded.
// Strong lead, not proven: small samples, one of ~15 variables tested.

const CODES: Record<string, string> = {
  EUR: "099741", GBP: "096742", JPY: "097741", CHF: "092741",
  CAD: "090741", AUD: "232741", NZD: "112741",
};                                                    // USD has no single currency future

export interface CotPoint { date: string; known: string; am: number }   // am = asset-manager net ÷ open interest
export type CotSeries = Record<string, CotPoint[]>;

const plusDays = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

let cache: { at: number; data: CotSeries } | null = null;
const TTL_MS = 6 * 3600 * 1000;

/** ~3 years of weekly asset-manager positioning for the 7 currency futures. */
export async function fetchCot(force = false): Promise<CotSeries> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const since = plusDays(new Date().toISOString(), -3 * 365);
  const qs = new URLSearchParams({
    $select: "report_date_as_yyyy_mm_dd,cftc_contract_market_code,open_interest_all,asset_mgr_positions_long,asset_mgr_positions_short",
    $where: `cftc_contract_market_code in(${Object.values(CODES).map((c) => `'${c}'`).join(",")}) AND report_date_as_yyyy_mm_dd > '${since}'`,
    $order: "report_date_as_yyyy_mm_dd",
    $limit: "5000",
  });
  const res = await fetch(`https://publicreporting.cftc.gov/resource/gpe5-46if.json?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`CFTC ${res.status}`);
  const rows: Record<string, string>[] = await res.json();
  const byCode = Object.fromEntries(Object.entries(CODES).map(([c, code]) => [code, c]));
  const data: CotSeries = Object.fromEntries(Object.keys(CODES).map((c) => [c, [] as CotPoint[]]));
  for (const r of rows) {
    const ccy = byCode[r.cftc_contract_market_code]; if (!ccy) continue;
    const oi = +r.open_interest_all, L = +r.asset_mgr_positions_long, S = +r.asset_mgr_positions_short;
    if (!(oi > 0) || !Number.isFinite(L) || !Number.isFinite(S)) continue;
    const date = r.report_date_as_yyyy_mm_dd.slice(0, 10);
    data[ccy].push({ date, known: plusDays(date, 3), am: (L - S) / oi });   // Tuesday → Friday release
  }
  for (const c of Object.keys(data)) data[c].sort((a, b) => a.date.localeCompare(b.date));
  cache = { at: Date.now(), data };
  return data;
}

/** How unusual real money's net change was from range start → asOf, as a z-score
 *  against every change of the same length in the prior 2 years. null = too little history. */
export function rangeFlowZ(s: CotPoint[] | undefined, rangeStart: string, asOf: string): { z: number; asOf: string } | null {
  if (!s?.length) return null;
  let i0 = -1, i1 = -1;
  for (let k = 0; k < s.length; k++) { if (s[k].known <= rangeStart) i0 = k; if (s[k].known <= asOf) i1 = k; }
  if (i0 < 52 || i1 <= i0) return null;
  const h = i1 - i0;
  const ch: number[] = [];
  for (let k = Math.max(h, i0 - 104); k < i0; k++) ch.push(s[k].am - s[k - h].am);
  if (ch.length < 20) return null;
  const m = ch.reduce((a, x) => a + x, 0) / ch.length;
  const sd = Math.sqrt(ch.reduce((a, x) => a + (x - m) ** 2, 0) / ch.length);
  if (!(sd > 0)) return null;
  return { z: (s[i1].am - s[i0].am - m) / sd, asOf: s[i1].date };
}

export type LegVerdict = "trapped" | "flat" | "late" | "n/a";
export interface PositioningRead {
  /** The currency you SELL — the graded leg. */
  sell: { ccy: string; z: number | null; verdict: LegVerdict };
  /** The currency you BUY — shown, not graded (tested inconsistent). */
  buy: { ccy: string; z: number | null; verdict: LegVerdict };
  reportDate: string | null;
  tone: "good" | "warn" | "neutral";
  headline: string;
}

const Z = 0.5;

/** Real money in both legs over the range. `sellCcy` is the currency you're selling. */
export function positioningRead(cot: CotSeries, buyCcy: string, sellCcy: string, rangeStart: string, asOf: string): PositioningRead {
  const s = rangeFlowZ(cot[sellCcy], rangeStart, asOf), b = rangeFlowZ(cot[buyCcy], rangeStart, asOf);
  // Sell leg: real money BUYING it (z > 0) = still on the old trend = trapped fuel.
  const sv: LegVerdict = !s ? "n/a" : s.z >= Z ? "trapped" : s.z <= -Z ? "late" : "flat";
  // Buy leg: real money SELLING it (z < 0) = trapped; buying it = already on your side.
  const bv: LegVerdict = !b ? "n/a" : b.z <= -Z ? "trapped" : b.z >= Z ? "late" : "flat";
  const tone = sv === "trapped" ? "good" : sv === "late" ? "warn" : "neutral";
  const headline =
    sv === "trapped" ? `Real money kept BUYING ${sellCcy} through the range — trapped on the old trend ✓ fuel`
    : sv === "late" ? `⚠ Real money already SELLING ${sellCcy} during the range — the move may be used up (late)`
    : sv === "flat" ? `Real money quiet in ${sellCcy} during the range — no read`
    : sellCcy === "USD" ? `USD has no single futures positioning — see the ${buyCcy} leg`
    : `Not enough positioning history for ${sellCcy}`;
  return {
    sell: { ccy: sellCcy, z: s ? +s.z.toFixed(2) : null, verdict: sv },
    buy: { ccy: buyCcy, z: b ? +b.z.toFixed(2) : null, verdict: bv },
    reportDate: s?.asOf ?? b?.asOf ?? null,
    tone, headline,
  };
}
