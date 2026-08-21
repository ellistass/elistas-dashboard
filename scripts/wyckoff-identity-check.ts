// Checks for range identity. The scenario that matters most is the one Taiwo
// described: the same setup seen yesterday and today must stay ONE row, and
// keep the date it was first seen.
import { assignRanges, scoreMatch, timeOverlapFraction, priceOverlapFraction } from "../lib/wyckoff/identity";

let fails = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  — " + extra : ""}`);
  if (!ok) fails++;
};

console.log("── the re-anchor case ──");
// Yesterday: a range detected from 03-02 to 04-10, box 100–106.
const yesterdayRow = { id: "row-1", startDate: "2026-03-02", endDate: "2026-04-10", lo: 100, hi: 106 };
// Today: the SAME consolidation, but the rolling window shifted the greedy
// detector one bar earlier and it gained a day at the right edge.
const todayDetected = { startDate: "2026-02-27", endDate: "2026-04-13", lo: 100, hi: 106 };

const a1 = assignRanges([todayDetected], [yesterdayRow]);
check("re-anchored range matches its existing row", a1[0].matchedId === "row-1",
  `score ${a1[0].score.toFixed(2)}`);
check("the re-anchor is flagged", a1[0].reanchored === true);

console.log("\n── things that must NOT match ──");
// Same price band, different era — a box that formed again a year later.
const yearLater = { startDate: "2027-03-02", endDate: "2027-04-10", lo: 100, hi: 106 };
check("same box a year later is a new setup",
  assignRanges([yearLater], [yesterdayRow])[0].matchedId === null,
  `time overlap ${timeOverlapFraction(yearLater, yesterdayRow).toFixed(2)}`);

// Same calendar, different price — broke out and reformed higher.
const higherBox = { startDate: "2026-03-02", endDate: "2026-04-10", lo: 118, hi: 124 };
check("same dates at a different price is a new setup",
  assignRanges([higherBox], [yesterdayRow])[0].matchedId === null,
  `price overlap ${priceOverlapFraction(higherBox, yesterdayRow).toFixed(2)}`);

// Barely touching in time.
const grazing = { startDate: "2026-04-08", endDate: "2026-05-20", lo: 100, hi: 106 };
check("a grazing overlap does not match", assignRanges([grazing], [yesterdayRow])[0].matchedId === null,
  `time overlap ${timeOverlapFraction(grazing, yesterdayRow).toFixed(2)}`);

console.log("\n── growth ──");
// An open range simply gaining bars must keep recognising itself, every day.
let row = { id: "row-2", startDate: "2026-03-02", endDate: "2026-03-25", lo: 100, hi: 106 };
let stillMatching = true;
for (let extraDays = 1; extraDays <= 20; extraDays++) {
  const end = new Date(Date.parse("2026-03-25T00:00:00Z") + extraDays * 86_400_000)
    .toISOString().slice(0, 10);
  const grown = { startDate: "2026-03-02", endDate: end, lo: 100, hi: 106 };
  if (assignRanges([grown], [row])[0].matchedId !== "row-2") { stillMatching = false; break; }
}
check("an open range growing for 20 more days keeps its row", stillMatching);

console.log("\n── one-to-one ──");
// Two detected ranges, one existing row: only the better one may claim it.
const rowX = { id: "row-3", startDate: "2026-03-02", endDate: "2026-04-10", lo: 100, hi: 106 };
const near = { startDate: "2026-03-01", endDate: "2026-04-11", lo: 100, hi: 106 };   // near-identical
const looser = { startDate: "2026-03-20", endDate: "2026-04-30", lo: 101, hi: 107 }; // weaker
const two = assignRanges([looser, near], [rowX]);
const claimed = two.filter((x) => x.matchedId === "row-3");
check("only one detected range claims the row", claimed.length === 1, `${claimed.length} claimed`);
check("the better match is the one that claims it",
  two[1].matchedId === "row-3" && two[0].matchedId === null,
  `near=${two[1].matchedId} looser=${two[0].matchedId}`);

console.log("\n── frozen rows ──");
// A row carrying a locked read or an outcome is evidence. Its boundaries must
// never be rewritten by a later detection.
const frozenRow = { id: "row-4", startDate: "2026-03-02", endDate: "2026-04-10", lo: 100, hi: 106, frozen: true };
check("frozen rows are never matched",
  assignRanges([todayDetected], [frozenRow])[0].matchedId === null);

console.log("\n── scoring sanity ──");
const identical = scoreMatch(yesterdayRow, yesterdayRow);
check("identical spans score 1", Math.abs(identical.score - 1) < 1e-9, String(identical.score));
check("disjoint spans score 0", scoreMatch(yesterdayRow, yearLater).score === 0);
check("no existing rows → all new",
  assignRanges([todayDetected], [])[0].matchedId === null);
check("no detections → empty result", assignRanges([], [yesterdayRow]).length === 0);

console.log(fails === 0 ? "\nAll identity checks passed." : `\n${fails} FAILED`);
