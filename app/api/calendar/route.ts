// app/api/calendar/route.ts
// Per-day P&L for a given month. Powers the calendar grid view at /calendar.
//
// Query params:
//   year     — e.g. 2026 (defaults to current year UTC)
//   month    — 1-12   (defaults to current month UTC)
//   accountId — optional, filter to one account
//
// Returns one entry per day that had ≥1 closed trade. Days with no trades
// are simply absent (the page fills the grid with empty cells).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// "Funded" maps to multiple Account.status values that are post-challenge.
const PHASE_STATUS_MAP: Record<string, string[]> = {
  phase1: ['Phase1'],
  phase2: ['Phase2'],
  funded: ['Funded', 'Live', 'Passed'],
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const now = new Date()
  const year = parseInt(url.searchParams.get('year') ?? String(now.getUTCFullYear()), 10)
  const month = parseInt(url.searchParams.get('month') ?? String(now.getUTCMonth() + 1), 10)
  const accountId = url.searchParams.get('accountId')
  const phaseParam = (url.searchParams.get('phase') ?? 'all').toLowerCase()

  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return NextResponse.json({ error: 'invalid year/month' }, { status: 400 })
  }

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  // Pull all closed trades in the month with their account status attached.
  // We aggregate twice: once filtered by the requested phase (drives the grid),
  // and once per phase (drives the per-phase strip above the calendar).
  const allTrades = await db.trade.findMany({
    where: {
      date: { gte: start, lt: end },
      outcome: { in: ['Win', 'Loss', 'BE'] },
      ...(accountId ? { accountId } : {}),
    },
    select: {
      date: true,
      resultR: true,
      profitCcy: true,
      outcome: true,
      pair: true,
      direction: true,
      grade: true,
      accountId: true,
      account: { select: { status: true } },
    },
    orderBy: { date: 'asc' },
  })

  // Apply phase filter for the main view
  const phaseStatuses = PHASE_STATUS_MAP[phaseParam] ?? null
  const trades = phaseStatuses
    ? allTrades.filter((t) => t.account?.status && phaseStatuses.includes(t.account.status))
    : allTrades

  // Group by UTC date string YYYY-MM-DD
  const byDay = new Map<string, {
    date: string
    trades: number
    wins: number
    losses: number
    breakEven: number
    netR: number
    netDollars: number
    pairs: string[]                 // unique pairs traded
    bestR: number
    worstR: number
  }>()

  for (const t of trades) {
    const d = new Date(t.date)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    if (!byDay.has(key)) {
      byDay.set(key, {
        date: key, trades: 0, wins: 0, losses: 0, breakEven: 0,
        netR: 0, netDollars: 0, pairs: [], bestR: -Infinity, worstR: Infinity,
      })
    }
    const agg = byDay.get(key)!
    agg.trades++
    if (t.outcome === 'Win') agg.wins++
    else if (t.outcome === 'Loss') agg.losses++
    else if (t.outcome === 'BE') agg.breakEven++
    agg.netR += t.resultR ?? 0
    agg.netDollars += t.profitCcy ?? 0
    if (!agg.pairs.includes(t.pair)) agg.pairs.push(t.pair)
    if (t.resultR != null) {
      if (t.resultR > agg.bestR)  agg.bestR  = t.resultR
      if (t.resultR < agg.worstR) agg.worstR = t.resultR
    }
  }

  // Tidy up sentinel infinities + round
  const days = [...byDay.values()].map((d) => ({
    ...d,
    netR: Math.round(d.netR * 100) / 100,
    netDollars: Math.round(d.netDollars * 100) / 100,
    bestR: d.bestR === -Infinity ? null : Math.round(d.bestR * 100) / 100,
    worstR: d.worstR === Infinity ? null : Math.round(d.worstR * 100) / 100,
  }))

  // Month-level summary
  const totalR = days.reduce((s, d) => s + d.netR, 0)
  const totalDollars = days.reduce((s, d) => s + d.netDollars, 0)
  const tradingDays = days.length
  const greenDays = days.filter((d) => d.netR > 0).length
  const redDays = days.filter((d) => d.netR < 0).length
  const bestDay = days.reduce<typeof days[number] | null>((b, d) => (!b || d.netR > b.netR ? d : b), null)
  const worstDay = days.reduce<typeof days[number] | null>((b, d) => (!b || d.netR < b.netR ? d : b), null)

  // Per-phase summary across allTrades (not affected by selected phase filter)
  // — this drives the strip ABOVE the calendar so the user can see all
  // three buckets at once even when filtering to one
  function summariseFor(statuses: string[]) {
    const subset = allTrades.filter((t) => t.account?.status && statuses.includes(t.account.status))
    const r = subset.reduce((s, t) => s + (t.resultR ?? 0), 0)
    const $$ = subset.reduce((s, t) => s + (t.profitCcy ?? 0), 0)
    const w = subset.filter((t) => t.outcome === 'Win').length
    const l = subset.filter((t) => t.outcome === 'Loss').length
    return {
      trades: subset.length,
      wins: w,
      losses: l,
      netR: Math.round(r * 100) / 100,
      netDollars: Math.round($$ * 100) / 100,
      winRate: subset.length > 0 ? w / (w + l || 1) : null,
    }
  }

  const phaseBreakdown = {
    phase1: summariseFor(PHASE_STATUS_MAP.phase1),
    phase2: summariseFor(PHASE_STATUS_MAP.phase2),
    funded: summariseFor(PHASE_STATUS_MAP.funded),
  }

  return NextResponse.json({
    year, month,
    monthStart: start.toISOString(),
    phase: phaseParam,
    days,
    summary: {
      totalR: Math.round(totalR * 100) / 100,
      totalDollars: Math.round(totalDollars * 100) / 100,
      tradingDays,
      greenDays,
      redDays,
      winRateOfDays: tradingDays > 0 ? greenDays / tradingDays : null,
      bestDay,
      worstDay,
      tradesTotal: trades.length,
    },
    phaseBreakdown,
  })
}
