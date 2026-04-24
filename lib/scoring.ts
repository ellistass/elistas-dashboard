// lib/scoring.ts
// RFDM Currency Scoring Engine
// v2: supports both structured JSON data (auto-fetch) and raw text (manual paste)

import type { CalendarEvent } from './fetchers'

export interface CurrencyScore {
  cur: string
  score: number
  fundamental: number
  pricePerf: number
  stdDev: number
  tag: string
  notes: string[]
}

export interface PairSetup {
  pair: string
  direction: 'Long' | 'Short'
  strong: string
  weak: string
  strongScore: number
  weakScore: number
  divergence: number
  grade: 'A+' | 'B' | 'C' | 'Skip'
  session: string[]
  reason: string
}

export interface ScoringResult {
  top3: CurrencyScore[]
  bottom3: CurrencyScore[]
  pairs9: PairSetup[]
  priority1: PairSetup
  allScores: CurrencyScore[]
  generatedAt: Date
}

// Known forex pairs and their base/quote currencies
const PAIR_MAP: Record<string, [string, string]> = {
  'USD/JPY': ['USD', 'JPY'], 'EUR/USD': ['EUR', 'USD'],
  'GBP/USD': ['GBP', 'USD'], 'AUD/USD': ['AUD', 'USD'],
  'NZD/USD': ['NZD', 'USD'], 'USD/CAD': ['USD', 'CAD'],
  'USD/CHF': ['USD', 'CHF'], 'EUR/GBP': ['EUR', 'GBP'],
  'EUR/JPY': ['EUR', 'JPY'], 'GBP/JPY': ['GBP', 'JPY'],
  'AUD/JPY': ['AUD', 'JPY'], 'NZD/JPY': ['NZD', 'JPY'],
  'EUR/AUD': ['EUR', 'AUD'], 'GBP/AUD': ['GBP', 'AUD'],
  'EUR/CAD': ['EUR', 'CAD'], 'GBP/CHF': ['GBP', 'CHF'],
  'CAD/JPY': ['CAD', 'JPY'], 'CHF/JPY': ['CHF', 'JPY'],
  'USD/NOK': ['USD', 'NOK'], 'EUR/NOK': ['EUR', 'NOK'],
  'USD/SEK': ['USD', 'SEK'], 'EUR/SEK': ['EUR', 'SEK'],
}

// Keywords that map news events to currencies
const CURRENCY_KEYWORDS: Record<string, string[]> = {
  USD: ['u.s. dollar', 'usd', 'unemployment claims', 'nonfarm', 'fed', 'fomc',
        'us pmi', 'flash manufacturing pmi\nusd', 'flash services pmi\nusd',
        'natural gas storage', 'us gdp', 'us cpi', 'us retail'],
  EUR: ['euro', 'eur', 'german', 'germany', 'france', 'french', 'eurozone',
        'ecb', 'buba', 'nagel', 'lagarde', 'flash manufacturing pmi\neur',
        'flash services pmi\neur'],
  GBP: ['british pound', 'gbp', 'sterling', 'uk ', 'united kingdom', 'boe',
        'cbi', 'flash manufacturing pmi\ngbp', 'flash services pmi\ngbp',
        'public sector'],
  JPY: ['japanese yen', 'jpy', 'japan', 'boj', 'tankan', 'flash manufacturing pmi\njpy'],
  CAD: ['canadian', 'cad', 'canada', 'boc', 'ippi', 'rmpi', 'ivey'],
  AUD: ['australian', 'aud', 'australia', 'rba', 'flash manufacturing pmi\naud',
        'flash services pmi\naud'],
  NZD: ['new zealand', 'nzd', 'rbnz', 'nz ', 'credit card spending'],
  CHF: ['swiss franc', 'chf', 'switzerland', 'snb'],
  NOK: ['norwegian', 'nok', 'norway', 'norges'],
  SEK: ['swedish', 'sek', 'sweden', 'riksbank'],
}

// Display names for pair name matching
const CURRENCY_DISPLAY: Record<string, string[]> = {
  USD: ['u.s. dollar', 'us dollar', 'dollar index'],
  EUR: ['euro'],
  GBP: ['british pound', 'pound'],
  JPY: ['japanese yen', 'yen'],
  CAD: ['canadian dollar'],
  AUD: ['australian dollar'],
  NZD: ['new zealand dollar'],
  CHF: ['swiss franc'],
  NOK: ['norwegian krone'],
  SEK: ['swedish krona'],
}

