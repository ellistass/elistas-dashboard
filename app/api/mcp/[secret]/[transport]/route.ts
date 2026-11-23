// app/api/mcp/[secret]/[transport]/route.ts
//
// MCP server co-located inside the Elistas Next.js app. Claude.ai connects to
// this URL as a custom connector and gets three tools:
//   • get_scoring_data    — wraps GET /api/scoring/prompt-data?bare=true
//   • save_scoring_result — wraps POST /api/scoring/save
//   • scan_ranges         — wraps POST /api/scanner/run (Wyckoff Range Scanner)
//
// Auth model: the URL itself contains the secret (`[secret]` path segment).
// Anyone who has the full URL can call the tools. Treat the URL like a password.
// Vercel access logs will record it, so rotate MCP_PUBLIC_SECRET if leaked.
//
// We re-use ROUTINE_SECRET for the internal hop (this server → existing
// scoring routes) so we don't introduce a third secret to manage.
import { createMcpHandler } from '@vercel/mcp-adapter'
import { z } from 'zod'
import * as macro from '@/lib/macro/store'
import type { NextRequest } from 'next/server'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://elistas-dashboard.vercel.app'
const INTERNAL_TOKEN = process.env.ROUTINE_SECRET ?? process.env.CRON_SECRET ?? ''

/* ─── RFDM result schema ─────────────────────────────────────────────────
   Mirrors RESPONSE_SHAPE_EXAMPLE in app/api/scoring/prompt-data/route.ts.
   Using a real schema (vs z.any()) means:
     1. claude.ai sees the exact shape required in the tool description
     2. zod parses+validates BEFORE we hand off to /api/scoring/save
     3. clients that stringify nested JSON (a common LLM tool-call quirk)
        are unwrapped by the z.preprocess below
   Only top3, bottom3, pairs9 are strictly required — that matches the
   save route's own validator. Everything else is optional so we don't
   reject a usable result over a missing trailing field. */
const ScoreItem = z
  .object({
    currency: z.string(),
    total: z.number().optional(),
    fundamental: z.number().optional(),
    price: z.number().optional(),
    stddev: z.number().optional(),
    activeStrength: z.boolean().optional(),
    confidence: z.string().optional(),
    holiday: z.boolean().optional(),
    notes: z.array(z.string()).optional(),
    tag: z.string().optional(),
  })
  .passthrough()

const Pair = z
  .object({
    pair: z.string(),
    direction: z.enum(['Long', 'Short']),
    strong: z.string(),
    weak: z.string(),
    strongScore: z.number().optional(),
    weakScore: z.number().optional(),
    divergence: z.number(),
    grade: z.string(),               // A+, A, B, C, Skip — kept loose so new grades don't reject
    session: z.array(z.string()).optional(),
    reason: z.string().optional(),
    timeframe: z.string().optional(),
    pricedInRisk: z.boolean().optional(),
    confidence: z.string().optional(),
  })
  .passthrough()

const Priority1 = z
  .object({
    pair: z.string(),
    direction: z.enum(['Long', 'Short']),
    strong: z.string(),
    weak: z.string(),
    divergence: z.number(),
    grade: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough()

const RfdmResult = z
  .object({
    reasoning: z.string().optional(),
    scores: z.array(ScoreItem).optional(),
    top3: z.array(z.string()).min(1),
    bottom3: z.array(z.string()).min(1),
    neutralCurrencies: z.array(z.string()).optional(),
    excludedCurrencies: z.array(z.string()).optional(),
    excludedReasons: z.array(z.string()).optional(),
    pairs9: z.array(Pair).min(1),
    priority1: Priority1.optional(),
    divergenceWarnings: z.array(z.unknown()).optional(),
    marketCondition: z.string().optional(),
    sessionRecommendation: z.string().optional(),
    date: z.string().optional(),
  })
  .passthrough()

/* Preprocess: accept either a parsed object OR a JSON string. Some MCP
   clients (claude.ai included, when the param is loosely typed) serialize
   nested objects to strings before transmitting. We parse defensively. */
const ResultArg = z.preprocess((v) => {
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return v }
  }
  return v
}, RfdmResult)

