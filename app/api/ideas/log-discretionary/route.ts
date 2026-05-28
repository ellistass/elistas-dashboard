// app/api/ideas/log-discretionary/route.ts
// User logs their own setup — purely for tracking, no position created.
// Creates an IdeaOutcome row with source='user-discretionary'.
//
// The daily idea-outcome cron evaluates these the same way it evaluates
// Claude's ideas — using next-day price action. That lets the algorithm
// scoreboard compare YOU vs CLAUDE on directional accuracy, grade hit rate, etc.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function todayUtcStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function inferSession(): string {
  // WAT = UTC+1; default session by current Lagos time
  const h = (new Date().getUTCHours() + 1) % 24
  if (h >= 1 && h < 7) return 'Tokyo'
  if (h >= 8 && h < 13) return 'London'
  if (h >= 13 && h < 15) return 'Pre-NY'
  if (h >= 15 && h < 22) return 'New York'
  return 'Off-hours'
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    pair, direction, grade,
    strong, weak, userModel, reason,
    session, divergence,
  } = body ?? {}

  if (!pair || !direction || !grade) {
    return NextResponse.json({ error: 'pair + direction + grade required' }, { status: 400 })
  }
  if (direction !== 'Long' && direction !== 'Short') {
    return NextResponse.json({ error: 'direction must be Long or Short' }, { status: 400 })
  }

  const alertDay = todayUtcStart()

  const row = await (db as any).ideaOutcome.upsert({
    where: {
      alertDate_pair_direction_source: {
        alertDate: alertDay, pair, direction, source: 'user-discretionary',
      },
    },
    create: {
      alertDate: alertDay,
      pair, direction,
      grade,
      strong: strong ?? '',
      weak: weak ?? '',
      divergence: typeof divergence === 'number' ? divergence : 0,
      source: 'user-discretionary',
      userModel: userModel ?? null,
      userReason: reason ?? null,
      userSession: session ?? inferSession(),
      userAction: 'none',
      outcome: 'Pending',
    },
    update: {
      // Allow editing the metadata on a previously-logged discretionary idea
      grade,
      strong: strong ?? undefined,
      weak: weak ?? undefined,
      divergence: typeof divergence === 'number' ? divergence : undefined,
      userModel: userModel ?? undefined,
      userReason: reason ?? undefined,
      userSession: session ?? undefined,
    },
  })

  return NextResponse.json({ ok: true, id: row.id })
}
