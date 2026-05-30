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
      'Save a scored RFDM result (must include top3/bottom3/pairs9; priority1 recommended) and optionally fire Telegram. Body is forwarded to /api/scoring/save.',
      {
        result: z.any().describe('The scored JSON matching responseShape from get_scoring_data'),
        sendTelegram: z.boolean().default(true),
        scoredBy: z.string().default('claude-mcp'),
      },
      async ({ result, sendTelegram, scoredBy }) => {
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
