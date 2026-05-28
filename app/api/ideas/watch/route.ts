// app/api/ideas/watch/route.ts
// User clicks "Watch" on an idea card — records the intent without creating a trade.
// Idempotent upsert; can be undone by calling /api/ideas/take or /api/ideas/invalidate later.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function todayUtcStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { pair, direction, grade, strong, weak, divergence, alertDate } = body ?? {}
  const source = body.source ?? 'claude'

  if (!pair || !direction) {
    return NextResponse.json({ error: 'pair + direction required' }, { status: 400 })
  }
  const alertDay = alertDate ? new Date(alertDate) : todayUtcStart()

  await (db as any).ideaOutcome.upsert({
    where: {
      alertDate_pair_direction_source: {
        alertDate: alertDay, pair, direction, source,
      },
    },
    create: {
      alertDate: alertDay,
      pair, direction,
      grade: grade ?? 'C',
      strong: strong ?? '',
      weak: weak ?? '',
      divergence: divergence ?? 0,
      source,
      userAction: 'watched',
      actedAt: new Date(),
      outcome: 'Pending',
    },
    update: {
      userAction: 'watched',
      actedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