function normalizeSecret(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const MCP_SECRET = normalizeSecret(process.env.MCP_PUBLIC_SECRET)

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      'get_scoring_data',
      'Fetch the raw RFDM scoring input (forex perf, std-dev, futures, calendar, central bank rates, sector map, open trades). Returns JSON with userMessage + responseShape — apply RFDM rules from project knowledge then call save_scoring_result.',
      {},
      async () => {
        const r = await fetch(`${APP_URL}/api/scoring/prompt-data?bare=true`, {
          headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` },
          cache: 'no-store',
        })
        const text = await r.text()
        if (!r.ok) {
          return {
            content: [{ type: 'text', text: `prompt-data fetch failed (${r.status}): ${text}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text }] }
      },
    )

    server.tool(
      'save_scoring_result',
      'Save a scored RFDM result and optionally fire Telegram. The `result` argument must be an OBJECT (not a JSON string) matching the responseShape returned by get_scoring_data. Required keys on result: top3 (array of currency codes), bottom3 (array of currency codes), pairs9 (array of pair objects with pair/direction/strong/weak/divergence/grade). Optional but recommended: priority1, scores, reasoning, neutralCurrencies, excludedCurrencies, divergenceWarnings, marketCondition, sessionRecommendation. Body is forwarded to /api/scoring/save.',
      {
        result: ResultArg.describe(
          'The scored RFDM result. Must be a plain object with top3, bottom3, pairs9. Do NOT pass as a JSON string — pass the object directly.',
        ),
        sendTelegram: z.boolean().default(true),
        scoredBy: z.string().default('claude-mcp'),
      },
      async ({ result, sendTelegram, scoredBy }) => {
        // `result` is already a validated object at this point (zod preprocess
        // unwrapped any string-encoded payload, RfdmResult validated shape).
        const r = await fetch(`${APP_URL}/api/scoring/save`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${INTERNAL_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ result, sendTelegram, scoredBy }),
          cache: 'no-store',
        })
        const text = await r.text()
        if (!r.ok) {
          return {
            content: [{ type: 'text', text: `save failed (${r.status}): ${text}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text }] }
      },
    )

    // Wyckoff Range Scanner (spec §10/§12). HARD RULE: the payload returned to
    // the trader contains NO direction verdict, NO entry recommendation, and NO
    // engine verdict — the mechanical accum/distrib call is persisted server-side
    // (scanner_candidates.engineVerdict) for the blind you-vs-engine benchmark
    // only. Do not infer or request a direction from this tool.
    server.tool(
      'scan_ranges',
      'Run the Wyckoff Range Scanner over the ~60-instrument real-volume basket ' +
        '(CME currency/index/commodity futures + US stocks/ETFs, daily bars). ' +
        'Detects horizontal trading ranges and returns FRESH candidates only: ' +
        'ranges still open at a decision point (terminal test just printed or ' +
        'price pressing a boundary) or that broke out within the last ~5 bars. ' +
        'Each candidate has rangeLo/rangeHi, contextPct (trend into the range), ' +
        'terminalTest (spring/upthrust/both/none), stoppingAction, barsInRange, ' +
        'status (open/broken) and breakoutDate. By design it contains NO ' +
        'direction, NO verdict and NO entry advice — the trader reads the chart ' +
        'and decides. Every detected range (fresh or not) is persisted to the DB ' +
        'for the accuracy benchmark. Takes no parameters; allow ~1-2 minutes.',
      {},
      async () => {
        const r = await fetch(`${APP_URL}/api/scanner/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` },
          cache: 'no-store',
        })
        const text = await r.text()
        if (!r.ok) {
          return {
            content: [{ type: 'text', text: `scan_ranges failed (${r.status}): ${text}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text }] }
      },
    )

    /* ─── Macro story framework ──────────────────────────────────────────────
       Direct Prisma via lib/macro/store (no internal HTTP hop needed — same app).
       Every tool returns JSON text; validation problems come back in the result
       (invalid: [...]) rather than as errors, so a run can fix and re-save. */
    const asJson = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] })
    const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: String((e as Error)?.message ?? e) }], isError: true })
    const loose = <T extends z.ZodTypeAny>(s: T) =>
      z.preprocess((v) => { if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } } return v }, s)

    server.tool(
      'get_macro_state',
      'Start of a macro run: open positions + open risk %, the last live run (calls, scores, bank cards), Taiwo\'s edits since that run, pending dashboard requests, and evidence he flagged as wrong.',
      {},
      async () => { try { return asJson(await macro.getState()) } catch (e) { return fail(e) } },
    )

    server.tool(
      'save_macro_run',
      'Create a run for a week (Friday date). Returns runId. Then save evidence, bank cards, calls, scores, positions, and finally finish_macro_run.',
      {
        week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kind: z.enum(['live', 'replay']).default('live'),
        promptA: z.string(),
        promptB: z.string().optional(),
        dataSnapshot: loose(z.record(z.unknown())).optional(),
        notes: z.string().optional(),
      },
      async (a) => { try { const r = await macro.createRun(a); return asJson({ runId: r.id }) } catch (e) { return fail(e) } },
    )

    server.tool(
      'finish_macro_run',
      'Mark a run done or failed.',
      { runId: z.string(), status: z.enum(['done', 'failed']), notes: z.string().optional() },
      async ({ runId, status, notes }) => { try { return asJson(await macro.finishRun(runId, status, notes)) } catch (e) { return fail(e) } },
    )

    const Evidence = z.object({
      ref: z.string().regex(/^E\d+$/), currency: z.string().length(3), kind: z.string(), name: z.string(), value: z.string(),
      expected: z.string().optional(), bankForecast: z.string().optional(), target: z.string().optional(),
      releaseDate: z.string(), source: z.string(), sourceUrl: z.string().optional(),
    })
    server.tool(
      'save_macro_evidence',
      'Save evidence items for a run. Every number a call or bank card uses must be an evidence item with a source and release date. Refs are E1, E2, ... unique within the run.',
      { runId: z.string(), items: loose(z.array(Evidence).min(1)) },
      async ({ runId, items }) => { try { return asJson(await macro.saveEvidence(runId, items)) } catch (e) { return fail(e) } },
    )

    const Card = z.object({
      currency: z.string().length(3), bank: z.string(),
      inflation: z.record(z.unknown()), labour: z.record(z.unknown()), decision: z.record(z.unknown()), pricing: z.record(z.unknown()),
      verdict: z.enum(['strengthening', 'weakening', 'dilemma']),
      stance: z.enum(['more hawkish', 'more dovish', 'neutral']),
      changeView: z.string(), evidenceRefs: z.array(z.string()).default([]),
    }).passthrough()
    server.tool(
      'save_macro_bank_cards',
      'Save the bank cards (one per currency) for a run. Cites evidence refs; cards citing refs not saved in this run come back under invalid.',
      { runId: z.string(), cards: loose(z.array(Card).min(1)) },
      async ({ runId, cards }) => { try { return asJson(await macro.saveBankCards(runId, cards)) } catch (e) { return fail(e) } },
    )

    const Call = z.object({
      pair: z.string().regex(/^[A-Z]{6}$/), version: z.enum(['A', 'B']),
      direction: z.enum(['UP', 'DOWN', 'NONE']), confidence: z.number().int().min(1).max(3), reason: z.string().min(10),
    })
    server.tool(
      'save_macro_calls',
      'Save pair calls. A = tested briefing prompt (drives trades), B = bank-card prompt (logged only). The reason must cite evidence like [E12]; UP/DOWN calls with no citation, or citing missing refs, come back under invalid and are stored valid=false.',
      { runId: z.string(), calls: loose(z.array(Call).min(1)) },
      async ({ runId, calls }) => { try { return asJson(await macro.saveCalls(runId, calls)) } catch (e) { return fail(e) } },
    )

    const Score = z.object({
      pair: z.string().regex(/^[A-Z]{6}$/), regime: z.string(), role: z.string(), divergence: z.number().nullable().optional(),
      alignment: z.number().int(), riskPct: z.number().min(0).max(2), components: z.record(z.unknown()),
    })
    server.tool(
      'save_macro_scores',
      'Save regime / divergence / alignment score and risk % per pair for a run (from the version A calls).',
      { runId: z.string(), scores: loose(z.array(Score).min(1)) },
      async ({ runId, scores }) => { try { return asJson(await macro.saveScores(runId, scores)) } catch (e) { return fail(e) } },
    )

    const PosOp = z.discriminatedUnion('action', [
      z.object({
        action: z.literal('open'),
        position: z.object({
          pair: z.string(), side: z.enum(['long', 'short']), unit: z.number().int().min(1).max(3).default(1),
          openedWeek: z.string(), openedRunId: z.string().optional(), entry: z.number(), stop: z.number(),
          stopMode: z.enum(['1R', '2R_close', 'swing']), riskPct: z.number(),
        }),
      }),
      z.object({ action: z.enum(['update', 'close']), id: z.string(), changes: z.record(z.unknown()), reason: z.string() }),
    ])
    server.tool(
      'update_macro_positions',
      'Open, update or close positions. Updates/closes are logged in the edit history (by claude). Respect Taiwo\'s skips, fills and stops from get_macro_state.',
      { ops: loose(z.array(PosOp).min(1)) },
      async ({ ops }) => { try { return asJson(await macro.updatePositions(ops)) } catch (e) { return fail(e) } },
    )

    server.tool(
      'apply_macro_edit',
      'Edit one whitelisted field (position status/stop/risk/exit/user fields, evidence flag, call/card notes, call outcome). Logged with old and new value. Use by="claude".',
      {
        entity: z.enum(['position', 'evidence', 'call', 'card']), id: z.string(), field: z.string(),
        value: loose(z.unknown()), reason: z.string(),
      },
      async (a) => { try { return asJson(await macro.applyEdit({ ...a, by: 'claude' })) } catch (e) { return fail(e) } },
    )

    server.tool(
      'complete_macro_request',
      'Mark a pending dashboard request done, with a short result.',
      { id: z.string(), result: z.string() },
      async ({ id, result }) => { try { return asJson(await macro.completeRequest(id, result)) } catch (e) { return fail(e) } },
    )

    server.tool(
      'get_macro_evidence',
      'Read the evidence for a run (all, or only some refs).',
      { runId: z.string(), refs: z.array(z.string()).optional() },
      async ({ runId, refs }) => { try { return asJson(await macro.getEvidence(runId, refs)) } catch (e) { return fail(e) } },
    )
  },
  {},
  {
    streamableHttpEndpoint: `/api/mcp/${MCP_SECRET}/mcp`,
    sseEndpoint: `/api/mcp/${MCP_SECRET}/sse`,
    sseMessageEndpoint: `/api/mcp/${MCP_SECRET}/message`,
  },
)

// Wrap the MCP handler so the URL secret is checked before any tool can run.
// Mismatched/missing secret returns 404 (not 401) — don't tell scanners the
// path exists.
async function gated(
  req: NextRequest,
  ctx: { params: { secret: string; transport: string } },
): Promise<Response> {
  const expected = MCP_SECRET
  const pathSecret = req.nextUrl.pathname.split('/')[3]
  const provided = normalizeSecret(pathSecret ?? ctx.params?.secret)
  if (!expected || provided !== expected) {
    return new Response('Not found', { status: 404 })
  }
  // @vercel/mcp-adapter expects (req) and reads transport from the URL itself.
  return (mcpHandler as unknown as (r: NextRequest) => Promise<Response>)(req)
}

export const dynamic = 'force-dynamic'
export { gated as GET, gated as POST, gated as DELETE }
