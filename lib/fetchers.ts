// lib/fetchers.ts
// Auto-fetch market data from public APIs — no manual copy-paste needed
// Sources: Barchart internal JSON API + ForexFactory public JSON API

// Maps Barchart symbol (e.g. "EURUSD") → [base, quote]
const BARCHART_PAIR_MAP: Record<string, [string, string]> = {
  // Majors vs USD
  EURUSD: ['EUR', 'USD'], GBPUSD: ['GBP', 'USD'],
  AUDUSD: ['AUD', 'USD'], NZDUSD: ['NZD', 'USD'],
  USDCAD: ['USD', 'CAD'], USDCHF: ['USD', 'CHF'],
  USDJPY: ['USD', 'JPY'], USDNOK: ['USD', 'NOK'],
  USDSEK: ['USD', 'SEK'],
  // EUR crosses
  EURGBP: ['EUR', 'GBP'], EURJPY: ['EUR', 'JPY'],
  EURAUD: ['EUR', 'AUD'], EURCAD: ['EUR', 'CAD'],
  EURCHF: ['EUR', 'CHF'], EURNOK: ['EUR', 'NOK'],
  EURSEK: ['EUR', 'SEK'],
  // GBP crosses
  GBPJPY: ['GBP', 'JPY'], GBPAUD: ['GBP', 'AUD'],
  GBPCAD: ['GBP', 'CAD'], GBPCHF: ['GBP', 'CHF'],
  GBPNZD: ['GBP', 'NZD'],
  // AUD crosses
  AUDJPY: ['AUD', 'JPY'], AUDCAD: ['AUD', 'CAD'],
  AUDCHF: ['AUD', 'CHF'], AUDNZD: ['AUD', 'NZD'],
  // NZD crosses
  NZDJPY: ['NZD', 'JPY'], NZDCAD: ['NZD', 'CAD'],
  NZDCHF: ['NZD', 'CHF'],
  // CAD / CHF crosses
  CADJPY: ['CAD', 'JPY'], CADCHF: ['CAD', 'CHF'],
  CHFJPY: ['CHF', 'JPY'],
  // NOK / SEK crosses
  NOKJPY: ['NOK', 'JPY'], SEKJPY: ['SEK', 'JPY'],
}

export interface CalendarEvent {
  title: string
  country: string   // ISO currency code e.g. "USD"
  date: string      // ISO datetime string
  impact: 'High' | 'Medium' | 'Low' | 'Holiday'
  forecast: string | null
  previous: string | null
  actual: string | null
}

export interface FetchResult {
  perfMap: Record<string, number>   // currency → avg % change (e.g. USD: 0.18)
  calEvents: CalendarEvent[]
  fetchedAt: Date
  errors: string[]
}

function parseBarchartSymbol(symbol: string): [string, string] | null {
  // Symbols come as "^EURUSD" or "EURUSD"
  const raw = symbol.replace(/^\^/, '').toUpperCase().replace(/\s/g, '')
  return BARCHART_PAIR_MAP[raw] || null
}

/**
 * Fetch live forex performance from Barchart's internal JSON API.
 * Returns a map of currency → average % change across all pairs it appears in.
 * e.g. { USD: 0.18, EUR: -0.12, GBP: 0.34, ... }
 */
export async function fetchBarchartPerformance(): Promise<Record<string, number>> {
  const params = new URLSearchParams({
    lists: 'forex.markets.all',
    orderDir: 'desc',
    fields: 'symbol,symbolName,lastPrice,priceChange,percentChange,tradeTime,symbolCode',
    orderBy: 'percentChange',
    meta: 'field.shortName,field.type,field.description,lists.lastUpdate',
    hasOptions: 'true',
    page: '1',
    raw: '1',
  })

  const url = `https://www.barchart.com/proxies/core-api/v1/quotes/get?${params}`

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://www.barchart.com/forex/performance-leaders',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Barchart fetch failed: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  const pairs: Array<{ symbol: string; percentChange: string | number }> = json.data || []

  if (pairs.length === 0) {
    throw new Error('Barchart returned empty data — market may be closed')
  }

  // Aggregate per-currency performance across all pairs
  const ccy: Record<string, { sum: number; count: number }> = {}

  for (const pair of pairs) {
    const parsed = parseBarchartSymbol(pair.symbol)
    if (!parsed) continue

    const [base, quote] = parsed
    const raw = String(pair.percentChange).replace(/[+%]/g, '').trim()
    const pct = parseFloat(raw)
    if (isNaN(pct)) continue

    if (!ccy[base]) ccy[base] = { sum: 0, count: 0 }
    if (!ccy[quote]) ccy[quote] = { sum: 0, count: 0 }

    // Base currency goes in the direction of the pair
    ccy[base].sum += pct
    ccy[base].count++

    // Quote currency is inverse (if EUR/USD goes up, USD effectively goes down vs EUR)
    ccy[quote].sum -= pct
    ccy[quote].count++
  }

  const result: Record<string, number> = {}
  for (const [cur, { sum, count }] of Object.entries(ccy)) {
    if (count > 0) result[cur] = sum / count
  }

  return result
}

// ForexFactory uses ISO country codes that match our currency codes
const FF_SUPPORTED: Set<string> = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'NOK', 'SEK',
])

/**
 * Fetch today's economic calendar from ForexFactory's public JSON API.
 * Filters to today's events and supported currencies only.
 */
export async function fetchForexFactoryCalendar(): Promise<CalendarEvent[]> {
  const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`ForexFactory fetch failed: ${res.status}`)
  }

  const allEvents: Array<{
    title: string
    country: string
    date: string
    impact: string
    forecast: string
    previous: string
    actual: string
  }> = await res.json()

  // Get today's date in UTC (ForexFactory uses US Eastern time for dates,
  // but the JSON ISO strings let us compare properly)
  const nowUtc = new Date()
  const todayStr = nowUtc.toISOString().split('T')[0]

  return allEvents
    .filter(e => {
      if (!FF_SUPPORTED.has(e.country)) return false
      // Compare date portion only
      const evDate = new Date(e.date).toISOString().split('T')[0]
      return evDate === todayStr
    })
    .map(e => ({
      title: e.title,
      country: e.country,
      date: e.date,
      impact: (['High', 'Medium', 'Low', 'Holiday'].includes(e.impact) ? e.impact : 'Low') as CalendarEvent['impact'],
      forecast: e.forecast || null,
      previous: e.previous || null,
      actual: e.actual || null,
    }))
}

/**
 * Fetch all market data needed for scoring in parallel.
 * Returns a FetchResult with perfMap, calEvents, and any errors.
 */
export async function fetchAllMarketData(): Promise<FetchResult> {
  const errors: string[] = []
  let perfMap: Record<string, number> = {}
  let calEvents: CalendarEvent[] = []

  const [perfResult, calResult] = await Promise.allSettled([
    fetchBarchartPerformance(),
    fetchForexFactoryCalendar(),
  ])

  if (perfResult.status === 'fulfilled') {
    perfMap = perfResult.value
  } else {
    errors.push(`Performance fetch failed: ${perfResult.reason?.message || 'Unknown error'}`)
  }

  if (calResult.status === 'fulfilled') {
    calEvents = calResult.value
  } else {
    errors.push(`Calendar fetch failed: ${calResult.reason?.message || 'Unknown error'}`)
  }

  return { perfMap, calEvents, fetchedAt: new Date(), errors }
}
