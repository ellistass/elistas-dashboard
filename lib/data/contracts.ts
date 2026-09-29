// lib/data/contracts.ts — which individual futures contracts are live, as Yahoo symbols.
//
// Yahoo's continuous "=F" series breaks around rolls (6A=F showed an expired
// contract's 17–500 lots/day for weeks). Individual contracts ("6AZ26.CME")
// carry REAL volume while they're live, but Yahoo deletes them at expiry — so
// we read the live ones every night and store the total (lib/data/futuresVolume).
//
// Months: F Jan G Feb H Mar J Apr K May M Jun N Jul Q Aug U Sep V Oct X Nov Z Dec

const QUARTERLY = "HMUZ";
const ALL = "FGHJKMNQUVXZ";
export const CONTRACTS: Record<string, { root: string; exch: string; months: string }> = {
  // CME currency futures
  "6E": { root: "6E", exch: "CME", months: QUARTERLY }, "6B": { root: "6B", exch: "CME", months: QUARTERLY },
  "6A": { root: "6A", exch: "CME", months: QUARTERLY }, "6N": { root: "6N", exch: "CME", months: QUARTERLY },
  "6C": { root: "6C", exch: "CME", months: QUARTERLY }, "6J": { root: "6J", exch: "CME", months: QUARTERLY },
  "6S": { root: "6S", exch: "CME", months: QUARTERLY },
  // equity index
  ES: { root: "ES", exch: "CME", months: QUARTERLY }, NQ: { root: "NQ", exch: "CME", months: QUARTERLY },
  RTY: { root: "RTY", exch: "CME", months: QUARTERLY }, YM: { root: "YM", exch: "CBT", months: QUARTERLY },
  // metals
  GC: { root: "GC", exch: "CMX", months: "GJMQVZ" }, SI: { root: "SI", exch: "CMX", months: "HKNUZ" },
  HG: { root: "HG", exch: "CMX", months: "HKNUZ" }, PL: { root: "PL", exch: "NYM", months: "FJNV" },
  PA: { root: "PA", exch: "NYM", months: "HMUZ" },
  // energy (monthly)
  CL: { root: "CL", exch: "NYM", months: ALL }, BZ: { root: "BZ", exch: "NYM", months: ALL },
  NG: { root: "NG", exch: "NYM", months: ALL }, RB: { root: "RB", exch: "NYM", months: ALL },
  HO: { root: "HO", exch: "NYM", months: ALL },
  // grains
  ZC: { root: "ZC", exch: "CBT", months: "HKNUZ" }, ZW: { root: "ZW", exch: "CBT", months: "HKNUZ" },
  ZS: { root: "ZS", exch: "CBT", months: "FHKNQUX" }, ZL: { root: "ZL", exch: "CBT", months: "FHKNQUVZ" },
  ZM: { root: "ZM", exch: "CBT", months: "FHKNQUVZ" },
  // softs (ICE US — the ".NYB" suffix is unverified on Yahoo; failures just log and skip)
  SB: { root: "SB", exch: "NYB", months: "HKNV" }, KC: { root: "KC", exch: "NYB", months: "HKNUZ" },
  CT: { root: "CT", exch: "NYB", months: "HKNZ" }, CC: { root: "CC", exch: "NYB", months: "HKNUZ" },
};

/** The next `count` listed contracts from `from` (inclusive of this month), as Yahoo symbols. */
export function liveContracts(symbol: string, from = new Date(), count = 3): string[] {
  const c = CONTRACTS[symbol]; if (!c) return [];
  const out: string[] = [];
  let y = from.getUTCFullYear(), m = from.getUTCMonth();          // 0-based
  for (let k = 0; k < 24 && out.length < count; k++) {
    const code = ALL[m];
    if (c.months.includes(code)) out.push(`${c.root}${code}${String(y).slice(2)}.${c.exch}`);
    if (++m === 12) { m = 0; y++; }
  }
  return out;
}
