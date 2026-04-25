// lib/fetchers.ts
// Reads all market data from Supabase — written hourly by the Railway barchart-sync service.
// No external API calls here. The Railway service owns data collection.

import { db } from '@/lib/db'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface CalendarEvent {
  title: string
  country: string
  date: string
  impact: 'High' | 'Medium' | 'Low' | 'Holiday'
  forecast: string | null
  previous: string | null
  actual: string | null
}

export interface CentralBankRate {
  currency: string
  country: string
  bankName: string
  currentRate: number
  previousRate: number | null
  source: 'live' | 'config'
  lastUpdated: string
}

export interface BarchartRow {
  symbol: string
  name: string
  latest: number
  change: number
  percentChange: number
  open: number
  high: number
  low: number
  standardDeviation?: number
  time: string
}

export interface BarchartMarketData {
  forex: {
    performance: {
      today: { bullish: BarchartRow[]; bearish: BarchartRow[] }
      fiveDay: { bullish: BarchartRow[]; bearish: BarchartRow[] } | null
    }
    surprises: { bullish: BarchartRow[]; bearish: BarchartRow[] }
  }
  futures: {
    performance: {
      today: { bullish: BarchartRow[]; bearish: BarchartRow[] }
      fiveDay: { bullish: BarchartRow[]; bearish: BarchartRow[] } | null
    }
    surprises: { bullish: BarchartRow[]; bearish: BarchartRow[] }
  }
  fetchedAt: string
}

export interface FetchResult {
  // Legacy shape — used by the AI scoring engine
  perfMap: Record<string, number>      // currency → avg % change
  stddevMap: Record<string, number>    // currency → avg std dev (surprises)
  calEvents: CalendarEvent[]           // today's economic events
  // Extended shape — extra context for the AI
  centralBankRates: CentralBankRate[]
  barchart: BarchartMarketData | null
  fetchedAt: Date
  errors: string[]
}

// ─── Compute perfMap from barchart pairs ──────────────────────────────────────
// Aggregates per-currency performance across all pairs.
// Base currency goes positive, quote currency goes inverse.

function buildPerfMap(rows: BarchartRow[]): Record<string, number> {
  const totals: Record<string, { sum: number; count: number }> = {}

  for (const row of rows) {
    const sym = row.symbol.replace(/^\^/, '').toUpperCase()
    if (sym.length !== 6) continue

    const base = sym.slice(0, 3)
    const quote = sym.slice(3, 6)
    const pct = row.percentChange

    if (!totals[base]) totals[base] = { sum: 0, count: 0 }
    if (!totals[quote]) totals[quote] = { sum: 0, count: 0 }

    totals[base].sum += pct
    totals[base].count++
    totals[quote].sum -= pct
    totals[quote].count++
  }

  const map: Record<string, number> = {}
  for (const [cur, { sum, count }] of Object.entries(totals)) {
    if (count > 0) map[cur] = sum / count
  }
  return map
}

function buildStddevMap(rows: BarchartRow[]): Record<string, number> {
  const totals: Record<string, { sum: number; count: number }> = {}

  for (const row of rows) {
    const sym = row.symbol.replace(/^\^/, '').toUpperCase()
    if (sym.length !== 6) continue

    const base = sym.slice(0, 3)
    const quote = sym.slice(3, 6)
    const sd = row.standardDeviation ?? 0

    if (!totals[base]) totals[base] = { sum: 0, count: 0 }
    if (!totals[quote]) totals[quote] = { sum: 0, count: 0 }

    totals[base].sum += Math.abs(sd)
    totals[base].count++
    totals[quote].sum += Math.abs(sd)
    totals[quote].count++
  }

  const map: Record<string, number> = {}
  for (const [cur, { sum, count }] of Object.entries(totals)) {
    if (count > 0) map[cur] = sum / count
  }
  return map
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

// ─── Main fetch — reads all three tables ─────────────────────────────────────

export async function fetchAllMarketData(): Promise<FetchResult> {
  const errors: string[] = []
  let perfMap: Record<string, number> = {}
  let stddevMap: Record<string, number> = {}
  let calEvents: CalendarEvent[] = []
  let centralBankRates: CentralBankRate[] = []
  let barchart: BarchartMarketData | null = null

  // ── 1. Barchart snapshot ────────────────────────────────────────────────
  try {
    const snap = await db.barchartSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    })

    if (snap?.data) {
      barchart = snap.data as unknown as BarchartMarketData

      // Build perfMap from all forex performance pairs (bullish + bearish)
      const allForexPerf = [
        ...barchart.forex.performance.today.bullish,
        ...barchart.forex.performance.today.bearish,
      ]
      perfMap = buildPerfMap(allForexPerf)

      // Build stddevMap from forex surprises
      const allForexSurp = [
        ...barchart.forex.surprises.bullish,
        ...barchart.forex.surprises.bearish,
      ]
      stddevMap = buildStddevMap(allForexSurp)
    } else {
      errors.push('No Barchart snapshot found in DB — Railway sync may not have run yet')
    }
  } catch (err: unknown) {
    errors.push(`Barchart DB read failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── 2. Economic calendar ────────────────────────────────────────────────
  try {
    const snap = await db.economicSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    })

    if (snap?.events) {
      const all = snap.events as unknown as CalendarEvent[]
      const today = todayStr()

      // Filter to today's events for the scoring engine (full week available in barchart field)
      calEvents = all.filter(e => {
        const eDate = new Date(e.date).toISOString().split('T')[0]
        return eDate === today
      })
    } else {
      errors.push('No economic calendar snapshot found in DB')
    }
  } catch (err: unknown) {
    errors.push(`Economic calendar DB read failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── 3. Central bank rates ───────────────────────────────────────────────
  try {
    const snap = await db.ratesSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    })

    if (snap?.rates) {
      centralBankRates = snap.rates as unknown as CentralBankRate[]
    } else {
      errors.push('No rates snapshot found in DB')
    }
  } catch (err: unknown) {
    errors.push(`Rates DB read failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    perfMap,
    stddevMap,
    calEvents,
    centralBankRates,
    barchart,
    fetchedAt: new Date(),
    errors,
  }
}

// ─── Convenience: today's high-impact events ─────────────────────────────────

export async function fetchTodayHighImpactEvents(): Promise<CalendarEvent[]> {
  try {
    const snap = await db.economicSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    })
    if (!snap?.events) return []

    const all = snap.events as unknown as CalendarEvent[]
    const today = todayStr()

    return all.filter(e => {
      const eDate = new Date(e.date).toISOString().split('T')[0]
      return eDate === today && e.impact === 'High'
    })
  } catch {
    return []
  }
}

// ─── Convenience: full week calendar (for AI context) ────────────────────────

export async function fetchWeekCalendar(): Promise<CalendarEvent[]> {
  try {
    const snap = await db.economicSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    })
    return (snap?.events as unknown as CalendarEvent[]) ?? []
  } catch {
    return []
  }
}