function initScores(): Record<string, CurrencyScore> {
  const scores: Record<string, CurrencyScore> = {}
  Object.keys(CURRENCY_KEYWORDS).forEach(cur => {
    scores[cur] = { cur, score: 0, fundamental: 0, pricePerf: 0, stdDev: 0, tag: '', notes: [] }
  })
  return scores
}

function parseFundamentals(calendar: string, scores: Record<string, CurrencyScore>) {
  if (!calendar) return
  const lines = calendar.split('\n')

  // Look for lines with currency tag + actual vs expected
  // Pattern: "AUD Flash Manufacturing PMI 51.0 49.8" (actual then expected)
  // Or: "AUD\nFlash Manufacturing PMI\n51.0\n49.8"
  const combined = calendar.toLowerCase()

  lines.forEach(line => {
    const lline = line.toLowerCase().trim()
    if (!lline) return

    Object.entries(CURRENCY_KEYWORDS).forEach(([cur, keywords]) => {
      if (!keywords.some(k => combined.includes(k))) return
      if (!keywords.some(k => lline.includes(k.split('\n')[0]))) return

      // Extract numbers from this line and nearby lines
      const nums = line.match(/[\d.]+/g)?.map(Number).filter(n => n > 0 && n < 100000) || []
      if (nums.length >= 2) {
        const actual = nums[0]
        const expected = nums[nums.length - 1]
        if (actual !== expected && !isNaN(actual) && !isNaN(expected)) {
          const beat = actual > expected
          const contribution = beat ? 1 : -1
          scores[cur].fundamental += contribution
          scores[cur].score += contribution * 1.5
          scores[cur].notes.push(`${beat ? '↑' : '↓'} ${line.trim().substring(0, 50)}`)
        }
      }
    })
  })
}

function parsePerformance(perf: string, scores: Record<string, CurrencyScore>) {
  if (!perf) return
  const lines = perf.split('\n')

  lines.forEach(line => {
    const lline = line.toLowerCase()
    const pctMatch = line.match(/([+-]?\d+\.?\d*)%/)
    if (!pctMatch) return
    const pct = parseFloat(pctMatch[1])
    if (isNaN(pct)) return

    // Match pair name in line
    for (const [pair, [base, quote]] of Object.entries(PAIR_MAP)) {
      const baseNames = CURRENCY_DISPLAY[base] || [base.toLowerCase()]
      const quoteNames = CURRENCY_DISPLAY[quote] || [quote.toLowerCase()]

      const matchesBase = baseNames.some(n => lline.includes(n))
      const matchesPair = lline.includes(pair.toLowerCase().replace('/', '/'))

      if (matchesBase || matchesPair) {
        if (scores[base]) {
          scores[base].pricePerf += pct
          scores[base].score += pct > 0 ? 1.5 : pct < 0 ? -1.5 : 0
        }
        if (scores[quote]) {
          // Quote currency is opposite
          scores[quote].score += pct > 0 ? -0.5 : pct < 0 ? 0.5 : 0
        }
        break
      }
    }
  })
}

function parseStdDev(stddev: string, scores: Record<string, CurrencyScore>) {
  if (!stddev) return
  const lines = stddev.split('\n')

  lines.forEach(line => {
    const lline = line.toLowerCase()
    const sdMatch = line.match(/([+-]?\d+\.?\d+)/)
    if (!sdMatch) return
    const sd = parseFloat(sdMatch[1])
    if (isNaN(sd) || Math.abs(sd) > 5) return

    for (const [pair, [base, quote]] of Object.entries(PAIR_MAP)) {
      const baseNames = CURRENCY_DISPLAY[base] || [base.toLowerCase()]
      const matchesBase = baseNames.some(n => lline.includes(n))
      const matchesPair = lline.includes(pair.toLowerCase().replace('/', '/'))

      if (matchesBase || matchesPair) {
        if (scores[base]) {
          scores[base].stdDev += sd
          scores[base].score += sd > 0 ? 0.8 : sd < 0 ? -0.8 : 0
        }
        if (scores[quote]) {
          scores[quote].score += sd > 0 ? -0.3 : sd < 0 ? 0.3 : 0
        }
        break
      }
    }
  })
}

