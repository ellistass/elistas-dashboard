// lib/analytics/detectors.ts — pure behavior-detection functions over Trade rows.
//
// All detectors are pure: same input → same output. The endpoint that serves the stats
// page reads the relevant trades, runs each detector, and renders the result. No state.
//
// Detectors encode rules from startegy.md as code. Edit them here, not on the page.

export interface TradeLike {
  id: string
  date: Date | string
  pair: string
  direction: 'Long' | 'Short' | string
  model: string                // "A" | "B" | "" (empty = not yet declared)
  grade: string                // "A+" | "B" | "C" | "" (empty if auto-logged & unreviewed)
  session: string
  entryPrice: number
  slPrice: number
  tpPrice: number
  closePrice: number | null
  riskPercent: number
  resultR: number | null
  outcome: string | null       // "Win" | "Loss" | "BE" | "Open"
  openTimeUtc?: Date | string | null
  accountId?: string | null
}

// ─── Rule violations ───────────────────────────────────────────────────────────
// Encodes the hard blockers from startegy.md. Each trade gets a string[] of broken rules.
// WAT = UTC+1, so UTC hours below are WAT-1.

export function ruleViolations(t: TradeLike): string[] {
  const violations: string[] = []
  const openTime = t.openTimeUtc ? new Date(t.openTimeUtc) : new Date(t.date)
  const watHour = (openTime.getUTCHours() + 1) % 24
  const watMinute = openTime.getUTCMinutes()

  // 1. Within 30 minutes of NY open (NY = 15:00 WAT, so 15:00–15:30 = blocked)
  if (watHour === 15 && watMinute < 30) violations.push('within-30min-ny-open')

  // 2. No entries after 19:00 WAT
  if (watHour >= 19) violations.push('after-7pm-wat')

  // 3. Model not declared
  if (!t.model || (t.model !== 'A' && t.model !== 'B')) violations.push('no-model-declared')

  // 4. Sub-1:2 R:R at entry (|entry − TP| / |entry − SL| < 2)
  if (t.entryPrice && t.slPrice && t.tpPrice) {
    const reward = Math.abs(t.entryPrice - t.tpPrice)
    const risk = Math.abs(t.entryPrice - t.slPrice)
    if (risk > 0 && reward / risk < 2) violations.push('sub-1to2-rr')
  }

  // 5. C-grade at full risk (1%+) — C should be watch-only
  if (t.grade === 'C' && t.riskPercent >= 0.9) violations.push('c-grade-full-risk')

  // 6. Risk > 1% (framework cap)
  if (t.riskPercent > 1.05) violations.push('risk-over-1pct')

  return violations
}

// ─── Overtrading ───────────────────────────────────────────────────────────────
// Days where the trader opened more than `maxPerSession` trades in a single session,
// OR opened two trades within `minMinutesBetween` of each other.

export interface OvertradingResult {
  daysFlagged: number
  flaggedDates: string[]              // ISO YYYY-MM-DD
  rapidSuccessions: number            // count of trades opened too close together
  tradeIds: Set<string>               // every offending trade
}

export function detectOvertrading(
  trades: TradeLike[],
  opts: { maxPerSession?: number; minMinutesBetween?: number } = {},
): OvertradingResult {
  const maxPerSession = opts.maxPerSession ?? 3
  const minMinutesBetween = opts.minMinutesBetween ?? 30

  const sessionsByDay = new Map<string, Map<string, TradeLike[]>>()
  for (const t of trades) {
    const day = ymd(t.date)
    if (!sessionsByDay.has(day)) sessionsByDay.set(day, new Map())
    const s = sessionsByDay.get(day)!
    if (!s.has(t.session)) s.set(t.session, [])
    s.get(t.session)!.push(t)
  }

  const flaggedDates = new Set<string>()
  const tradeIds = new Set<string>()

  for (const [day, sessions] of sessionsByDay) {
    for (const [, sessionTrades] of sessions) {
      if (sessionTrades.length > maxPerSession) {
        flaggedDates.add(day)
        sessionTrades.forEach((t) => tradeIds.add(t.id))
      }
    }
  }

  // Rapid succession check — sort by open time within day
  let rapid = 0
  for (const [day, sessions] of sessionsByDay) {
    const all = [...sessions.values()].flat().sort(byOpenTime)
    for (let i = 1; i < all.length; i++) {
      const prev = openTimeMs(all[i - 1])
      const cur = openTimeMs(all[i])
      if (cur - prev < minMinutesBetween * 60 * 1000) {
        rapid++
        tradeIds.add(all[i].id)
        flaggedDates.add(day)
      }
    }
  }

  return {
    daysFlagged: flaggedDates.size,
    flaggedDates: [...flaggedDates],
    rapidSuccessions: rapid,
    tradeIds,
  }
}

// ─── Revenge trading ───────────────────────────────────────────────────────────
// Trade opened within `windowMinutes` of a Loss, especially when size > 1.5× baseline.

export interface RevengeHit {
  tradeId: string
  precedingLossId: string
  minutesAfterLoss: number
  sizeMultiplier: number              // riskPercent / 30-trade rolling baseline
}

