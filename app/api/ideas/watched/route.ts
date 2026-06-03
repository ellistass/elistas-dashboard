// app/api/ideas/watched/route.ts
// Returns every currently-watched IdeaOutcome row so the dashboard can render
// the Watch panel. Includes the entry / SL anchor and whatever live-price
// snapshot has been written by the cron / EA price feed. Live price refresh
// is handled separately by /api/cron/refresh-watched-prices (TODO) — this
// endpoint is purely a read of the persisted state.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const rows = await (db as any).ideaOutcome.findMany({
    where: { userAction: 'watched' },
    orderBy: { actedAt: 'desc' },
    select: {
      id: true,
      alertDate: true,
      pair: true,
      direction: true,
      grade: true,
      strong: true,
      weak: true,
      divergence: true,
      source: true,
      actedAt: true,
      watchEntryPrice: true,
      watchSlPrice: true,
      watchStartedAt: true,
      watchLastPrice: true,
      watchPeakR: true,
      watchTroughR: true,
      watchLastSeenAt: true,
    },
  })

  // Compute current R-multiple if we have both an anchor AND a last-seen price.
  // The price feed itself is plugged in elsewhere — here we just shape the row.
  const watched = rows.map((r: any) => {
    const hasAnchor = r.watchEntryPrice != null && r.watchSlPrice != null
    const hasPrice  = r.watchLastPrice != null

    let currentR: number | null = null
    if (hasAnchor && hasPrice) {
      const risk = Math.abs(r.watchEntryPrice - r.watchSlPrice)
      if (risk > 0) {
        const move = r.direction === 'Long'
          ? r.watchLastPrice - r.watchEntryPrice
          : r.watchEntryPrice - r.watchLastPrice
        currentR = Number((move / risk).toFixed(2))
      }
    }

    return {
      ...r,
      hasAnchor,
      currentR,
    }
  })

  return NextResponse.json({ watched })
}
