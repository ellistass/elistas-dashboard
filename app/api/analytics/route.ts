// app/api/analytics/route.ts — single endpoint that powers the redesigned /analytics page.
//
// Query params:
//   accountId   — optional, filter to one Account.id (omit for aggregate across all)
//   days        — lookback window, default 30
//
// Returns everything the page renders: KPIs, behavior detector outputs, missed-idea summary,
// session heatmap, grade breakdown, model breakdown, equity curve points (real + counterfactual).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  detectOvertrading,
  detectRevenge,
  detectSizingDrift,
  disciplineBreakdown,
  ruleViolations,
  buildSessionHourHeatmap,
  type TradeLike,
} from '@/lib/analytics/detectors'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const accountId = url.searchParams.get('accountId')
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10)))

  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const where: any = { date: { gte: since } }
  if (accountId) where.accountId = accountId

  const trades = await db.trade.findMany({ where, orderBy: { date: 'asc' } })
  const tradesT: TradeLike[] = trades as any

  // Detectors
  const violations = new Map<string, string[]>()
  for (const t of tradesT) {
    const v = ruleViolations(t)
    if (v.length) violations.set(t.id, v)
  }
  const overtrading = detectOvertrading(tradesT)
  const revenge = detectRevenge(tradesT)
  const sizingDrift = detectSizingDrift(tradesT)
  const heatmap = buildSessionHourHeatmap(tradesT)
  const discipline = disciplineBreakdown(tradesT, violations)

  // Core KPIs
  const closed = tradesT.filter((t) => t.outcome === 'Win' || t.outcome === 'Loss' || t.outcome === 'BE')
  const wins = closed.filter((t) => t.outcome === 'Win').length
  const totalR = closed.reduce((s, t) => s + (t.resultR ?? 0), 0)
  const winRate = closed.length ? wins / closed.length : 0
  const avgR = closed.length ? totalR / closed.length : 0

  // Equity curve (real) + counterfactual (rules-followed only)
  let cum = 0
  let cumDiscipline = 0
  const equityCurve = closed.map((t) => {
    cum += t.resultR ?? 0
    if (!violations.has(t.id)) cumDiscipline += t.resultR ?? 0
    return { date: (t.date as Date).toISOString(), real: cum, disciplined: cumDiscipline }
  })

  // Best session
  const bySession: Record<string, { wins: number; count: number; totalR: number }> = {}
  for (const t of closed) {
    const k = t.session || 'Off-hours'
    bySession[k] ||= { wins: 0, count: 0, totalR: 0 }
    bySession[k].count++
    if (t.outcome === 'Win') bySession[k].wins++
    bySession[k].totalR += t.resultR ?? 0
  }
  const bestSession =
    Object.entries(bySession)
      .map(([name, s]) => ({ name, ...s, winRate: s.count ? s.wins / s.count : 0 }))
      .sort((a, b) => b.totalR - a.totalR)[0] ?? null

  // Grade breakdown
  const byGrade: Record<string, { wins: number; count: number; totalR: number }> = {}
  for (const t of closed) {
    const k = t.grade || 'unmarked'
    byGrade[k] ||= { wins: 0, count: 0, totalR: 0 }
    byGrade[k].count++
    if (t.outcome === 'Win') byGrade[k].wins++
    byGrade[k].totalR += t.resultR ?? 0
  }

  // Model A vs B
  const byModel: Record<string, { wins: number; count: number; totalR: number }> = { A: { wins: 0, count: 0, totalR: 0 }, B: { wins: 0, count: 0, totalR: 0 } }
  for (const t of closed) {
    if (t.model !== 'A' && t.model !== 'B') continue
    byModel[t.model].count++
    if (t.outcome === 'Win') byModel[t.model].wins++
    byModel[t.model].totalR += t.resultR ?? 0
  }

  // Missed-idea summary — pulls from IdeaOutcome populated by the daily cron
  const ideaOutcomes = await (db as any).ideaOutcome.findMany({
    where: { alertDate: { gte: since }, outcome: { not: 'Pending' } },
    orderBy: { alertDate: 'desc' },
  })
  const ideasAplus = ideaOutcomes.filter((i: any) => i.grade === 'A+')
  const ideasTaken = ideaOutcomes.filter((i: any) => i.takenByUser)
  const ideasMissedR = ideaOutcomes
    .filter((i: any) => !i.takenByUser && i.outcome === 'Win' && i.priceMoveR)
    .reduce((s: number, i: any) => s + (i.priceMoveR ?? 0), 0)

  return NextResponse.json({
    range: { days, since },
    accountId,
    kpi: {
      tradesClosed: closed.length,
      winRate: Number(winRate.toFixed(3)),
      totalR: Number(totalR.toFixed(2)),
      avgR: Number(avgR.toFixed(2)),
      disciplinePct: closed.length ? (closed.length - violations.size) / closed.length : 0,
      bestSession,
    },
    discipline,
    behavior: {
      overtrading: {
        daysFlagged: overtrading.daysFlagged,
        flaggedDates: overtrading.flaggedDates,
        rapidSuccessions: overtrading.rapidSuccessions,
        tradeIds: [...overtrading.tradeIds],
      },
      revenge: revenge,
      sizingDrift: sizingDrift,
      ruleViolations: {
        tradeCount: violations.size,
        byType: countByType(violations),
      },
    },
    heatmap,
    byGrade,
    byModel,
    equityCurve,
    ideas: {
      aplusSurfaced: ideasAplus.length,
      taken: ideasTaken.length,
      missedR: Number(ideasMissedR.toFixed(2)),
      recent: ideaOutcomes.slice(0, 10),
    },
  })
}

function countByType(violations: Map<string, string[]>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const list of violations.values()) {
    for (const v of list) counts[v] = (counts[v] ?? 0) + 1
  }
  return counts
}
