#!/usr/bin/env node
// scripts/dedupe-candidates.mjs — one-off repair for the scanner clone bug.
//
// THE BUG (fixed in lib/wyckoff/identity.ts): assignRanges excluded settled
// rows from matching, so every scan re-detected every already-broken range,
// failed to match it, and created a new row. Each clone then resolved on its
// own and posted a months-old success or failure to the monthly audit as if it
// had just happened.
//
// THE REPAIR: collapse each clone group to its OLDEST row. That row is the one
// the trader actually worked with — it carries the locked read, the watch tag,
// the note and the alert level; the clones are blanks. Anything a clone holds
// that the keeper does not is salvaged onto the keeper before the clone goes,
// so no evidence is lost even where the assumption does not hold.
//
//   node --env-file=.env scripts/dedupe-candidates.mjs           # dry run
//   node --env-file=.env scripts/dedupe-candidates.mjs --apply   # commit
//
// Grouping key is (instrument, rangeStartDate, rangeLo, rangeHi) — exact, not
// fuzzy. Clones are byte-identical re-detections of the same bars, so an exact
// key catches them all; anything it misses stays put rather than being merged
// on a guess.

import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const db = new PrismaClient()

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const key = (r) => `${r.instrument}|${iso(r.rangeStartDate)}|${r.rangeLo}|${r.rangeHi}`

// Fields worth rescuing off a clone if the keeper is missing them. Ordered by
// what a human would miss most.
const SALVAGE = [
  ['traderVerdict', ['traderVerdict', 'traderEntry', 'traderStop', 'traderReadAt']],
  ['watch', ['watch', 'watchAt']],
  ['watchNote', ['watchNote']],
  ['alertPrice', ['alertPrice', 'alertSetAt']],
  ['alertHitAt', ['alertHitAt', 'alertHitDate']],
  ['outcome', ['outcome', 'outcomeAt']],
  ['leadToBreakout', ['leadToBreakout']],
  ['leadToTest', ['leadToTest']],
  ['surfacedAt', ['surfacedAt', 'surfacedBarDate', 'surfacedReason']],
  ['testBarDate', ['testBarDate']],
  ['breakoutDate', ['breakoutDate']],
]

const rows = await db.scannerCandidate.findMany({ orderBy: { createdAt: 'asc' } })
console.log(`scanner_candidates: ${rows.length} rows`)

const groups = new Map()
for (const r of rows) {
  const k = key(r)
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(r)
}

const dupGroups = [...groups.values()].filter((g) => g.length > 1)
const plan = []

for (const g of dupGroups) {
  // Oldest first (the findMany is already ordered by createdAt asc).
  const [keeper, ...clones] = g
  const patch = {}
  const salvaged = []

  for (const [probe, fields] of SALVAGE) {
    if (keeper[probe] != null) continue
    const donor = clones.find((c) => c[probe] != null)
    if (!donor) continue
    for (const f of fields) if (donor[f] != null) patch[f] = donor[f]
    salvaged.push(`${probe}←${donor.id.slice(0, 6)}`)
  }

  // Merge every sighting log in the group, deduped by data date. A clone's log
  // is a record of a day this setup was live; losing it would understate how
  // often the same box came back to its edge.
  const seen = new Map()
  for (const r of g) for (const s of (Array.isArray(r.sightings) ? r.sightings : [])) {
    if (s?.barDate && !seen.has(s.barDate)) seen.set(s.barDate, s)
  }
  const merged = [...seen.values()].sort((a, b) => (a.barDate < b.barDate ? -1 : 1))
  if (merged.length > (Array.isArray(keeper.sightings) ? keeper.sightings.length : 0)) {
    patch.sightings = merged
    patch.sightingCount = merged.length
  }

  plan.push({ keeper, cloneIds: clones.map((c) => c.id), patch, salvaged })
}

const doomed = plan.flatMap((p) => p.cloneIds)
const withSalvage = plan.filter((p) => p.salvaged.length)

// Trades point at candidates by a plain column, so a delete would orphan them.
const trades = await db.trade.findMany({
  where: { candidateId: { in: doomed } },
  select: { id: true, ticket: true, pair: true, candidateId: true },
})
const keeperFor = new Map()
for (const p of plan) for (const id of p.cloneIds) keeperFor.set(id, p.keeper.id)

console.log(`\nclone groups        ${plan.length}`)
console.log(`rows to delete      ${doomed.length}`)
console.log(`rows remaining      ${rows.length - doomed.length}`)
console.log(`groups needing salvage off a clone   ${withSalvage.length}`)
console.log(`trades to re-point at the keeper     ${trades.length}`)

for (const p of withSalvage.slice(0, 25)) {
  console.log(`  salvage ${p.keeper.instrument.padEnd(6)} ${iso(p.keeper.rangeStartDate)}  ${p.salvaged.join(' ')}`)
}
for (const t of trades) console.log(`  trade ${t.ticket ?? t.id} (${t.pair}) → ${keeperFor.get(t.candidateId)}`)

// What the audit numbers actually become.
const learnable = (r) =>
  (r.engineVerdict === 'accum' || r.engineVerdict === 'distrib') &&
  (r.outcome === 'up' || r.outcome === 'down')
const hit = (r) =>
  (r.engineVerdict === 'accum' && r.outcome === 'up') ||
  (r.engineVerdict === 'distrib' && r.outcome === 'down')
const keptRows = rows.filter((r) => !doomed.includes(r.id))
const before = rows.filter(learnable)
const after = keptRows.filter(learnable)
console.log(`\naudit, learnable cases   ${before.length} → ${after.length}`)
console.log(`  successes              ${before.filter(hit).length} → ${after.filter(hit).length}`)
console.log(`  failures               ${before.filter((r) => !hit(r)).length} → ${after.filter((r) => !hit(r)).length}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
  await db.$disconnect()
  process.exit(0)
}

console.log('\napplying…')
let patched = 0
for (const p of plan) {
  if (Object.keys(p.patch).length) {
    await db.scannerCandidate.update({ where: { id: p.keeper.id }, data: p.patch })
    patched++
  }
}
for (const t of trades) {
  await db.trade.update({ where: { id: t.id }, data: { candidateId: keeperFor.get(t.candidateId) } })
}
// Chunked: a 9k-element IN list is not something to hand a pooler in one go.
let deleted = 0
for (let i = 0; i < doomed.length; i += 500) {
  const res = await db.scannerCandidate.deleteMany({ where: { id: { in: doomed.slice(i, i + 500) } } })
  deleted += res.count
}
console.log(`keepers patched ${patched} · trades re-pointed ${trades.length} · rows deleted ${deleted}`)
console.log(`scanner_candidates now ${await db.scannerCandidate.count()} rows`)
await db.$disconnect()
