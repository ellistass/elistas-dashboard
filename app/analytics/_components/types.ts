// app/analytics/_components/types.ts
// Shared types for the Strategy analytics screen. The AnalyticsResponse
// interface and RULE_LABELS map are reused VERBATIM from the previous
// page implementation — the /api/analytics contract is unchanged.

export interface Account { id: string; name: string; broker: string; isActive: boolean }

export interface AnalyticsResponse {
  range: { days: number; since: string }
  accountId: string | null
  kpi: {
    tradesClosed: number
    winRate: number
    totalR: number
    avgR: number
    disciplinePct: number
    bestSession: { name: string; winRate: number; totalR: number; count: number } | null
  }
  discipline: {
    followed: { count: number; wins: number; totalR: number; winRate: number }
    broken:   { count: number; wins: number; totalR: number; winRate: number }
  }
  behavior: {
    overtrading: { daysFlagged: number; flaggedDates: string[]; rapidSuccessions: number; tradeIds: string[] }
    revenge:     Array<{ tradeId: string; minutesAfterLoss: number; sizeMultiplier: number }>
    sizingDrift: Array<{ tradeId: string; riskPercent: number; zScore: number }>
    ruleViolations: { tradeCount: number; byType: Record<string, number> }
  }
  heatmap: Array<{ session: string; watHour: number; totalR: number; tradeCount: number }>
  byGrade: Record<string, { wins: number; count: number; totalR: number }>
  byModel: Record<string, {
    wins: number; losses: number; be: number; count: number;
    totalR: number; totalPnL: number;
    reliableR: number; reliableCount: number;
    bestPnL: number; worstPnL: number;
  }>
  byPhase?: Record<string, { wins: number; losses: number; be: number; count: number; totalR: number; totalPnL: number }>
  byModelByPhase?: Record<string, { A: { wins: number; count: number; totalR: number; totalPnL: number }; B: { wins: number; count: number; totalR: number; totalPnL: number } }>
  strategyFilter?: {
    includePreStrategy: boolean
    preStrategyOnly: boolean
    tradesAfterFilter: number
    tradesBeforeFilter: number
  }
  equityCurve: Array<{ date: string; real: number; disciplined: number }>
  ideas: {
    aplusSurfaced: number
    taken: number
    missedR: number
    recent: Array<{
      id: string
      alertDate: string
      pair: string
      direction: string
      grade: string
      takenByUser: boolean
      outcome: string | null
      priceMoveR: number | null
    }>
  }
}

export const RULE_LABELS: Record<string, string> = {
  'within-30min-ny-open': 'Entered within 30min of NY open',
  'after-7pm-wat': 'Entered after 19:00 WAT',
  'no-model-declared': 'No model declared',
  'sub-1to2-rr': 'Sub-1:2 R:R at entry',
  'c-grade-full-risk': 'C-grade at full risk',
  'risk-over-1pct': 'Risk above 1%',
}

export type StrategyView = 'strategy' | 'all' | 'pre-strategy'
