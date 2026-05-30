// app/api/scoring/save/route.ts
// Routine endpoint — accepts a scoring result from Claude Desktop's routine
// (running on the user's subscription, not API credits) and saves it as
// today's DailyAlert. Also fires Telegram if requested.
//
// Idempotent on (alertDate). Repeat POSTs for the same day overwrite the
// previous result, so a routine that re-runs simply refreshes the analysis.
//
// Auth: Bearer ROUTINE_SECRET.
//
// Body shape:
//   {
//     result:        NormalisedScoringResult   // shape matching responseShape
//                                              // returned by /api/scoring/prompt-data
//     sendTelegram?: boolean                   // default false
//     scoredBy?:     string                    // free-text label, default "routine"
//   }
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { formatTelegramAlertAI } from '@/lib/ai-scoring'
import { sendTelegramMessage } from '@/lib/telegram'
import { normalizeRanking } from '@/lib/normalize-ranking'

export const dynamic = 'force-dynamic'

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const expected = process.env.ROUTINE_SECRET ?? process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

function todayUtcStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function currentWatSession(): string {
  const h = (new Date().getUTCHours() + 1) % 24
  if (h >= 1 && h < 7)  return 'Tokyo'
  if (h >= 8 && h < 13) return 'London'
  if (h >= 13 && h < 15) return 'Pre-NY'
  if (h >= 15 && h < 22) return 'New York'
  return 'Off-hours'
}

// normalizeRanking moved to lib/normalize-ranking.ts (also used by the
// dashboard route on read).

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { result, sendTelegram = false, scoredBy = 'routine' } = body ?? {}
  if (!result || !result.top3 || !result.bottom3 || !result.pairs9) {
    return NextResponse.json({ error: 'result must include top3, bottom3, pairs9' }, { status: 400 })
  }

  // Normalize ranking arrays to the {cur, score, ...} shape the dashboard
  // expects. Preserves the original strings/objects in fullAnalysis for
  // audit, but persists the structured form for top3/bottom3.
  const top3 = normalizeRanking(result.top3, result.scores)
  const bottom3 = normalizeRanking(result.bottom3, result.scores)

  const today = todayUtcStart()

  // Save / upsert today's DailyAlert
  await (db.dailyAlert.upsert as any)({
    where: { date: today },
    create: {
      date: today,
      top3,
      bottom3,
      pairs9: result.pairs9,
      priority1: result.priority1 ?? result.pairs9?.[0] ?? {},
      ideas: result.ideas ?? result.pairs9 ?? null,
      scoringModel: scoredBy,
      fullAnalysis: {
        ...result,
        scoredBy,
        savedVia: 'routine',
      } as any,
      sentAt: sendTelegram ? new Date() : null,
    },
    update: {
      top3,
      bottom3,
      pairs9: result.pairs9,
      priority1: result.priority1 ?? result.pairs9?.[0] ?? {},
      ideas: result.ideas ?? result.pairs9 ?? undefined,
      scoringModel: scoredBy,
      fullAnalysis: {
        ...result,
        scoredBy,
        savedVia: 'routine',
      } as any,
      sentAt: sendTelegram ? new Date() : undefined,
    },
  })

  // Create / refresh IdeaOutcome rows so the dashboard and scoreboard pick up
  // the routine's ideas (same logic /api/alerts uses after scoring with the API).
  try {
    const ideas = (result.ideas as any[] | undefined) ?? (result.priority1 ? [result.priority1] : (result.pairs9 ?? []))
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i]
      if (!idea?.pair || !idea?.direction) continue
      await (db as any).ideaOutcome.upsert({
        where: {
          alertDate_pair_direction_source: {
            alertDate: today, pair: idea.pair, direction: idea.direction, source: 'claude',
          },
        },
        create: {
          alertDate: today,
          pair: idea.pair, direction: idea.direction,
          grade: idea.grade ?? 'C',
          strong: idea.strong ?? '',
          weak: idea.weak ?? '',
          divergence: idea.divergence ?? 0,
          source: 'claude',
          priorityRank: i + 1,
          userAction: 'none',
          outcome: 'Pending',
        },
        update: {
          grade: idea.grade ?? 'C',
          strong: idea.strong ?? '',
          weak: idea.weak ?? '',
          divergence: idea.divergence ?? 0,
          priorityRank: i + 1,
        },
      })
    }
  } catch (err) {
    console.error('[scoring/save] IdeaOutcome upsert non-fatal warning:', err)
  }

  // Telegram alert
  let telegramSent = false
  if (sendTelegram) {
    try {
      const session = currentWatSession()
      const msg = formatTelegramAlertAI(result as any, session)
      await sendTelegramMessage(msg)
      telegramSent = true
    } catch (err) {
      console.error('[scoring/save] Telegram send failed:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    alertDate: today,
    sourceLabel: scoredBy,
    telegramSent,
  })
}
