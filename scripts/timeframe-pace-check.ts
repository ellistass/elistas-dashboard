// Checks for timeframe aggregation and the pace metric.
import { aggregateBars, isoWeekKey, indexForDate, type TfBar } from "../lib/chart/timeframe";
import { paceRead, describePace, paceAgreesWith } from "../lib/wyckoff/pace";

let fails = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!ok) fails++;
};

/* ── timeframe ─────────────────────────────────────────────────────────── */
console.log("── aggregation ──");

// Mon 2026-01-05 .. Fri 2026-01-16: two clean trading weeks.
const daily: TfBar[] = [
  { o: 10, h: 12, l: 9, c: 11, v: 100, date: "2026-01-05" },
  { o: 11, h: 15, l: 10, c: 14, v: 120, date: "2026-01-06" },
  { o: 14, h: 14, l: 8, c: 9, v: 300, date: "2026-01-07" },
  { o: 9, h: 11, l: 9, c: 10, v: 90, date: "2026-01-08" },
  { o: 10, h: 13, l: 10, c: 13, v: 110, date: "2026-01-09" },
  { o: 13, h: 18, l: 12, c: 17, v: 200, date: "2026-01-12" },
  { o: 17, h: 17, l: 14, c: 15, v: 150, date: "2026-01-13" },
  { o: 15, h: 16, l: 11, c: 12, v: 250, date: "2026-01-16" },
];

const weekly = aggregateBars(daily, "W");
check("two weeks produced", weekly.length === 2, `got ${weekly.length}`);
check("week 1 open = first open", weekly[0].o === 10);
check("week 1 high = max high", weekly[0].h === 15, String(weekly[0].h));
check("week 1 low = min low", weekly[0].l === 8, String(weekly[0].l));
check("week 1 close = last close", weekly[0].c === 13, String(weekly[0].c));
check("week 1 volume summed", weekly[0].v === 720, String(weekly[0].v));
check("week dated by its LAST day", weekly[0].date === "2026-01-09", weekly[0].date);
check("week 2 spans Mon..Fri", weekly[1].o === 13 && weekly[1].c === 12 && weekly[1].h === 18);

const monthly = aggregateBars(daily, "M");
check("one month", monthly.length === 1 && monthly[0].v === 1320, `${monthly.length} / ${monthly[0]?.v}`);
check("daily passes through untouched", aggregateBars(daily, "D") === daily);
check("empty input safe", aggregateBars([], "W").length === 0);

console.log("\n── year boundary ──");
// The naive "day-of-year / 7" approach splits this into a stub week and renders
// a fake narrow bar every January.
check("2025-12-29 (Mon) and 2026-01-01 share an ISO week",
  isoWeekKey("2025-12-29") === isoWeekKey("2026-01-01"),
  `${isoWeekKey("2025-12-29")} vs ${isoWeekKey("2026-01-01")}`);
check("2026-01-05 starts a new week",
  isoWeekKey("2026-01-05") !== isoWeekKey("2026-01-01"));

console.log("\n── marker survival ──");
check("daily date maps into its weekly bar",
  indexForDate(weekly, "W", "2026-01-07") === 0,
  String(indexForDate(weekly, "W", "2026-01-07")));
check("a mid-week date still resolves on weekly",
  indexForDate(weekly, "W", "2026-01-13") === 1,
  String(indexForDate(weekly, "W", "2026-01-13")));
check("exact match on daily", indexForDate(daily, "D", "2026-01-08") === 3);
check("unknown date → -1", indexForDate(weekly, "W", "2030-05-05") === -1);

/* ── pace ──────────────────────────────────────────────────────────────── */
console.log("\n── pace ──");

const mk = (closes: number[], spreads?: number[]) =>
  closes.map((c, i) => ({
    o: c, h: c + (spreads?.[i] ?? 1) / 2, l: c - (spreads?.[i] ?? 1) / 2,
    c, v: 1000, date: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
  }));

// Grinds up a point at a time, drops four points in one bar: classic supply.
const grindUpDropFast = mk([100, 101, 102, 103, 104, 100, 101, 102, 103, 104, 100]);
const supply = paceRead(grindUpDropFast, 0, grindUpDropFast.length);
check("grind up / drop fast leans supply", supply.lean === "supply",
  `ratio ${supply.ratio}`);
check("up side is the slow side", (supply.upBarsPerUnit ?? 0) > (supply.dnBarsPerUnit ?? 0));

// Mirror image: pops up fast, bleeds down slowly.
const popUpBleedDown = mk([100, 104, 103, 102, 101, 100, 104, 103, 102, 101, 100]);
const demand = paceRead(popUpBleedDown, 0, popUpBleedDown.length);
check("pop up / bleed down leans demand", demand.lean === "demand", `ratio ${demand.ratio}`);

const even = mk([100, 102, 100, 102, 100, 102, 100, 102, 100, 102]);
const bal = paceRead(even, 0, even.length);
check("symmetric tape is balanced", bal.lean === "balanced", `ratio ${bal.ratio}`);

console.log("\n── pace guards ──");
check("too few bars → nulls", paceRead(mk([1, 2, 3]), 0, 3).ratio === null);
check("flat tape → nulls (no divide by zero)",
  paceRead(mk([100, 100, 100, 100, 100, 100]), 0, 6).ratio === null);
const onlyUp = paceRead(mk([100, 101, 102, 103, 104, 105]), 0, 6);
check("one-directional tape → nulls", onlyUp.ratio === null, String(onlyUp.ratio));

console.log("\n── spread + description ──");
// Same closes, but declines print wider bars.
const wideDown = mk([100, 101, 102, 99, 100, 101, 98, 99, 100, 97], [1, 1, 1, 4, 1, 1, 4, 1, 1, 4]);
const ws = paceRead(wideDown, 0, wideDown.length);
check("wider declines detected", (ws.spreadRatio ?? 0) > 1.2, `spreadRatio ${ws.spreadRatio}`);
check("description names no direction",
  !/supply|demand|accum|distrib/i.test(describePace(supply) ?? ""), describePace(supply) ?? "");
check("balanced description", (describePace(bal) ?? "").includes("similar pace"), describePace(bal) ?? "");

console.log("\n── agreement ──");
check("supply agrees with distrib", paceAgreesWith(supply, "distrib") === true);
check("supply disagrees with accum", paceAgreesWith(supply, "accum") === false);
check("no verdict → null", paceAgreesWith(supply, null) === null);

console.log(fails === 0 ? "\nAll timeframe + pace checks passed." : `\n${fails} FAILED`);
