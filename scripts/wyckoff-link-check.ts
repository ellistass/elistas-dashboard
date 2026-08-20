// Sanity check for matchReadToTrade — uses Taiwo's REAL broker symbols
// (COFFEE.c, WHEAT.c, JP225.cash) taken from his MT4 Experts log, because the
// symbol hop is the part most likely to silently fail in production.
import { matchReadToTrade, symbolMatches, impliedDirection, planDrift } from "../lib/wyckoff/link";

const t = (isoDaysAgo: number) => new Date(Date.now() - isoDaysAgo * 86_400_000);

const reads = [
  { id: "r-6b",  instrument: "6B",  traderVerdict: "accum",   traderReadAt: t(2) },
  { id: "r-6j",  instrument: "6J",  traderVerdict: "accum",   traderReadAt: t(3) },
  { id: "r-kc",  instrument: "KC",  traderVerdict: "distrib", traderReadAt: t(1) },
  { id: "r-nky", instrument: "NKY", traderVerdict: "pass",    traderReadAt: t(4) },
  { id: "r-zw",  instrument: "ZW",  traderVerdict: "accum",   traderReadAt: t(40) },
  { id: "r-gc",  instrument: "GC",  traderVerdict: "accum",   traderReadAt: t(1) },
];

let fails = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!ok) fails++;
}

console.log("── symbol hop ──");
check("GBPUSD exact", symbolMatches("GBPUSD", "GBPUSD"));
check("EURUSDm suffix", symbolMatches("EURUSDm", "EURUSD"));
check("COFFEE.c → COFFEE", symbolMatches("COFFEE.c", "COFFEE"));
check("JP225.cash → JP225", symbolMatches("JP225.cash", "JP225"));
check("WHEAT.c → WHEAT", symbolMatches("WHEAT.c", "WHEAT"));
check("XAUUSD.pro → XAUUSD", symbolMatches("XAUUSD.pro", "XAUUSD"));
check("GBPUSD does NOT match EURUSD", !symbolMatches("GBPUSD", "EURUSD"));
check("long tail rejected", !symbolMatches("GBPUSDSOMETHING", "GBPUSD"));
check("empty exec rejected", !symbolMatches("ANYTHING", ""));

console.log("\n── inversion ──");
check("6B accum → Long", impliedDirection("6B", "accum") === "Long");
check("6J accum → Short (inverted)", impliedDirection("6J", "accum") === "Short",
  `USDJPY down on JPY strength; got ${impliedDirection("6J", "accum")}`);
check("6C distrib → Long (inverted)", impliedDirection("6C", "distrib") === "Long");
check("pass has no direction", impliedDirection("6B", "pass") === null);

console.log("\n── matching ──");
const m1 = matchReadToTrade(reads, { brokerSymbol: "GBPUSDm", direction: "Long", openedAt: t(1) });
check("followed read links + aligned", m1?.candidateId === "r-6b" && m1?.adherence === "aligned", m1?.reason);

const m2 = matchReadToTrade(reads, { brokerSymbol: "USDJPY", direction: "Short", openedAt: t(2) });
check("inverted read counts as aligned", m2?.candidateId === "r-6j" && m2?.adherence === "aligned", m2?.reason);

const m3 = matchReadToTrade(reads, { brokerSymbol: "USDJPY", direction: "Long", openedAt: t(2) });
check("opposite of own read = contradicted", m3?.adherence === "contradicted", m3?.reason);

const m4 = matchReadToTrade(reads, { brokerSymbol: "COFFEE.c", direction: "Short", openedAt: t(0) });
check("COFFEE.c hop works end to end", m4?.candidateId === "r-kc" && m4?.adherence === "aligned", m4?.reason);

const m5 = matchReadToTrade(reads, { brokerSymbol: "JP225.cash", direction: "Long", openedAt: t(3) });
check("traded a PASS is caught", m5?.candidateId === "r-nky" && m5?.adherence === "traded-a-pass", m5?.reason);

const m6 = matchReadToTrade(reads, { brokerSymbol: "WHEAT.c", direction: "Long", openedAt: t(0) });
check("40-day-old read is out of window", m6 === null);

const m7 = matchReadToTrade(reads, { brokerSymbol: "XAUUSD", direction: "Long", openedAt: t(5) });
check("read locked AFTER the fill cannot claim it", m7 === null, "GC read is 1d old, trade is 5d old");

const m8 = matchReadToTrade(reads, { brokerSymbol: "NFLX", direction: "Short", openedAt: t(0) });
check("unrelated instrument links nothing", m8 === null);

const m9 = matchReadToTrade(
  [
    { id: "old-contra", instrument: "6B", traderVerdict: "distrib", traderReadAt: t(5) },
    { id: "new-aligned", instrument: "6B", traderVerdict: "accum", traderReadAt: t(4) },
  ],
  { brokerSymbol: "GBPUSD", direction: "Long", openedAt: t(1) },
);
check("aligned outranks a contradicting read", m9?.candidateId === "new-aligned", m9?.reason);

console.log("\n── plan drift ──");
const d1 = planDrift({ plannedEntry: 1.28, plannedStop: 1.27, actualEntry: 1.285, actualStop: 1.27 });
check("half-R late entry measured", d1.entryDriftR === 0.5, `got ${d1.entryDriftR}`);
check("stop widening measured", d1.stopWidenedR === 0.5, `got ${d1.stopWidenedR}`);
const d2 = planDrift({ plannedEntry: null, plannedStop: null, actualEntry: 1.2, actualStop: 1.1 });
check("no plan → no invented drift", d2.entryDriftR === null && d2.stopWidenedR === null);

console.log(fails === 0 ? "\nAll link checks passed." : `\n${fails} FAILED`);
