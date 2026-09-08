// scripts/repair-untrustworthy-r.ts — withhold the R values that measure nothing.
//
// See lib/r-trust.ts for why and for where the threshold comes from. In short:
// a broker statement records the FINAL stop, so every trade whose stop was
// moved to break-even imported with a denominator that is not the risk taken.
//
// Reported total R across the book was 8,958.5. Excluding only the loud ones
// (|R| > 10) it is 91.4. Excluding every trade whose stop is implausibly tight
// it is about -51. The sign of the number flips, which is the whole point:
// this is not a cosmetic tidy-up, the R-based equity curve currently says the
// opposite of what the money says.
//
//   npx tsx --env-file=.env scripts/repair-untrustworthy-r.ts           # dry run
//   npx tsx --env-file=.env scripts/repair-untrustworthy-r.ts --apply
//
// Only resultR is cleared. profitCcy, commission, swap, outcome and every price
// stay exactly as they are — money P&L was always correct and is what the
// equity curve should lean on for these rows. Because entry, stop and close all
// remain, any cleared R can be recomputed later if a better stop is recovered.

import { db } from "../lib/db";
import { stopFraction, isRTrustworthy, MIN_STOP_FRACTION } from "../lib/r-trust";

const APPLY = process.argv.includes("--apply");

async function main() {
const rows = await db.trade.findMany({
  where: { resultR: { not: null } },
  select: {
    id: true, ticket: true, pair: true, source: true, resultR: true,
    entryPrice: true, initialSlPrice: true, slPrice: true, profitCcy: true,
  },
});

const bad = rows.filter((t) => !isRTrustworthy(t));
const good = rows.filter((t) => isRTrustworthy(t));

const sum = (a: typeof rows) => a.reduce((s, t) => s + (t.resultR ?? 0), 0);

console.log(`trades carrying an R value:      ${rows.length}`);
console.log(`  R is measuring real risk:      ${good.length}`);
console.log(`  R divided by a moved stop:     ${bad.length}   <- to be cleared\n`);

const bySource: Record<string, number> = {};
for (const t of bad) bySource[t.source] = (bySource[t.source] ?? 0) + 1;
console.log("cleared, by source:", bySource);

const loud = bad.filter((t) => Math.abs(t.resultR!) > 10).length;
console.log(`  of those, |R| > 10 (already visible): ${loud}`);
console.log(`  of those, |R| <= 10 (silently wrong): ${bad.length - loud}\n`);

console.log(`total R reported now:            ${sum(rows).toFixed(1)}`);
console.log(`total R after this repair:       ${sum(good).toFixed(1)}`);
console.log(`money P&L is unchanged:          ${rows.reduce((s, t) => s + (t.profitCcy ?? 0), 0).toFixed(2)}\n`);

console.log("worst offenders being cleared:");
for (const t of [...bad].sort((a, b) => Math.abs(b.resultR!) - Math.abs(a.resultR!)).slice(0, 10)) {
  const f = stopFraction(t);
  console.log(
    `  #${String(t.ticket ?? "—").padEnd(10)} ${t.pair.padEnd(9)} R=${String(t.resultR).padStart(8)}  ` +
    `pnl=${String(t.profitCcy ?? "—").padStart(8)}  stop ${f == null ? "none" : `${(f * 100).toFixed(4)}%`} from entry`,
  );
}

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Floor is ${(MIN_STOP_FRACTION * 100).toFixed(2)}% of entry price.`);
  console.log("Re-run with --apply to commit.");
  await db.$disconnect();
  return;
}

// Sequential, deliberately: the pooled Supabase connection is limited to 1, so
// a parallel batch just trades a fast loop for P2024 pool timeouts.
let n = 0;
for (const t of bad) {
  await db.trade.update({ where: { id: t.id }, data: { resultR: null } });
  n++;
}
console.log(`\ncleared resultR on ${n} trades`);
console.log(`trades still carrying an R: ${await db.trade.count({ where: { resultR: { not: null } } })}`);
await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
