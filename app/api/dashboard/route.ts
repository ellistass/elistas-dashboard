// app/api/dashboard/route.ts
// Returns everything the live dashboard needs in one request:
// - Today's latest scoring result (with auto-fetch if stale)
// - Open trades with current alignment status
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreCurrenciesFromData, checkTradeAlignment } from '@/lib/scoring'
import { fetchAllMarketData } from '@/lib/fetchers'

export async function GET() {
  try {
    // ── 1. Fetch live market data ──────────────────────────────────────────────
    const { perfMap, calEvents, fetchedAt, errors } = await fetchAllMarketData()

    let scores = null
    let fetchErrors = errors

    if (Object.keys(perfMap).length > 0) {
      scores = scoreCurrenciesFromData(perfMap, calEvents)
    } else {
      // Fall back to today's saved scores from DB
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const saved = await db.dailyAlert.findUnique({ where: { date: today } })
      if (saved) {
        scores = {
          top3: saved.top3 as any,
          bottom3: saved.bottom3 as any,
          pairs9: saved.pairs9 as any,
          priority1: saved.priority1 as any,
          allScores: [],
          generatedAt: saved.createdAt,
        }
      }
    }

    // ── 2. Open trades with alignment ─────────────────────────────────────────
    const openTrades = await db.trade.findMany({
      where: { outcome: 'Open' },
      orderBy: { date: 'desc' },
      include: {
        alignments: {
          orderBy: { checkedAt: 'desc' },
          take: 1, // most recent alignment check
        },
      },
    })

    // Run a live alignment check for each open trade
    const tradesWithAlignment = openTrades.map(trade => {
      let alignmentStatus: 'Green' | 'Amber' | 'Red' | 'Unknown' = 'Unknown'
      let alignmentReason = 'No scores available'

      if (scores) {
        const check = checkTradeAlignment(trade, scores)
        alignmentStatus = check.status
        alignmentReason = check.reason
      }

      return {
        ...trade,
        alignmentStatus,
        alignmentReason,
        lastAlignmentCheck: trade.alignments[0] || null,
      }
    })

    // ── 3. Return combined payload ─────────────────────────────────────────────
    return NextResponse.json({
      scores,
      openTrades: tradesWithAlignment,
      fetchedAt,
      fetchErrors,
      hasLiveData: Object.keys(perfMap).length > 0,
    })
  } catch (err) {
    console.error('Dashboard error:', err)
    return NextResponse.json({ error: 'Dashboard fetch failed' }, { status: 500 })
  }
}
