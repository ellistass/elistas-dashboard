// lib/macro/store.ts
//
// Storage for the macro story framework. Used by the MCP tools (Claude, by = "claude")
// and later by the dashboard API routes (Taiwo, by = "taiwo"). One rule everywhere:
// calls, cards and evidence are a permanent record — changes go through applyEdit,
// which only touches whitelisted fields and logs old -> new in MacroEdit.
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// Macro* models are new: until `npm run db:push` regenerates the Prisma client the generated types
// don't know them, so go through an untyped handle (same approach CLAUDE.md suggests).
const mdb = db as any

const REF = /\[(E\d+)\]/g

/** Evidence refs cited in a piece of text, e.g. "jobs past the RBA path [E12]" -> ["E12"]. */
export function citedRefs(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(REF), (m) => m[1])))
}

async function knownRefs(runId: string): Promise<Set<string>> {
  const rows = await mdb.macroEvidence.findMany({ where: { runId }, select: { ref: true } })
  return new Set(rows.map((r: { ref: string }) => r.ref))
}

// ─── state for the start of a run ───────────────────────────────────────
export async function getState() {
  const lastRun = await mdb.macroRun.findFirst({
    where: { status: 'done', kind: 'live' },
    orderBy: { createdAt: 'desc' },
    include: { calls: true, scores: true, cards: true },
  })
  const positions = await mdb.macroPosition.findMany({ where: { status: 'open' }, orderBy: { pair: 'asc' } })
  const since = lastRun?.createdAt ?? new Date(0)
  const edits = await mdb.macroEdit.findMany({ where: { by: 'taiwo', createdAt: { gt: since } }, orderBy: { createdAt: 'asc' } })
  const requests = await mdb.macroRequest.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } })
  const flagged = await mdb.macroEvidence.findMany({ where: { flagged: true, createdAt: { gt: new Date(Date.now() - 60 * 86400e3) } } })
  const openRiskPct = positions.reduce((s: number, p: any) => {
    const stop = p.userStop ?? p.stop
    const entry = p.userFill ?? p.entry
    const atRisk = p.side === 'long' ? stop < entry : stop > entry
    return s + (atRisk ? p.riskPct : 0)
  }, 0)
  return { lastRun, positions, openRiskPct, editsSinceLastRun: edits, pendingRequests: requests, flaggedEvidence: flagged }
}

// ─── writes from the Friday run ─────────────────────────────────────────
export async function createRun(a: { week: string; kind?: string; promptA: string; promptB?: string; dataSnapshot?: unknown; notes?: string }) {
  return mdb.macroRun.create({ data: { ...a, dataSnapshot: (a.dataSnapshot ?? undefined) as any } })
}

export async function finishRun(runId: string, status: 'done' | 'failed', notes?: string) {
  return mdb.macroRun.update({ where: { id: runId }, data: { status, notes } })
}

export type EvidenceIn = {
  ref: string; currency: string; kind: string; name: string; value: string; expected?: string
  bankForecast?: string; target?: string; releaseDate: string; source: string; sourceUrl?: string
}
export async function saveEvidence(runId: string, items: EvidenceIn[]) {
  for (const e of items) {
    await mdb.macroEvidence.upsert({ where: { runId_ref: { runId, ref: e.ref } }, create: { runId, ...e }, update: { ...e } })
  }
  return { saved: items.length }
}

/** Saves cards; a card citing a ref that is not in this run's evidence is saved with valid=false and reported back. */
export async function saveBankCards(runId: string, cards: any[]) {
  const known = await knownRefs(runId)
  const bad: { currency: string; missing: string[] }[] = []
  for (const c of cards) {
    const refs = Array.from(new Set([...(c.evidenceRefs ?? []), ...citedRefs(JSON.stringify(c))]))
    const missing = refs.filter((r) => !known.has(r))
    if (missing.length) bad.push({ currency: c.currency, missing })
    const { bank, inflation, labour, decision, pricing, verdict, stance, changeView } = c   // drop any extra keys the model adds
    const data = { bank, inflation, labour, decision, pricing, verdict, stance, changeView, evidenceRefs: refs, valid: missing.length === 0 }
    await mdb.macroBankCard.upsert({ where: { runId_currency: { runId, currency: c.currency } }, create: { runId, currency: c.currency, ...data }, update: data })
  }
  return { saved: cards.length, invalid: bad }
}

export type CallIn = { pair: string; version: 'A' | 'B'; direction: 'UP' | 'DOWN' | 'NONE'; confidence: number; reason: string }
export async function saveCalls(runId: string, calls: CallIn[]) {
  const known = await knownRefs(runId)
  const bad: { pair: string; version: string; problem: string }[] = []
  for (const c of calls) {
    const refs = citedRefs(c.reason)
    const missing = refs.filter((r) => !known.has(r))
    let problem = ''
    if (c.direction !== 'NONE' && refs.length === 0) problem = 'reason cites no evidence'
    else if (missing.length) problem = `cites missing ${missing.join(', ')}`
    if (problem) bad.push({ pair: c.pair, version: c.version, problem })
    const data = { ...c, evidenceRefs: refs, valid: !problem }
    await mdb.macroCall.upsert({ where: { runId_pair_version: { runId, pair: c.pair, version: c.version } }, create: { runId, ...data }, update: data })
  }
  return { saved: calls.length, invalid: bad }
}