function parseFutures(futures: string, scores: Record<string, CurrencyScore>) {
  if (!futures) return
  const lines = futures.split('\n')
  const curFutures: Record<string, string[]> = {
    USD: ['u.s. dollar index', 'dollar index'],
    EUR: ['euro fx'],
    GBP: ['british pound'],
    JPY: ['japanese yen'],
    CAD: ['canadian dollar'],
    AUD: ['australian dollar'],
    NZD: ['new zealand dollar'],
    CHF: ['swiss franc'],
  }

  lines.forEach(line => {
    const lline = line.toLowerCase()
    const pctMatch = line.match(/([+-]?\d+\.?\d*)%/)
    const sdMatch = line.match(/([+-]?\d+\.?\d+)/)
    const val = pctMatch ? parseFloat(pctMatch[1]) : sdMatch ? parseFloat(sdMatch[1]) : NaN
    if (isNaN(val)) return

    Object.entries(curFutures).forEach(([cur, names]) => {
      if (names.some(n => lline.includes(n))) {
        if (scores[cur]) {
          scores[cur].score += val > 0 ? 0.5 : val < 0 ? -0.5 : 0
        }
      }
    })
  })
}

function buildTag(s: CurrencyScore): string {
  const parts: string[] = []
  if (s.fundamental > 0) parts.push(`fund +${s.fundamental.toFixed(0)}`)
  else if (s.fundamental < 0) parts.push(`fund ${s.fundamental.toFixed(0)}`)
  if (s.pricePerf !== 0) parts.push(`price ${s.pricePerf > 0 ? '+' : ''}${s.pricePerf.toFixed(2)}%`)
  if (s.stdDev !== 0) parts.push(`σ ${s.stdDev > 0 ? '+' : ''}${s.stdDev.toFixed(2)}`)
  return parts.slice(0, 2).join(' · ') || 'No data'
}

function findPair(a: string, b: string): string {
  const fwd = `${a}/${b}`
  const rev = `${b}/${a}`
  if (PAIR_MAP[fwd]) return fwd
  if (PAIR_MAP[rev]) return rev
  return fwd // fallback even if not in map
}

function gradeSetup(divergence: number): 'A+' | 'B' | 'C' | 'Skip' {
  if (divergence >= 10) return 'A+'
  if (divergence >= 6) return 'B'
  if (divergence >= 3) return 'C'
  return 'Skip'
}

function getBestSession(pair: string): string[] {
  const [base, quote] = pair.split('/')
  const jpyPairs = ['AUD/JPY', 'NZD/JPY', 'EUR/JPY', 'GBP/JPY', 'USD/JPY', 'CAD/JPY', 'CHF/JPY']
  const gbpEurPairs = ['EUR/USD', 'GBP/USD', 'EUR/GBP', 'GBP/CHF', 'GBP/AUD', 'EUR/AUD', 'EUR/CAD']
  if (jpyPairs.includes(pair)) return ['Tokyo', 'London']
  if (gbpEurPairs.includes(pair)) return ['London', 'New York']
  return ['London', 'New York']
}

export function scoreCurrencies(
  calendar: string,
  perf: string,
  stddev: string,
  futures: string = ''
): ScoringResult {
  const scores = initScores()

  parseFundamentals(calendar, scores)
  parsePerformance(perf, scores)
  parseStdDev(stddev, scores)
  parseFutures(futures, scores)

  // Build tag for each
  Object.values(scores).forEach(s => { s.tag = buildTag(s) })

  // Sort all currencies by score
  const allScores = Object.values(scores)
    .filter(s => Math.abs(s.score) > 0.1)
    .sort((a, b) => b.score - a.score)

  const top3 = allScores.slice(0, 3)
  const bottom3 = allScores.slice(-3).reverse()

  // Build 9-pair matrix
  const pairs9: PairSetup[] = []
  top3.forEach(strong => {
    bottom3.forEach(weak => {
      const pair = findPair(strong.cur, weak.cur)
      const [base] = pair.split('/')
      const direction: 'Long' | 'Short' = base === strong.cur ? 'Long' : 'Short'
      const divergence = Math.abs(strong.score - weak.score)
      const grade = gradeSetup(divergence)
      const sessions = getBestSession(pair)

      pairs9.push({
        pair,
        direction,
        strong: strong.cur,
        weak: weak.cur,
        strongScore: strong.score,
        weakScore: weak.score,
        divergence,
        grade,
        session: sessions,
        reason: `${strong.cur} strength (${strong.tag}) vs ${weak.cur} weakness (${weak.tag})`,
      })
    })
  })

  pairs9.sort((a, b) => b.divergence - a.divergence)
  const priority1 = pairs9[0]

  return {
    top3,
    bottom3,
    pairs9,
    priority1,
    allScores,
    generatedAt: new Date(),
  }
}