export function detectRevenge(
  trades: TradeLike[],
  opts: { windowMinutes?: number; sizeMultiplierThreshold?: number } = {},
): RevengeHit[] {
  const windowMinutes = opts.windowMinutes ?? 60
  const sizeMultiplierThreshold = opts.sizeMultiplierThreshold ?? 1.0
  // ↑ 1.0 = any trade after a loss within window. ≥1.5 only counts "bigger after loss".

  const sorted = [...trades].sort(byOpenTime)
  const hits: RevengeHit[] = []

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const prev = sorted[i - 1]
    if (prev.outcome !== 'Loss') continue

    const prevClose = closeTimeMs(prev) ?? openTimeMs(prev)
    const curOpen = openTimeMs(cur)
    const gapMin = (curOpen - prevClose) / 60000
    if (gapMin > windowMinutes) continue

    // Baseline = average risk% across last 30 trades before `cur`
    const window = sorted.slice(Math.max(0, i - 30), i)
    const baseline =
      window.length > 0
        ? window.reduce((s, t) => s + t.riskPercent, 0) / window.length
        : cur.riskPercent
    const multiplier = baseline > 0 ? cur.riskPercent / baseline : 1

    if (multiplier >= sizeMultiplierThreshold) {
      hits.push({
        tradeId: cur.id,
        precedingLossId: prev.id,
        minutesAfterLoss: Number(gapMin.toFixed(0)),
        sizeMultiplier: Number(multiplier.toFixed(2)),
      })
    }
  }

  return hits
}

// ─── Sizing drift ──────────────────────────────────────────────────────────────
// Trades where riskPercent > 1.5σ above the 30-trade rolling baseline.

export interface SizingDriftHit {
  tradeId: string
  riskPercent: number
  baselineMean: number
  baselineStdDev: number
  zScore: number
}

export function detectSizingDrift(
  trades: TradeLike[],
  opts: { window?: number; zThreshold?: number } = {},
): SizingDriftHit[] {
  const window = opts.window ?? 30
  const zThreshold = opts.zThreshold ?? 1.5

  const sorted = [...trades].sort(byOpenTime)
  const hits: SizingDriftHit[] = []

  for (let i = window; i < sorted.length; i++) {
    const cur = sorted[i]
    const slice = sorted.slice(i - window, i).map((t) => t.riskPercent)
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length
    const sd = Math.sqrt(variance) || 0.0001
    const z = (cur.riskPercent - mean) / sd
    if (z >= zThreshold) {
      hits.push({
        tradeId: cur.id,
        riskPercent: cur.riskPercent,
        baselineMean: Number(mean.toFixed(3)),
        baselineStdDev: Number(sd.toFixed(3)),
        zScore: Number(z.toFixed(2)),
      })
    }
  }

  return hits
}

// ─── Session × hour heatmap ────────────────────────────────────────────────────
// Returns total R per (session, WAT hour) bucket. Used to render the heatmap card.

export interface HeatmapCell {
  session: string
  watHour: number
  totalR: number
  tradeCount: number
}

export function buildSessionHourHeatmap(trades: TradeLike[]): HeatmapCell[] {
  const buckets = new Map<string, HeatmapCell>()
  for (const t of trades) {
    if (t.resultR == null) continue
    const openTime = t.openTimeUtc ? new Date(t.openTimeUtc) : new Date(t.date)
    const watHour = (openTime.getUTCHours() + 1) % 24
    const key = `${t.session}@${watHour}`
    if (!buckets.has(key)) {
      buckets.set(key, { session: t.session, watHour, totalR: 0, tradeCount: 0 })
    }
    const c = buckets.get(key)!
    c.totalR += t.resultR
    c.tradeCount += 1
  }
  return [...buckets.values()]
}

// ─── Rules-followed vs broken breakdown ────────────────────────────────────────

export interface DisciplineBreakdown {
  followed: { count: number; wins: number; totalR: number; winRate: number }
  broken: { count: number; wins: number; totalR: number; winRate: number }
}

export function disciplineBreakdown(
  trades: TradeLike[],
  violationsByTradeId: Map<string, string[]>,
): DisciplineBreakdown {
  const followed = { count: 0, wins: 0, totalR: 0, winRate: 0 }
  const broken = { count: 0, wins: 0, totalR: 0, winRate: 0 }

  for (const t of trades) {
    if (t.outcome !== 'Win' && t.outcome !== 'Loss' && t.outcome !== 'BE') continue
    const v = violationsByTradeId.get(t.id) ?? []
    const bucket = v.length > 0 ? broken : followed
    bucket.count++
    if (t.outcome === 'Win') bucket.wins++
    if (t.resultR != null) bucket.totalR += t.resultR
  }
  followed.winRate = followed.count > 0 ? followed.wins / followed.count : 0
  broken.winRate = broken.count > 0 ? broken.wins / broken.count : 0
  return { followed, broken }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function ymd(d: Date | string): string {
  const x = new Date(d)
  return x.toISOString().slice(0, 10)
}

function openTimeMs(t: TradeLike): number {
  return new Date(t.openTimeUtc ?? t.date).getTime()
}
function closeTimeMs(t: TradeLike): number | null {
  // We don't have a closeTimeUtc on every trade — falls back to date for legacy trades
  return t.outcome && t.outcome !== 'Open' ? new Date(t.date).getTime() : null
}
function byOpenTime(a: TradeLike, b: TradeLike): number {
  return openTimeMs(a) - openTimeMs(b)
}
