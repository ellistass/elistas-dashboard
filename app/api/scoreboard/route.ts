// app/api/scoreboard/route.ts
// Aggregates every IdeaOutcome row in a time window into the metrics the
// algorithm scoreboard renders: directional accuracy, grade hit rates, pip
// edge ratio, invalidation accuracy, best/worst dimensions.
//
// Query params:
//   source: "claude" | "user-discretionary" | "both"   (default "both")
//   days:   lookback window in days                    (default 30)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Row {
  pair: string
  direction: string
  grade: string
  strong: string
  weak: string
  source: string
  userAction: string
  invalidationReason: string | null
  outcome: string | null
  priceMoveR: number | null
  pipMove: number | null
  actualDirection: string | null
  userModel: string | null
  userSession: string | null
  takenByUser: boolean
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const source = url.searchParams.get('source') ?? 'both'
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)

  const where: any = { alertDate: { gte: since } }
  if (source === 'claude' || source === 'user-discretionary') where.source = source

  const rows = (await (db as any).ideaOutcome.findMany({ where })) as Row[]

  // Only rows that have been evaluated participate in hit-rate metrics.
  // Pending (no next-day data yet) are counted separately.
  const evaluated = rows.filter((r) => r.outcome && r.outcome !== 'Pending')
  const pending = rows.length - evaluated.length

  // ─── Directional accuracy ─────────────────────────────────────────────────
  const directional = {
    Long:  bucket(evaluated.filter((r) => r.direction === 'Long')),
    Short: bucket(evaluated.filter((r) => r.direction === 'Short')),
  }

  // ─── Grade hit rate ───────────────────────────────────────────────────────
  const grades: Record<string, Bucket> = {}
  for (const g of ['A+', 'B', 'C']) {
    grades[g] = bucket(evaluated.filter((r) => r.grade === g))
  }

  // ─── Pip-move edge ratio ──────────────────────────────────────────────────
  const wins = evaluated.filter((r) => r.outcome === 'Win')
  const losses = evaluated.filter((r) => r.outcome === 'Loss')
  const avgPipsWhenRight = avg(wins.map((r) => r.pipMove).filter(isNum))
  const avgPipsWhenWrong = avg(losses.map((r) => r.pipMove).filter(isNum))
  const avgRWhenRight = avg(wins.map((r) => r.priceMoveR).filter(isNum))
  const avgRWhenWrong = avg(losses.map((r) => r.priceMoveR).filter(isNum))
  const edgeRatio = avgPipsWhenWrong !== 0 && avgPipsWhenWrong != null
    ? Math.abs(avgPipsWhenRight ?? 0) / Math.abs(avgPipsWhenWrong)
    : null

  // ─── Invalidation accuracy ───────────────────────────────────────────────
  const invalidated = evaluated.filter((r) => r.userAction === 'invalidated')
  const taken = evaluated.filter((r) => r.userAction === 'taken')
  const watched = evaluated.filter((r) => r.userAction === 'watched')
  const correctSkips = invalidated.filter((r) => r.outcome === 'Loss').length
  const missedSkips  = invalidated.filter((r) => r.outcome === 'Win').length
  const neutralSkips = invalidated.filter((r) => r.outcome === 'Neutral').length
  const netRCostOfMissed = invalidated
    .filter((r) => r.outcome === 'Win' && r.priceMoveR != null)
    .reduce((s, r) => s + (r.priceMoveR ?? 0), 0)

  // Group invalidations by reason
  const byReason: Record<string, { count: number; correct: number; missed: number }> = {}
  for (const r of invalidated) {
    const k = r.invalidationReason?.toLowerCase().trim() || '(no reason)'
    byReason[k] ||= { count: 0, correct: 0, missed: 0 }
    byReason[k].count++
    if (r.outcome === 'Loss') byReason[k].correct++
    if (r.outcome === 'Win')  byReason[k].missed++
  }

  // ─── Best & worst dimensions ─────────────────────────────────────────────
  // Group by pair, by strong currency, by session
  const byPair = groupBucket(evaluated, (r) => r.pair)
  const byStrong = groupBucket(evaluated.filter((r) => r.strong), (r) => r.strong)
  const byWeak = groupBucket(evaluated.filter((r) => r.weak), (r) => r.weak)
  const bySession = groupBucket(
    evaluated.filter((r) => r.userSession),
    (r) => r.userSession!,
  )

  return NextResponse.json({
    range: { days, source },
    totals: {
      total: rows.length,
      evaluated: evaluated.length,
      pending,
      taken: taken.length,
      watched: watched.length,
      invalidated: invalidated.length,
    },
    directional,
    grades,
    pipEdge: {
      avgPipsWhenRight,
      avgPipsWhenWrong,
      avgRWhenRight,
      avgRWhenWrong,
      edgeRatio,
      winCount: wins.length,
      lossCount: losses.length,
    },
    invalidationAccuracy: {
      total: invalidated.length,
      correctSkips,
      missedSkips,
      neutralSkips,
      correctPct: invalidated.length > 0 ? correctSkips / invalidated.length : null,
      netRCostOfMissed: Number(netRCostOfMissed.toFixed(2)),
      byReason,
    },
    dimensions: {
      byPair: topN(byPair, 5),
      worstPair: bottomN(byPair, 3),
      byStrong: topN(byStrong, 3),
      worstStrong: bottomN(byStrong, 3),
      byWeak: topN(byWeak, 3),
      bySession: topN(bySession, 3),
    },
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Bucket { count: number; wins: number; losses: number; neutral: number; winRate: number | null }
function bucket(rs: Row[]): Bucket {
  const wins = rs.filter((r) => r.outcome === 'Win').length
  const losses = rs.filter((r) => r.outcome === 'Loss').length
  const neutral = rs.filter((r) => r.outcome === 'Neutral').length
  const totalDirectional = wins + losses
  return {
    count: rs.length,
    wins, losses, neutral,
    winRate: totalDirectional > 0 ? wins / totalDirectional : null,
  }
}

function groupBucket(rs: Row[], key: (r: Row) => string): Array<{ key: string } & Bucket> {
  const groups = new Map<string, Row[]>()
  for (const r of rs) {
    const k = key(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  return [...groups.entries()]
    .map(([k, arr]) => ({ key: k, ...bucket(arr) }))
    .filter((g) => g.count >= 3)   // need at least 3 samples for a meaningful rate
}

function topN<T extends { winRate: number | null }>(arr: T[], n: number): T[] {
  return [...arr].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0)).slice(0, n)
}
function bottomN<T extends { winRate: number | null }>(arr: T[], n: number): T[] {
  return [...arr].sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0)).slice(0, n)
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null
  return Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2))
}
function isNum(v: any): v is number { return typeof v === 'number' && !Number.isNaN(v) }
