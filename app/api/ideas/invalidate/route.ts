// app/api/ideas/invalidate/route.ts
// User explicitly skips an idea with an optional reason.
// Feeds the "invalidation accuracy" metric on the algorithm scoreboard:
//   how often were your skips actually correct?
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
  const {
    pair, direction, grade, strong, weak, divergence,
    invalidationReason, alertDate,
  } = body ?? {}
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
      userAction: 'invalidated',
      actedAt: new Date(),
      invalidationReason: invalidationReason ?? null,
      outcome: 'Pending',
    },
    update: {
      userAction: 'invalidated',
      actedAt: new Date(),
      invalidationReason: invalidationReason ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
