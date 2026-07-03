// app/trades/active/_components/types.ts
// Shared types + pure derivation helpers for the Active positions page (v2).
//
// Everything on screen is derived from two existing endpoints:
//   GET /api/dashboard  → openTrades[] (alignment, news, risk fields)
//   GET /api/accounts   → accounts[] (balance, currency, starting balance)
//
// There is NO live market-price feed in the API. The "now" price on the
// price track is back-derived from the MT4-synced floating P&L (profitCcy)
// and the dollar risk: openR = profitCcy / risk$, now ≈ entry ± openR·|entry−initSL|.
// When profitCcy or risk$ is missing the track degrades gracefully (dot at entry).

export interface NewsEvent {
  title: string
  country: string
  currency: string
  date: string
  impact: string
}

export interface OpenTrade {
  id: string
  pair: string
  direction: string
  model: string
  grade: string
  session: string
  entryPrice: number
  slPrice: number
  tpPrice: number
  riskPercent: number | null
  riskAmount: number | null
  initialSlPrice: number | null
  strongCcy: string
  weakCcy: string
  divScore: number | null
  date: string
  source: string
  accountId: string | null
  lotSize: number | null
  profitCcy: number | null
  alignmentStatus: 'Green' | 'Amber' | 'Red' | 'Unknown'
  alignmentReason: string
  newsCollisions: NewsEvent[]
}

export interface Account {
  id: string
  name: string
  currentBalance: number
  startingBalance: number
  currency: string
}

export const MONO = "'DM Mono', monospace"

// ── formatting ───────────────────────────────────────────────────────────────

export function priceDigits(pair: string): number {
  const s = (pair ?? '').toUpperCase()
  if (s.includes('JPY')) return 3
  if (s.startsWith('XAU')) return 2
  if (s.startsWith('XAG')) return 3
  return 5
}

export function fmtPrice(n: number | null | undefined, pair: string): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(priceDigits(pair)) : '—'
}

export function fmtCcy(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(n)
}

export function fmtSignedCcy(n: number, currency = 'USD'): string {
  return (n >= 0 ? '+' : '−') + fmtCcy(Math.abs(n), currency)
}

export function fmtR(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}R`
}

/** "in 40m" / "in 2h 10m" / "now" / "passed" relative to a calendar date. */
export function timeUntil(date: string): string {
  const ms = new Date(date).getTime() - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms < -30 * 60 * 1000) return 'passed'
  if (ms < 60 * 1000) return 'now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
}

// ── derived position math ────────────────────────────────────────────────────

export interface DerivedPosition {
  /** SL at fill time — anchor for all R math. Falls back to current SL. */
  initSl: number
  /** Dollars risked at entry: riskAmount, else riskPercent% of account balance. */
  riskDollars: number | null
  /** Floating R = profitCcy / riskDollars. Null when either input missing. */
  openR: number | null
  /** R multiple of the take profit (distance-to-TP / distance-to-initSL). */
  rTarget: number | null
  /** Estimated current price, back-derived from openR. Null when unknown. */
  nowPrice: number | null
  /** 0–100 progress from entry toward TP (in R terms), clamped. Null when unknown. */
  progressPct: number | null
  /** Track positions, 0 = risk side (init SL), 1 = TP. */
  entryPos: number
  nowPos: number
  /** Current stop expressed in R (−1 = original, 0 = BE, >0 = locked profit). */
  rStop: number | null
  stopPos: number | null
  /** Whether the current SL differs from the initial SL. */
  stopMoved: boolean
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function derivePosition(t: OpenTrade, account: Account | undefined): DerivedPosition {
  const initSl = t.initialSlPrice ?? t.slPrice
  const dirSign = t.direction === 'Long' ? 1 : -1
  const riskDist = Math.abs(t.entryPrice - initSl)
  const tpDist = Math.abs(t.tpPrice - t.entryPrice)
  const rTarget = riskDist > 0 && tpDist > 0 ? tpDist / riskDist : null

  const riskDollars = t.riskAmount != null && t.riskAmount > 0
    ? t.riskAmount
    : (t.riskPercent && account ? Math.round((t.riskPercent / 100) * account.currentBalance) : null)

  const openR = t.profitCcy != null && riskDollars
    ? Number((t.profitCcy / riskDollars).toFixed(2))
    : null

  const nowPrice = openR != null && riskDist > 0
    ? t.entryPrice + dirSign * openR * riskDist
    : null

  // Normalize any R value onto the track: −1R (init SL) → 0, +rTarget R (TP) → 1.
  const pos = (r: number) => rTarget != null ? clamp01((r + 1) / (1 + rTarget)) : 0.5
  const entryPos = pos(0)
  const nowPos = openR != null ? pos(openR) : entryPos

  const rStop = riskDist > 0 ? Number((dirSign * (t.slPrice - t.entryPrice) / riskDist).toFixed(2)) : null
  const stopMoved = t.initialSlPrice != null && Math.abs(t.slPrice - initSl) > riskDist * 0.02
  const stopPos = stopMoved && rStop != null ? pos(rStop) : null

  const progressPct = openR != null && rTarget != null
    ? Math.round(clamp01(openR / rTarget) * 100)
    : null

  return { initSl, riskDollars, openR, rTarget, nowPrice, progressPct, entryPos, nowPos, rStop, stopPos, stopMoved }
}
