// app/api/mcp/[secret]/[transport]/route.ts
//
// MCP server co-located inside the Elistas Next.js app. Claude.ai connects to
// this URL as a custom connector and gets two tools:
//   • get_scoring_data    — wraps GET /api/scoring/prompt-data?bare=true
//   • save_scoring_result — wraps POST /api/scoring/save
//
// Auth model: the URL itself contains the secret (`[secret]` path segment).
// Anyone who has the full URL can call the tools. Treat the URL like a password.
// Vercel access logs will record it, so rotate MCP_PUBLIC_SECRET if leaked.
//
// We re-use ROUTINE_SECRET for the internal hop (this server → existing
// scoring routes) so we don't introduce a third secret to manage.
import { createMcpHandler } from '@vercel/mcp-adapter'
import { z } from 'zod'
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