// Format alert message for Telegram
export function formatTelegramAlert(result: ScoringResult, session: string): string {
  const { top3, bottom3, priority1, pairs9 } = result
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

  const top3str = top3.map((c, i) => `${i + 1}. ${c.cur} +${c.score.toFixed(1)} — ${c.tag}`).join('\n')
  const bot3str = bottom3.map((c, i) => `${i + 1}. ${c.cur} ${c.score.toFixed(1)} — ${c.tag}`).join('\n')
  const aplus = pairs9.filter(p => p.grade === 'A+').map(p => `${p.pair} ${p.direction}`).join(', ')
  const bGrade = pairs9.filter(p => p.grade === 'B').map(p => `${p.pair} ${p.direction}`).join(', ')

  return `🎯 *RFDM Alert — ${session} Session*
📅 ${date}

*Strongest (Top 3)*
${top3str}

*Weakest (Bottom 3)*
${bot3str}

*Priority Setup*
📊 ${priority1.pair} ${priority1.direction} — Divergence: ${priority1.divergence.toFixed(1)}
${priority1.reason}

*Graded Setups*
${aplus ? `✅ A+: ${aplus}` : ''}
${bGrade ? `⚡ B: ${bGrade}` : ''}

*Reminder*
→ Wait for H1 candle to fully close
→ Declare Model A or B before entry
→ Minimum R:R 1:2
→ No entries 30min after session open`
}

// ─── V2: Score from structured auto-fetched data ────────────────────────────

/**
 * Score currencies from structured data (Barchart JSON + ForexFactory JSON).
 * This replaces manual copy-paste with auto-fetched clean data.
 *
 * @param perfMap       per-currency average % change from Barchart (e.g. { USD: 0.18 })
 * @param calEvents     today's ForexFactory calendar events
 * @param stdDevMap     optional per-currency std dev scores (Barchart price surprises)
 */
