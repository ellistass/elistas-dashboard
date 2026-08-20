// Sanity check for the trainer CSV importer, using the trainer's REAL column
// list (its COLS array, verbatim) so a header change there shows up here.
import { parseTrainerCsv, splitCsvLine, computeStats, caseKeyOf } from "../lib/practice/trainer-csv";

const HEADER = [
  "#", "instrument", "ctx_pct", "range_lo", "range_hi", "band_pct", "dir", "entry", "stop",
  "order_kind", "risk_pct", "rr_boundary", "rr_projection", "fill_bar", "fill_type", "result", "R", "mae_R", "mfe_R",
  "bars_stepped", "springs_at_entry", "upthrusts_at_entry", "stopping_action", "vol_ratio_at_entry",
  "er_ratio_at_entry", "er_verdict_at_entry", "engine", "market_outcome", "aids", "run_id", "closed_at",
].join(",");

const rows = [
  "1,6E,-12.4,1.0820,1.0975,1.42,long,1.0840,1.0805,stop,1.00,2.1,3.4,7,touch,win,2.30,-0.4,2.9,18,1,0,1,1.84,0.86,accum,accum,up,volMA,run-a,2026-08-02",
  "2,ES,+8.1,5210.00,5320.00,2.10,short,5305.00,5330.00,limit,1.00,1.8,2.6,4,touch,loss,-1.00,-1.1,0.3,11,0,2,0,2.10,1.19,distrib,distrib,down,,run-a,2026-08-03",
  "3,GC,-3.0,2310.0,2395.0,3.60,long,2325.0,2298.0,stop,1.00,2.4,3.1,9,gap,be,0.05,-0.6,1.2,22,2,1,0,0.62,0.94,neutral,neutral,chop,volMA|marks,run-a,2026-08-05",
  '4,"NQ, mini",+2.2,18000,18400,2.20,long,18120,17980,stop,1.00,2.0,2.8,6,touch,win,1.60,-0.3,1.9,14,1,0,1,1.30,0.88,accum,accum,up,,run-b,2026-08-07',
  ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
].join("\n");

let fails = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!ok) fails++;
};

console.log("── csv splitting ──");
check("plain split", splitCsvLine("a,b,c").join("|") === "a|b|c");
check("quoted comma held together", splitCsvLine('a,"b, still b",c')[1] === "b, still b");
check("escaped quote", splitCsvLine('a,"say ""hi""",c')[1] === 'say "hi"');

const parsed = parseTrainerCsv(`${HEADER}\n${rows}`);

console.log("\n── parsing ──");
check("4 valid rows, blank skipped", parsed.cases.length === 4 && parsed.skipped === 1,
  `got ${parsed.cases.length} cases / ${parsed.skipped} skipped`);
check("both run ids seen", parsed.runIds.sort().join(",") === "run-a,run-b", parsed.runIds.join(","));

const c1 = parsed.cases[0];
check("instrument", c1.instrument === "6E");
check("R parsed", c1.resultR === 2.3, String(c1.resultR));
check("negative context", c1.ctxPct === -12.4, String(c1.ctxPct));
check("springs at entry", c1.springsAtEntry === 1, String(c1.springsAtEntry));
check("stopping action as bool", c1.stoppingAction === true, String(c1.stoppingAction));
check("vol ratio", c1.volRatioAtEntry === 1.84, String(c1.volRatioAtEntry));
check("engine verdict", c1.engineVerdict === "accum");
check("market outcome", c1.marketOutcome === "up");
check("aids captured", c1.aids === "volMA", String(c1.aids));
check("empty aids → null", parsed.cases[1].aids === null, String(parsed.cases[1].aids));
check("quoted instrument survives", parsed.cases[3].instrument === "NQ, mini", parsed.cases[3].instrument);
check("case key is stable identity", c1.caseKey === caseKeyOf("6E", "-12.4", "1.0820", "1.0975"), c1.caseKey);

console.log("\n── header robustness ──");
const shuffled = [
  "instrument,R,result,run_id,market_outcome,engine",
  "6E,2.30,win,run-a,up,accum",
].join("\n");
const p2 = parseTrainerCsv(shuffled);
check("parses by NAME, not position", p2.cases[0]?.resultR === 2.3 && p2.cases[0]?.instrument === "6E");
const p3 = parseTrainerCsv("foo,bar\n1,2");
check("non-trainer file rejected cleanly", p3.cases.length === 0 && p3.warnings.length > 0, p3.warnings[0]);

console.log("\n── stats ──");
const s = computeStats(parsed.cases);
check("4 closed", s.closed === 4, String(s.closed));
check("2 wins, 1 loss, BE excluded from win rate", s.wins === 2 && s.losses === 1,
  `${s.wins}W ${s.losses}L`);
check("win rate over decided only", s.winRate === 66.7, String(s.winRate));
check("net R", s.netR === 2.95, String(s.netR));
check("profit factor", s.profitFactor === 3.9, String(s.profitFactor));
const dd = computeStats([{ resultR: 2 }, { resultR: -3 }, { resultR: -1 }, { resultR: 5 }]);
check("max drawdown in R", dd.maxDrawdownR === 4, String(dd.maxDrawdownR));
const empty = computeStats([]);
check("empty set does not divide by zero", empty.winRate === null && empty.netR === 0);

console.log(fails === 0 ? "\nAll importer checks passed." : `\n${fails} FAILED`);
