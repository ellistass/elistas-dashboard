// scripts/verify-scan.ts — does a scan still clone rows?
//
// Runs the real basket sweep against the real table and reports the row count
// either side of it. The clone bug's signature is unmissable here: before the
// fix this printed roughly +785. After it, a scan that finds nothing new should
// print +0, and any creates it does report should be ranges that genuinely
// appeared for the first time.
//
//   npx tsx --env-file=.env scripts/verify-scan.ts

import { db } from "../lib/db";
import { runWyckoffScan } from "../lib/wyckoff/scan";

// Wrapped rather than top-level await: tsx compiles this file to CJS.
async function main() {
const before = await db.scannerCandidate.count();
const brokenBefore = await db.scannerCandidate.count({ where: { status: "broken" } });
console.log(`before: ${before} rows (${brokenBefore} broken)`);

const t0 = Date.now();
const r = await runWyckoffScan();
const after = await db.scannerCandidate.count();

console.log(`\nscanned ${r.scanned} instruments in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`ranges detected   ${r.rangesFound}`);
console.log(`rows written      ${r.persisted}`);
console.log(`settled, skipped  ${r.settled}   <- these were the clones`);
console.log(`re-anchored       ${r.reanchored}`);
console.log(`stale removed     ${r.staleRemoved}`);
console.log(`fresh candidates  ${r.candidates.length}`);
if (r.errors.length) console.log(`errors            ${r.errors.length}: ${r.errors.slice(0, 5).map((e) => `${e.instrument} ${e.message}`).join(" | ")}`);

console.log(`\nafter:  ${after} rows   (net ${after - before >= 0 ? "+" : ""}${after - before})`);

const withSightings = await db.scannerCandidate.count({ where: { sightingCount: { gt: 0 } } });
const repeat = await db.scannerCandidate.count({ where: { sightingCount: { gt: 1 } } });
console.log(`sighting log: ${withSightings} rows logged, ${repeat} seen more than once`);

await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