export function scoreCurrenciesFromData(
  perfMap: Record<string, number>,
  calEvents: CalendarEvent[],
  stdDevMap?: Record<string, number>
): ScoringResult {
  const scores = initScores()

  // ── 1. Price performance pillar (weight: 1.5×) ────────────────────────────
  // perfMap gives avg % change for each currency across all pairs it trades in.
  // Scale factor: ±0.2% avg = notable move for forex (typical daily range is 0.1–0.5%)
  const PERF_SCALE = 4 // multiplier to convert % into score contribution

  for (const [cur, avgPct] of Object.entries(perfMap)) {
    if (!scores[cur]) continue
    scores[cur].pricePerf = avgPct

    // Cap contribution at ±3 to prevent outliers from dominating
    const contribution = Math.max(-3, Math.min(3, avgPct * PERF_SCALE))
    scores[cur].score += contribution * 1.5

    if (Math.abs(avgPct) > 0.05) {
      scores[cur].notes.push(
        `${avgPct > 0 ? '↑' : '↓'} price ${avgPct > 0 ? '+' : ''}${avgPct.toFixed(3)}% avg`
      )
    }
  }

  // ── 2. Fundamentals pillar (weight: 1.5×) ─────────────────────────────────
  // Compare actual vs forecast for High/Medium impact events.
  // High impact beat/miss = ±2, Medium = ±1
  for (const event of calEvents) {
    const cur = event.country
    if (!scores[cur]) continue
    if (!event.actual || !event.forecast) continue // event hasn't released yet
    if (event.impact === 'Low' || event.impact === 'Holiday') continue

    const actual = parseFloat(event.actual.replace(/[^0-9.\-]/g, ''))
    const forecast = parseFloat(event.forecast.replace(/[^0-9.\-]/g, ''))
    if (isNaN(actual) || isNaN(forecast)) continue

    // Tolerance: 0.1% difference to avoid noise from rounding
    const diff = actual - forecast
    if (Math.abs(diff) < 0.001) continue

    const beat = diff > 0
    const impactWeight = event.impact === 'High' ? 2 : 1
    const contribution = beat ? impactWeight : -impactWeight

    scores[cur].fundamental += contribution
    scores[cur].score += contribution * 1.5
    scores[cur].notes.push(
      `${beat ? '↑' : '↓'} ${event.title.substring(0, 40)} (${event.impact})`
    )
  }

  // ── 3. Std dev / price surprises pillar (weight: 0.8×) ────────────────────
  if (stdDevMap) {
    for (const [cur, sd] of Object.entries(stdDevMap)) {
      if (!scores[cur]) continue
      scores[cur].stdDev = sd
      const contribution = Math.max(-2, Math.min(2, sd))
      scores[cur].score += contribution * 0.8
      if (Math.abs(sd) > 0.2) {
        scores[cur].notes.push(`σ ${sd > 0 ? '+' : ''}${sd.toFixed(2)}`)
      }
    }
  }

  // ── Build tags and sort ────────────────────────────────────────────────────
  Object.values(scores).forEach(s => { s.tag = buildTag(s) })

  const allScores = Object.values(scores).sort((a, b) => b.score - a.score)

  // Include currencies with any score activity (even zero if they had data)
  const active = allScores.filter(s => {
    const hasPerfData = perfMap[s.cur] !== undefined
    const hasFundData = calEvents.some(e => e.country === s.cur && e.actual)
    return hasPerfData || hasFundData || Math.abs(s.score) > 0
  })

  const scored = active.length >= 6 ? active : allScores

  const top3 = scored.slice(0, 3)
  const bottom3 = scored.slice(-3).reverse()

  // ── Build 9-pair matrix ────────────────────────────────────────────────────
  const pairs9: PairSetup[] = []
  top3.forEach(strong => {
    bottom3.forEach(weak => {
      if (strong.cur === weak.cur) return
      const pair = findPair(strong.cur, weak.cur)
      const [base] = pair.split('/')
      const direction: 'Long' | 'Short' = base === strong.cur ? 'Long' : 'Short'
      const divergence = Math.abs(strong.score - weak.score)
      const grade = gradeSetup(divergence)
      const sessions = getBestSession(pair)

      pairs9.push({
        pair,
        direction,
        strong: strong.cur,
        weak: weak.cur,
        strongScore: strong.score,
        weakScore: weak.score,
        divergence,
        grade,
        session: sessions,
        reason: `${strong.cur} strength (${strong.tag}) vs ${weak.cur} weakness (${weak.tag})`,
      })
    })
  })

  pairs9.sort((a, b) => b.divergence - a.divergence)
  const priority1 = pairs9[0]

  return {
    top3,
    bottom3,
    pairs9,
    priority1: priority1 || pairs9[0],
    allScores: scored,
    generatedAt: new Date(),
  }
}

/**
 * Check alignment status for an open trade against current scores.
 * Returns Green / Amber / Red.
 */
export function checkTradeAlignment(
  trade: { strongCcy: string; weakCcy: string; direction: string; pair: string },
  currentScores: ScoringResult
): { status: 'Green' | 'Amber' | 'Red'; reason: string } {
  const top3Curs = new Set(currentScores.top3.map(c => c.cur))
  const bottom3Curs = new Set(currentScores.bottom3.map(c => c.cur))

  const strongStillTop = top3Curs.has(trade.strongCcy)
  const weakStillBottom = bottom3Curs.has(trade.weakCcy)

  if (strongStillTop && weakStillBottom) {
    return { status: 'Green', reason: `${trade.strongCcy} still top 3 · ${trade.weakCcy} still bottom 3` }
  }

  if (!strongStillTop && !weakStillBottom) {
    return {
      status: 'Red',
      reason: `⚠️ ${trade.strongCcy} dropped out of top 3 AND ${trade.weakCcy} left bottom 3 — setup invalidated`,
    }
  }

  // One side is out of place → Amber
  const reason = !strongStillTop
    ? `${trade.strongCcy} no longer in top 3 — monitor closely`
    : `${trade.weakCcy} no longer in bottom 3 — monitor closely`

  return { status: 'Amber', reason }
}
