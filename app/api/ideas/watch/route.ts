// app/api/ideas/watch/route.ts
// User clicks "Watch" on an idea card — records the intent without creating a trade.
// Idempotent upsert; can be undone by calling /api/ideas/take or /api/ideas/invalidate later.
//
// Body shape:
//   {
//     pair, direction,
//     grade?, strong?, weak?, divergence?, alertDate?, source?,
//     watchEntryPrice?: number,   // the price you'd have entered at
//     watchSlPrice?: number,      // the swing-low / risk anchor
//   }
//
// When entry+SL are provided we stamp watchStartedAt so the dashboard can show
// "watched since 13:16, +1.2R" — the foundation for the algorithm-strength
// scoreboard.
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
    pair, direction, grade, strong, weak, divergence, alertDate,
    watchEntryPrice, watchSlPrice,
  } = body ?? {}
  const source = body.source ?? 'claude'

  if (!pair || !direction) {
    return NextResponse.json({ error: 'pair + direction required' }, { status: 400 })
  }
  const alertDay = alertDate ? new Date(alertDate) : todayUtcStart()

  // Sanitize the anchor inputs — if either is missing or non-finite, we just
  // record the watch without tracking data, same as the legacy behavior.
  const entry = Number.isFinite(watchEntryPrice) && watchEntryPrice > 0 ? watchEntryPrice : null
  const sl    = Number.isFinite(watchSlPrice)    && watchSlPrice    > 0 ? watchSlPrice    : null
  const hasAnchor = entry !== null && sl !== null && entry !== sl

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
      ...(hasAnchor && {
        watchEntryPrice: entry,
        watchSlPrice: sl,
        watchStartedAt: new Date(),
      }),
    },
    update: {
      userAction: 'watched',
      actedAt: new Date(),
      ...(hasAnchor && {
        watchEntryPrice: entry,
        watchSlPrice: sl,
        // Don't reset watchStartedAt on re-arm — the original armed time is
        // the meaningful baseline for "how long has this been running".
      }),
    },
  })

  return NextResponse.json({ ok: true })
}