export async function saveScores(runId: string, scores: any[]) {
  for (const s of scores) {
    await mdb.macroScore.upsert({ where: { runId_pair: { runId, pair: s.pair } }, create: { runId, ...s }, update: s })
  }
  return { saved: scores.length }
}

/** Story-divergence setups for a run (all 28 pairs). Replaces the run's previous set. */
export async function saveStories(runId: string, stories: any[]) {
  await mdb.macroStory.deleteMany({ where: { runId } })
  for (const s of stories) await mdb.macroStory.create({ data: { runId, ...s } })
  return { saved: stories.length }
}

/** Position changes from the run. Opens create rows; updates/closes are logged as edits by claude. */
export async function updatePositions(ops: any[]) {
  const out: string[] = []
  for (const op of ops) {
    if (op.action === 'open') {
      const p = await mdb.macroPosition.create({ data: op.position })
      out.push(`opened ${p.pair} ${p.side} unit ${p.unit} (${p.id})`)
    } else if (op.action === 'update' || op.action === 'close') {
      for (const [field, value] of Object.entries(op.changes ?? {})) {
        await applyEdit({ entity: 'position', id: op.id, field, value, reason: op.reason ?? op.action, by: 'claude' })
      }
      out.push(`${op.action} ${op.id}`)
    }
  }
  return { done: out }
}

// ─── edits (both sides) ─────────────────────────────────────────────────
const EDITABLE: Record<string, { model: any; fields: string[] }> = {
  position: { model: () => mdb.macroPosition, fields: ['status', 'stop', 'riskPct', 'closedWeek', 'exitPrice', 'exitReason', 'userFill', 'userStop', 'userNote'] },
  evidence: { model: () => mdb.macroEvidence, fields: ['flagged', 'flagNote'] },
  call: { model: () => mdb.macroCall, fields: ['userNote', 'outcome'] },
  card: { model: () => mdb.macroBankCard, fields: ['userNote'] },
}
// Fields only the run itself may change (Taiwo uses userFill/userStop/status instead).
const CLAUDE_ONLY = new Set(['stop', 'outcome'])

export async function applyEdit(a: { entity: string; id: string; field: string; value?: unknown; reason: string; by: 'taiwo' | 'claude' }) {
  const spec = EDITABLE[a.entity]
  if (!spec || !spec.fields.includes(a.field)) throw new Error(`${a.entity}.${a.field} is not editable`)
  if (a.by === 'taiwo' && CLAUDE_ONLY.has(a.field)) throw new Error(`${a.field} is set by the run; use userStop / userNote instead`)
  const model = spec.model()
  const before = await model.findUnique({ where: { id: a.id } })
  if (!before) throw new Error(`${a.entity} ${a.id} not found`)
  await model.update({ where: { id: a.id }, data: { [a.field]: a.value } })
  await mdb.macroEdit.create({
    data: { entity: a.entity, entityId: a.id, field: a.field, oldValue: (before[a.field] ?? null) as any, newValue: (a.value ?? null) as any, reason: a.reason, by: a.by },
  })
  return { ok: true, entity: a.entity, id: a.id, field: a.field, from: before[a.field] ?? null, to: a.value }
}

// ─── requests queue (dashboard button -> next run) ──────────────────────
export async function queueRequest(type: string, payload: unknown) {
  return mdb.macroRequest.create({ data: { type, payload: payload as any } })
}
export async function completeRequest(id: string, result: string) {
  return mdb.macroRequest.update({ where: { id }, data: { status: 'done', result, doneAt: new Date() } })
}

// ─── reads for the pair page ────────────────────────────────────────────
export async function getEvidence(runId: string, refs?: string[]) {
  return mdb.macroEvidence.findMany({ where: { runId, ...(refs?.length ? { ref: { in: refs } } : {}) }, orderBy: { ref: 'asc' } })
}

// ─── reads for the /macro page ──────────────────────────────────────────
/** Run list (newest first) + one run in full (default: latest done live run) + all positions. */
export async function getRunView(runId?: string) {
  const runs = await mdb.macroRun.findMany({
    orderBy: { createdAt: 'desc' }, take: 52,
    select: { id: true, week: true, kind: true, status: true, createdAt: true },
  })
  const id = runId ?? runs.find((r: any) => r.status === 'done' && r.kind === 'live')?.id ?? runs[0]?.id
  const run = id
    ? await mdb.macroRun.findUnique({
        where: { id },
        include: { evidence: { orderBy: { createdAt: 'asc' } }, cards: true, calls: true, scores: true, stories: { orderBy: { gap: 'desc' } } },
      })
    : null
  const positions = await mdb.macroPosition.findMany({ orderBy: [{ status: 'asc' }, { pair: 'asc' }] })
  // running record: every scored call (outcome filled 4 weeks later)
  const record = await mdb.macroCall.findMany({
    where: { version: 'A', outcome: { not: Prisma.AnyNull } },   // JSON column: Prisma needs AnyNull, not null
    include: { run: { select: { week: true } } }, orderBy: { createdAt: 'desc' }, take: 200,
  })
  return { runs, run, positions, record }
}
