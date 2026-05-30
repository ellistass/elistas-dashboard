// app/api/scoring/routine-config/route.ts
// Returns pre-filled prompts the user pastes into their claude.ai Project
// Routine. The Project must have the "Elistas RFDM" MCP connector enabled
// (Settings → Connectors → custom connector pointing at /api/mcp/<secret>/mcp),
// which exposes get_scoring_data and save_scoring_result as tools.
// Authed by NextAuth (the user must be logged into the dashboard).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ROUTINE_SCHEDULES_WAT = ['08:00', '12:00', '14:00', '16:00', '19:00', '22:00']

function watToUtcCron(watTime: string): string {
  const [hh, mm] = watTime.split(':').map((s) => parseInt(s, 10))
  // WAT = UTC + 1; subtract 1 hour
  let utcH = (hh - 1 + 24) % 24
  return `${mm} ${utcH} * * 1-5`
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://elistas-dashboard.vercel.app'
  const mcpSecret = process.env.MCP_PUBLIC_SECRET ?? ''
  const mcpUrl = mcpSecret ? `${appUrl}/api/mcp/${mcpSecret}/mcp` : null

  // Routine prompt — pastes into a claude.ai Project Routine.
  // Relies on the MCP connector for auth + URLs (no bearer tokens in the
  // prompt body). Relies on Project Knowledge (strategy.md, prompt.md) for
  // the RFDM rules.
  const routinePrompt = `Run my Elistas RFDM scoring routine.

This runs inside my trading Project on claude.ai. The Elistas RFDM connector
must be enabled for this Project — it exposes get_scoring_data and
save_scoring_result. Project Knowledge (strategy.md, prompt.md) defines the
RFDM rules. Apply those rules — do not re-derive them.

1. Call get_scoring_data. You'll receive { userMessage, responseShape,
   dataAgeMinutes }.

2. If dataAgeMinutes > 90, stop — the Barchart sync is stale. Log a note
   and exit without scoring.

3. Apply the RFDM framework FROM PROJECT KNOWLEDGE:
   - Four pillars: fundamentals, price performance, std dev, futures
   - Active-vs-passive strength filter (a currency is only genuinely strong
     when it's the base in 2+ pairs moving its way)
   - Build the 9-pair matrix (top 3 strong × bottom 3 weak)
   - priority1 = #1 strong × #1 weak (NOT highest divergence)
   - Self-check: any currency with passive/below-threshold/holiday notes goes
     to neutralCurrencies, not top3/bottom3

4. Call save_scoring_result with:
   - result: your scored JSON matching responseShape
   - sendTelegram: true
   - scoredBy: "routine-mcp"

5. Return:
   - priority1 (pair, direction, grade, divergence, 1-line reason)
   - All pairs9 entries where grade ≠ "Skip", sorted by divergence descending
     (pair, direction, grade, divergence each)
   - If any were Skip, just the count: "N skipped (low divergence)"
   - neutralCurrencies and excludedCurrencies with reasons, if non-empty`

  // Manual trigger prompt — shorter, for on-demand scoring inside a Project
  // chat (not a Routine).
  const triggerPrompt = `Score the markets now using my RFDM rules from project knowledge.

1. Call get_scoring_data.
2. Apply strategy.md + prompt.md rules. Build top3/bottom3/pairs9/priority1.
3. Call save_scoring_result with result, sendTelegram: true,
   scoredBy: "manual-chat".
4. Return priority1 and any pairs9 entries where grade ≠ "Skip".`

  return NextResponse.json({
    mcpUrl,
    mcpConfigured: Boolean(mcpSecret),
    routinePrompt,
    triggerPrompt,
    schedules: {
      wat: ROUTINE_SCHEDULES_WAT,
      utcCron: ROUTINE_SCHEDULES_WAT.map(watToUtcCron),
      humanReadable: '8am, 12pm, 2pm, 4pm, 7pm, 10pm WAT (Mon–Fri)',
    },
    setup: {
      step1: 'Register the connector in claude.ai → Settings → Connectors → Add custom connector. Paste mcpUrl.',
      step2: 'Open your trading Project → Connectors → toggle Elistas RFDM on.',
      step3: 'Paste routinePrompt into a new Project Routine with the schedule above.',
    },
  })
}
