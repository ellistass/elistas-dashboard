// scripts/repair-stuck-open-trades.ts — close the trades that already closed.
//
// Before commit bc4ce95 ("fix(mt4): stop closed trades hanging Open", 19 Aug
// 2026) the MT4 close handler could write closePrice, closeTimeUtc, commission,
// swap and profitCcy and still leave `outcome` at 'Open'. Every consumer in the
// app filters on `outcome === 'Open'` and none of them look at closeTimeUtc, so
// those rows sat in Active forever while carrying a full close record.
//
// The handler cannot do this any more. What it never did was go back and repair
// the rows it had already made — this does that, using the SAME classification
// cascade the live handler uses, so a repaired row is indistinguishable from
// one closed correctly today.
//
//   npx tsx --env-file=.env scripts/repair-stuck-open-trades.ts           # dry run
//   npx tsx --env-file=.env scripts/repair-stuck-open-trades.ts --apply
//
// Only touches rows that have a closeTimeUtc. A trade with no close record is
// either genuinely open or lost its close event to an offline EA, and neither
// is something a script can decide.

import { db } from "../lib/db";
import { resultR } from "../lib/mt4";

const APPLY = process.argv.includes("--apply");

async function main() {
const stuck = await db.trade.findMany({
  where: { outcome: "Open", closeTimeUtc: { not: null } },
  orderBy: { openTimeUtc: "asc" },
});

console.log(`trades marked Open that already carry a close: ${stuck.length}\n`);
if (!stuck.length) { await db.$disconnect(); return; }

const plan: Array<{ id: string; ticket: number | null; outcome: string; r: number | null; how: string; line: string }> = [];

for (const t of stuck) {
  // Same rule as the live handler: R off the stop AT FILL, never the current
  // stop — a trade moved to break-even would otherwise compute nonsense.
  // `||` not `??`, so a 0 stop (opened without one) falls through.
  const slForR = t.initialSlPrice || t.slPrice;
  const r =
    t.entryPrice && slForR && t.closePrice && t.direction
      ? resultR({
          entryPrice: t.entryPrice,
          slPrice: slForR,
          closePrice: t.closePrice,
          direction: t.direction as "Long" | "Short",
          symbol: t.instrument || t.pair,
        })
      : null;

  const netCcy = (t.profitCcy ?? 0) + (t.commission ?? 0) + (t.swap ?? 0);
  const priceDelta =
    t.entryPrice && t.closePrice && t.direction
      ? t.direction === "Long" ? t.closePrice - t.entryPrice : t.entryPrice - t.closePrice
      : 0;

  // A stop that sits a hair from entry is not the stop the trade was filled
  // with — it is a break-even move, or a position opened with no stop at all
  // (initialSlPrice frozen at 0, so the `||` falls through to the CURRENT
  // stop). Either way R is divided by almost nothing and comes out absurd:
  // ticket 52577017 computes -29.18R on a $13.88 loss.
  //
  // The OUTCOME is still sound — a loss is a loss regardless of what the stop
  // was. Only the R is fiction, so only the R is withheld. Writing null leaves
  // a visible gap; writing -29.18 would put a lie in the equity curve and look
  // exactly like a real number. 67 rows already in the book carry R values like
  // this from before the fix — they are reported, not silently rewritten.
  const R_SANITY = 10;
  const rTrusted = r != null && Math.abs(r) <= R_SANITY ? r : null;

  let how = "R";
  let outcome: string;
  if (r !== null) {
    outcome = r >= 0.1 ? "Win" : r <= -0.1 ? "Loss" : "BE";
  } else if (t.profitCcy != null && Math.abs(netCcy) >= 0.01) {
    how = "money";
    outcome = netCcy > 0 ? "Win" : "Loss";
  } else if (priceDelta !== 0) {
    how = "price";
    outcome = priceDelta > 0 ? "Win" : "Loss";
  } else {
    how = "none";
    outcome = "BE";
  }

  if (r != null && rTrusted == null) how = "R (outcome only — R rejected as implausible)";

  plan.push({
    id: t.id, ticket: t.ticket, outcome, r: rTrusted, how,
    line: `  ${String(t.ticket ?? "—").padEnd(10)} ${t.pair.padEnd(9)} ${t.direction.padEnd(6)} ` +
          `closed ${t.closeTimeUtc!.toISOString().slice(0, 16)}  pnl ${String(t.profitCcy ?? "—").padStart(8)}  ` +
          `-> ${outcome.padEnd(5)} ${rTrusted != null ? `${rTrusted.toFixed(2)}R` : r != null ? `(R ${r.toFixed(1)} rejected)` : "(no R)"}`,
  });
}

for (const p of plan) console.log(p.line);

const tally = plan.reduce<Record<string, number>>((a, p) => ({ ...a, [p.outcome]: (a[p.outcome] ?? 0) + 1 }), {});
const byHow = plan.reduce<Record<string, number>>((a, p) => ({ ...a, [p.how]: (a[p.how] ?? 0) + 1 }), {});
console.log(`\noutcomes: ${JSON.stringify(tally)}`);
console.log(`classified by: ${JSON.stringify(byHow)}   (money/price/none = opened without a usable stop, so no R)`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
  await db.$disconnect();
  return;
}

let n = 0;
for (const p of plan) {
  await db.trade.update({
    where: { id: p.id },
    data: { outcome: p.outcome, ...(p.r != null ? { resultR: p.r } : {}) },
  });
  n++;
}
console.log(`\nrepaired ${n} trades`);
console.log("still Open (no close record — genuinely open, or the close event was lost):",
  await db.trade.count({ where: { outcome: "Open" } }));
await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
