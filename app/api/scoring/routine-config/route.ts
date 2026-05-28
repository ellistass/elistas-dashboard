// app/api/scoring/routine-config/route.ts
// Returns the routine secret + a pre-filled prompt the user can paste into
// Claude Desktop's Routine creator. Authed by NextAuth (the user must be
// logged into the dashboard to see their own secret).
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

  const secret = process.env.ROUTINE_SECRET ?? process.env.CRON_SECRET ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://elistas-dashboard.vercel.app'

  // bare=true: lighter payload because the Project's Knowledge already has
  // the system prompt (strategy.md / prompt.md). Don't ship it twice.
  const promptDataUrl = `${appUrl}/api/scoring/prompt-data?bare=true`
  const saveUrl       = `${appUrl}/api/scoring/save`

  // Pre-baked prompt the user pastes into their Elistas Project's routine.
  // Designed to LEAN ON Project Knowledge (strategy.md, prompt.md) rather than
  // duplicate the RFDM rules in the prompt itself.
  const routinePrompt = `Run my Elistas RFDM scoring routine.

This routine runs inside my trading project on claude.ai — it has access to
strategy.md, prompt.md, and the rest of my RFDM context already loaded in
Project Knowledge. Apply those rules from project knowledge — do not re-derive
them from scratch.

1. Fetch GET ${promptDataUrl}
   with header: Authorization: Bearer ${secret}
   You'll receive { userMessage, responseShape, dataAgeMinutes }.

2. Apply the RFDM framework FROM PROJECT KNOWLEDGE (strategy.md + prompt.md):
   - Four pillars: fundamentals, price performance, std dev, futures
   - Active-vs-passive strength filter (a currency is only genuinely strong
     when it's the base in 2+ pairs moving its way)
   - Build the 9-pair matrix (top 3 strong × bottom 3 weak)
   - Identify priority1 (#1 strong × #1 weak — NOT highest divergence)
   - Run the self-check before returning: any currency with passive/below-
     threshold/holiday notes goes to neutralCurrencies, not top3/bottom3

3. Return ONLY valid JSON matching responseShape exactly — no markdown fences,
   no explanation around the JSON.

4. POST that JSON to ${saveUrl}
   with headers:
     Authorization: Bearer ${secret}
     Content-Type: application/json
   Body: { "result": <your-json>, "sendTelegram": true, "scoredBy": "routine-project" }

If the dataAgeMinutes is greater than 90, stop — the Barchart sync is stale,
log a note and exit.`

  // Manual trigger prompt — shorter, designed for pasting into the trading
  // project chat in Claude Desktop for on-demand scoring (not a routine).
  const triggerPrompt = `Score the markets now using my RFDM rules from project knowledge.

1. GET ${promptDataUrl}
   Authorization: Bearer ${secret}

2. Apply strategy.md + prompt.md rules to userMessage. Build top3/bottom3/pairs9/priority1.

3. POST result to ${saveUrl}
   Authorization: Bearer ${secret}
   Body: { "result": <json>, "sendTelegram": true, "scoredBy": "manual-chat" }

Return only the priority1 pair + a 1-line "sent" confirmation.`

  return NextResponse.json({
    promptDataUrl,
    saveUrl,
    secret,
    routinePrompt,
    triggerPrompt,
    schedules: {
      wat: ROUTINE_SCHEDULES_WAT,
      utcCron: ROUTINE_SCHEDULES_WAT.map(watToUtcCron),
      humanReadable: '8am, 12pm, 2pm, 4pm, 7pm, 10pm WAT (Mon–Fri)',
    },
  })
}
