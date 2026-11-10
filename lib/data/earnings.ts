// lib/data/earnings.ts — past and next earnings releases for US-listed stocks, from the SEC.
//
// Every earnings release is filed as an 8-K with item 2.02 ("Results of Operations"). The
// acceptance time says when it hit the market: after the 16:00 New York close → the reaction
// is the next session. The next release is projected one year on from the same quarter last
// year (companies report in the same week each year), or ~91 days after the latest one.
//
// Tested 10 Nov 2026 (grade-A stock trades, healthy market, 2018–Oct 2026): entries with earnings
// within 10 days of the fill went 38% / −0.29R (13 trades, with the stock layers) vs 66% / +0.94R
// (104) further away; worst gap NFLX Oct 2018 −2.64R. Shown as a WARNING on the card, not a skip.
// Foreign filers (AZN, ASML, ARM, BABA, RACE file 6-K, not 8-K) get no date.

// SEC fair-access policy: automated requests must identify a contact.
const UA = "elistas-dashboard taiwokenny45@gmail.com";
const DAY = 864e5;

let cikCache: { at: number; map: Map<string, number> } | null = null;
const relCache = new Map<string, { at: number; dates: string[] }>();

async function cikFor(symbol: string): Promise<number | null> {
  if (!cikCache || Date.now() - cikCache.at > 7 * DAY) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!r.ok) throw new Error(`SEC tickers ${r.status}`);
    const j = await r.json();
    const map = new Map<string, number>();
    for (const v of Object.values<any>(j)) map.set(String(v.ticker).toUpperCase(), Number(v.cik_str));
    cikCache = { at: Date.now(), map };
  }
  return cikCache.map.get(symbol.toUpperCase().replace(".", "-")) ?? null;
}

const nextSession = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  do t.setUTCDate(t.getUTCDate() + 1); while ([0, 6].includes(t.getUTCDay()));
  return t.toISOString().slice(0, 10);
};

/** Reaction dates of past earnings releases (the session the market first trades them), oldest first. */
export async function earningsReleases(symbol: string): Promise<string[]> {
  const hit = relCache.get(symbol);
  if (hit && Date.now() - hit.at < DAY) return hit.dates;
  const cik = await cikFor(symbol);
  if (!cik) { relCache.set(symbol, { at: Date.now(), dates: [] }); return []; }
  const r = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!r.ok) throw new Error(`SEC submissions ${symbol} ${r.status}`);
  const f = (await r.json())?.filings?.recent ?? {};
  const out = new Set<string>();
  for (let i = 0; i < (f.form?.length ?? 0); i++) {
    if (!/^8-K/.test(f.form[i]) || !String(f.items?.[i] ?? "").includes("2.02")) continue;
    const at = String(f.acceptanceDateTime[i]);          // New York time, e.g. 2026-10-30T16:31:05
    const d = at.slice(0, 10), h = Number(at.slice(11, 13));
    out.add(h >= 16 ? nextSession(d) : d);
  }
  const dates = [...out].sort();
  relCache.set(symbol, { at: Date.now(), dates });
  return dates;
}

export interface EarningsRead { next: string; days: number; estimated: true }

/** The next earnings reaction day on or after `from`, projected from past releases. null = unknown. */
export function nextEarnings(releases: string[], from: string): EarningsRead | null {
  if (!releases.length) return null;
  const t0 = Date.parse(`${from}T00:00:00Z`);
  const cands: number[] = [];
  for (const d of releases.slice(-6)) cands.push(Date.parse(`${d}T00:00:00Z`) + 364 * DAY);   // same week last year
  cands.push(Date.parse(`${releases[releases.length - 1]}T00:00:00Z`) + 91 * DAY);              // a quarter after the latest
  const next = cands.filter((t) => t >= t0 - 2 * DAY).sort((a, b) => a - b)[0];
  if (next == null) return null;
  return { next: new Date(next).toISOString().slice(0, 10), days: Math.round((next - t0) / DAY), estimated: true };
}
