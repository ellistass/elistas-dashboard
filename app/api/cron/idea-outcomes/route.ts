// app/api/cron/idea-outcomes/route.ts — daily 22:00 WAT (21:00 UTC) cron.
//
// Evaluates yesterday's ideas (both Claude's and user-discretionary) against
// today's Barchart price action. Writes outcome + pipMove + actualDirection +
// priceMoveR on every IdeaOutcome row whose evaluatedAt is still null.
//
// This is what feeds the algorithm scoreboard with retrospective truth.
//
// Auth: Bearer CRON_SECRET — same pattern as the other cron routes.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pipSize } from '@/lib/mt4'
import { runTradeScanJob } from '@/app/api/cron/trade-scan/route'

export const dynamic = 'force-dynamic'
// The trade-scan job now runs THREE lanes (trend sweep + Wyckoff range scan
// + outcome backfill) — well past any default function timeout.
export const maxDuration = 300

interface BarchartRow {
  symbol: string
  percentChange: number
  lastPrice?: number
  latest?: number
  standardDeviation?: number
}

interface PerfPoint {
  percentChange: number     // e.g. 0.0042
  closePrice: number | null // last/close for the day (used to compute pip move when present)
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const ideaOutcomes = await evaluateIdeaOutcomes()
  let tradeScan = null
  let tradeScanError: string | null = null

  try {
    tradeScan = await runTradeScanJob(req)
  } catch (err) {
    console.error('[idea-outcomes] trade scan failed:', err)
    tradeScanError = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json({
    ok: ideaOutcomes.ok && !tradeScanError,
    ideaOutcomes,
    tradeScan,
    tradeScanError,
  })
}

async function evaluateIdeaOutcomes() {
  // Yesterday at 00:00 UTC is the alertDate we evaluate against today's action.
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
  const dayStart = startOfUtcDay(yesterday)
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)

  // Today's snapshot is the action we score the ideas against.
  const todaySnapshot = await (db.barchartSnapshot.findFirst as any)({
    where: { fetchedAt: { gte: startOfUtcDay(now) } },
    orderBy: { fetchedAt: 'desc' },
  })
  if (!todaySnapshot) {
    return { ok: false, message: 'No Barchart snapshot from today yet — wait and retry' }
  }
  const perfBySymbol = extractPerfMap(todaySnapshot.data)

  // Pull every IdeaOutcome row from yesterday (regardless of source) that hasn't
  // been evaluated yet. This evaluates Claude ideas AND user-discretionary logs
  // through the same pipeline.
  const rows = await (db as any).ideaOutcome.findMany({
    where: { alertDate: dayStart, evaluatedAt: null },
  })

  // Trades placed yesterday — used to mark takenByUser if not already set.
  const yesterdaysTrades = await db.trade.findMany({
    where: { date: { gte: dayStart, lt: dayEnd } },
  })

  let evaluated = 0
  for (const row of rows) {
    const symbol = row.pair.replace('/', '').toUpperCase()
    const perf = perfBySymbol.get(symbol) ?? null
    const { outcome, priceMoveR, pipMove, actualDirection, closePrice } = scoreIdea(
      row.pair, row.direction, perf,
    )

    const matchedTrade = yesterdaysTrades.find(
      (t) => t.pair.replace('/', '').toUpperCase() === symbol && t.direction === row.direction,
    )
    const takenInferred = row.takenByUser || !!matchedTrade

    await (db as any).ideaOutcome.update({
      where: { id: row.id },
      data: {
        evaluatedAt: new Date(),
        outcome,
        priceMoveR,
        pipMove,
        actualDirection,
        closePrice,
        takenByUser: takenInferred,
        tradeId: row.tradeId ?? matchedTrade?.id ?? null,
      },
    })
    evaluated++
  }

  return { ok: true, evaluated, alertDate: dayStart }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// Build "EURUSD" → { percentChange, closePrice } from the snapshot
function extractPerfMap(data: any): Map<string, PerfPoint> {
  const map = new Map<string, PerfPoint>()
  if (!data?.forex?.performance?.today) return map
  const { bullish = [], bearish = [] } = data.forex.performance.today
  for (const row of [...bullish, ...bearish] as BarchartRow[]) {
    if (row?.symbol && typeof row.percentChange === 'number') {
      const key = row.symbol.toUpperCase().replace(/[^A-Z]/g, '')
      map.set(key, {
        percentChange: row.percentChange,
        closePrice: typeof row.latest === 'number' ? row.latest
          : typeof row.lastPrice === 'number' ? row.lastPrice : null,
      })
    }
  }
  return map
}

// Score an idea against next-day price action.
// • outcome: Win if direction matched a ≥0.3% move, Loss if opposite, Neutral if smaller
// • priceMoveR: approx R-multiple, assuming a 0.5% move = 1R
// • pipMove: signed pip move IN THE IDEA'S DIRECTION (positive = idea was right)
// • actualDirection: "up" | "down" | "flat" — raw move regardless of idea
function scoreIdea(
  pair: string,
  direction: string,
  perf: PerfPoint | null,
): {
  outcome: string
  priceMoveR: number | null
  pipMove: number | null
  actualDirection: string | null
  closePrice: number | null
} {
  if (!perf) return { outcome: 'Pending', priceMoveR: null, pipMove: null, actualDirection: null, closePrice: null }

  const raw = perf.percentChange
  // actualDirection from raw move
  const actualDirection: 'up' | 'down' | 'flat' =
    raw > 0.001 ? 'up' : raw < -0.001 ? 'down' : 'flat'

  // signed = move in the idea's direction
  const signed = direction === 'Long' ? raw : -raw
  const r = signed / 0.005

  // pipMove from raw % and the close price, in pips (only when we have a price)
  let pipMove: number | null = null
  if (perf.closePrice != null && perf.closePrice > 0) {
    const dollarMove = perf.closePrice * (raw)
    const pip = pipSize(pair)
    const signedPips = (direction === 'Long' ? dollarMove : -dollarMove) / pip
    pipMove = Number(signedPips.toFixed(1))
  }

  let outcome: string
  if (signed > 0.003) outcome = 'Win'
  else if (signed < -0.003) outcome = 'Loss'
  else outcome = 'Neutral'

  return {
    outcome,
    priceMoveR: Number(r.toFixed(2)),
    pipMove,
    actualDirection,
    closePrice: perf.closePrice,
  }
}
