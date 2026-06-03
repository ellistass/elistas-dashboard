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

// "Funded" rolls up the multiple post-challenge Account.status values.
const PHASE_STATUS_MAP: Record<string, string[]> = {
  Phase1: ['Phase1'],
  Phase2: ['Phase2'],
  Funded: ['Funded', 'Live', 'Passed'],
}

function phaseForStatus(status: string | null | undefined): string | null {
  if (!status) return null
  for (const [phase, list] of Object.entries(PHASE_STATUS_MAP)) {
    if (list.includes(status)) return phase
  }
  return null
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const accountId = url.searchParams.get('accountId')
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10)))
  // Strategy filter — default excludes any trade tagged 'pre-strategy', which
  // is what the broker importer applies to rows opened before the user's
  // declared strategy start date. The dashboard sets the view explicitly:
  //   • includePreStrategy=false (default) → strategy-only stats
  //   • includePreStrategy=true            → full account history
  //   • preStrategyOnly=true               → just pre-strategy rows (for audit)
  const includePreStrategy = url.searchParams.get('includePreStrategy') === 'true'
  const preStrategyOnly    = url.searchParams.get('preStrategyOnly') === 'true'

  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const where: any = { date: { gte: since } }
  if (accountId) where.accountId = accountId

  // Pull account.status alongside each trade so we can roll up by phase.
  const trades = await db.trade.findMany({
    where,
    orderBy: { date: 'asc' },
    include: { account: { select: { status: true } } },
  })
  // Apply the strategy/pre-strategy filter in-memory — Postgres' Json array
  // containment is awkward to express via Prisma's typed builder and the row
  // counts here are small enough that this is fine.
  const tradesFiltered = trades.filter((t: any) => {
    const isPre = Array.isArray(t.tags) && t.tags.includes('pre-strategy')
    if (preStrategyOnly) return isPre
    if (includePreStrategy) return true
    return !isPre
  })
  const tradesT: TradeLike[] = tradesFiltered as any

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

  // Model A vs B — track both $ and "reliable R" (only sum R for trades that
  // have initialSlPrice set, so the value isn't poisoned by broker-import rows
  // whose SL was modified during the trade).
  const emptyModelStats = () => ({
    wins: 0, losses: 0, be: 0, count: 0,
    totalR: 0, totalPnL: 0,
    reliableR: 0, reliableCount: 0,
    bestPnL: 0, worstPnL: 0,
  })
  const byModel: Record<string, ReturnType<typeof emptyModelStats>> = {
    A: emptyModelStats(),
    B: emptyModelStats(),
  }
  for (const t of closed as any[]) {
    if (t.model !== 'A' && t.model !== 'B') continue
    const m = byModel[t.model]
    m.count++
    if (t.outcome === 'Win')      m.wins++
    else if (t.outcome === 'Loss') m.losses++
    else if (t.outcome === 'BE')   m.be++
    m.totalR   += t.resultR ?? 0
    m.totalPnL += t.profitCcy ?? 0
    if (t.initialSlPrice != null && t.resultR != null) {
      m.reliableR     += t.resultR
      m.reliableCount += 1
    }
    if ((t.profitCcy ?? 0) > m.bestPnL)  m.bestPnL  = t.profitCcy ?? 0
    if ((t.profitCcy ?? 0) < m.worstPnL) m.worstPnL = t.profitCcy ?? 0
  }

  // ── Phase breakdown ────────────────────────────────────────────────────
  // Buckets every closed trade by the account phase it was taken on.
  // "Funded" merges Funded/Live/Passed.
  const phaseEmpty = () => ({ wins: 0, losses: 0, be: 0, count: 0, totalR: 0, totalPnL: 0 })
  const byPhase: Record<string, ReturnType<typeof phaseEmpty>> = {
    Phase1: phaseEmpty(), Phase2: phaseEmpty(), Funded: phaseEmpty(), Unphased: phaseEmpty(),
  }
  // Model × Phase cross-tab — the "model A on phase 1 win rate" view.
  type CrossCell = { wins: number; count: number; totalR: number; totalPnL: number }
  const emptyCross = (): CrossCell => ({ wins: 0, count: 0, totalR: 0, totalPnL: 0 })
  const byModelByPhase: Record<string, Record<'A' | 'B', CrossCell>> = {
    Phase1: { A: emptyCross(), B: emptyCross() },
    Phase2: { A: emptyCross(), B: emptyCross() },
    Funded: { A: emptyCross(), B: emptyCross() },
  }

  // The closed list was derived BEFORE applying the include, so re-map onto
  // it. tradesFiltered keeps the account join attached — closed is a subset
  // by id.
  const closedIds = new Set(closed.map((c) => c.id))
  for (const t of tradesFiltered as any[]) {
    if (!closedIds.has(t.id)) continue
    const phase = phaseForStatus(t.account?.status) ?? 'Unphased'
    const bucket = byPhase[phase]
    bucket.count++
    bucket.totalR += t.resultR ?? 0
    bucket.totalPnL += t.profitCcy ?? 0
    if (t.outcome === 'Win')      bucket.wins++
    else if (t.outcome === 'Loss') bucket.losses++
    else if (t.outcome === 'BE')   bucket.be++

    if (phase !== 'Unphased' && (t.model === 'A' || t.model === 'B')) {
      const cell = byModelByPhase[phase][t.model as 'A' | 'B']
      cell.count++
      cell.totalR   += t.resultR ?? 0
      cell.totalPnL += t.profitCcy ?? 0
      if (t.outcome === 'Win') cell.wins++
    }
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
    byPhase,
    byModelByPhase,
    strategyFilter: {
      includePreStrategy,
      preStrategyOnly,
      // Useful for the UI: how many rows the filter dropped vs. kept.
      tradesAfterFilter: tradesFiltered.length,
      tradesBeforeFilter: trades.length,
    },
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
