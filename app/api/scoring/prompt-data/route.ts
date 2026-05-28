// app/api/scoring/prompt-data/route.ts
// Exports the same market data + system prompt that /api/alerts would normally
// send to the Claude API. Used by a Claude Desktop "Routine" running on the
// user's subscription instead of API credits.
//
// Auth: Bearer ROUTINE_SECRET (separate from CRON_SECRET so it can be rotated
// independently).
//
// Response shape:
//   {
//     systemPrompt: string,       // RFDM scoring rules
//     userMessage:  string,       // today's market data formatted as the
//                                 // routine prompt
//     responseShape: object,      // JSON schema/example the routine should
//                                 // return
//     dataAgeMinutes: number,     // freshness of the Barchart snapshot used
//   }
import { NextRequest, NextResponse } from 'next/server'
import { RFDM_SYSTEM_PROMPT } from '@/lib/ai-scoring'
import { fetchAllMarketData } from '@/lib/fetchers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const expected = process.env.ROUTINE_SECRET ?? process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

const RESPONSE_SHAPE_EXAMPLE = {
  reasoning: 'Step-by-step explanation of how you ranked the currencies and arrived at the 9-pair matrix...',
  scores: [
    {
      currency: 'GBP',
      total: 5.5,
      fundamental: 3.0,
      price: 1.5,
      stddev: 1.0,
      activeStrength: true,
      confidence: 'High',
      holiday: false,
      notes: ['Retail Sales +0.7% vs 0.0% — massive beat'],
      tag: 'Genuinely strong — active buying',
    },
  ],
  top3: ['GBP', 'EUR', 'CAD'],
  bottom3: ['USD', 'JPY', 'NZD'],
  neutralCurrencies: ['NOK', 'CHF'],
  excludedCurrencies: ['AUD'],
  excludedReasons: ['AUD: Bank Holiday'],
  pairs9: [
    {
      pair: 'GBP/USD',
      direction: 'Long',
      strong: 'GBP',
      weak: 'USD',
      strongScore: 5.5,
      weakScore: -2.5,
      divergence: 8.0,
      grade: 'A+',
      session: ['London', 'New York'],
      reason: 'GBP active strength vs USD broad weakness',
      timeframe: 'short-term',
      pricedInRisk: false,
      confidence: 'High',
    },
  ],
  priority1: {
    pair: 'GBP/USD',
    direction: 'Long',
    strong: 'GBP',
    weak: 'USD',
    divergence: 8.0,
    grade: 'A+',
    reason: 'Highest ranked strong vs highest ranked weak',
  },
  divergenceWarnings: [],
  marketCondition: 'Normal',
  sessionRecommendation: 'GBP/USD on London open',
  date: new Date().toISOString().slice(0, 10),
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // bare=true: caller already has the system prompt (e.g. running inside a
  // Claude Project that has strategy.md + prompt.md in Project Knowledge).
  // We just return the raw market data with a short execution instruction.
  const url = new URL(req.url)
  const bare = url.searchParams.get('bare') === 'true'

  const data = await fetchAllMarketData()
  if (Object.keys(data.perfMap).length === 0 && data.calEvents.length === 0) {
    return NextResponse.json(
      { error: 'No market data available — barchart-sync may not have run yet', details: data.errors },
      { status: 503 },
    )
  }

  // Build the user message — same content scoreWithClaude would send to Claude API.
  // We assemble it inline rather than importing the private builder to keep this
  // endpoint self-contained.
  let userMessage = ''

  // Forex performance
  if (data.barchart?.forex.performance.today) {
    const all = [
      ...data.barchart.forex.performance.today.bullish,
      ...data.barchart.forex.performance.today.bearish,
    ]
    if (all.length > 0) {
      userMessage += `## FOREX PERFORMANCE — ALL PAIRS (raw — do not pre-aggregate; apply base/quote direction rules)\n`
      for (const r of all) userMessage += `${r.symbol}: ${r.percentChange > 0 ? '+' : ''}${r.percentChange}%\n`
      userMessage += '\n'
    }
  }

  // Forex surprises (std dev)
  if (data.barchart?.forex.surprises) {
    const all = [
      ...data.barchart.forex.surprises.bullish,
      ...data.barchart.forex.surprises.bearish,
    ]
    if (all.length > 0) {
      userMessage += `## FOREX PRICE SURPRISES — ALL PAIRS (std dev; positive = unusually strong base, negative = unusually weak base)\n`
      for (const r of all) {
        const sd = r.standardDeviation ?? 0
        userMessage += `${r.symbol}: stddev=${sd} change=${r.percentChange > 0 ? '+' : ''}${r.percentChange}%\n`
      }
      userMessage += '\n'
    }
  }

  // Futures performance
  if (data.barchart?.futures.performance.today) {
    const all = [
      ...data.barchart.futures.performance.today.bullish,
      ...data.barchart.futures.performance.today.bearish,
    ]
    if (all.length > 0) {
      userMessage += `## FUTURES PERFORMANCE — ALL CONTRACTS\n`
      for (const r of all) userMessage += `${r.name || r.symbol}: ${r.percentChange > 0 ? '+' : ''}${r.percentChange}%\n`
      userMessage += '\n'
    }
  }

  // Economic calendar
  if (data.calEvents.length > 0) {
    userMessage += `## ECONOMIC CALENDAR\n`
    for (const e of data.calEvents) {
      const status = e.actual
        ? `Actual: ${e.actual} | Forecast: ${e.forecast || 'n/a'} | Previous: ${e.previous || 'n/a'}`
        : `Not yet released | Forecast: ${e.forecast || 'n/a'}`
      userMessage += `[${e.country}] [${e.impact}] ${e.title} — ${status}\n`
    }
    userMessage += '\n'
  }

  // Central bank rates + macro context (TE matrix scrape adds GDP, inflation, etc.)
  if (data.centralBankRates.length > 0) {
    userMessage += `## CENTRAL BANK RATES + MACRO CONTEXT\n`
    const sorted = [...data.centralBankRates].sort((a, b) => b.currentRate - a.currentRate)
    for (const r of sorted) {
      const rateChange = r.previousRate !== null && r.previousRate !== r.currentRate
        ? ` (prev ${r.previousRate}%)`
        : ''
      const macroParts: string[] = []
      if (r.inflationRate  != null) macroParts.push(`CPI ${r.inflationRate}%`)
      if (r.gdpGrowth      != null) macroParts.push(`GDP ${r.gdpGrowth > 0 ? '+' : ''}${r.gdpGrowth}%`)
      if (r.joblessRate    != null) macroParts.push(`unemp ${r.joblessRate}%`)
      if (r.govBudget      != null) macroParts.push(`budget ${r.govBudget > 0 ? '+' : ''}${r.govBudget}%`)
      if (r.debtToGdp      != null) macroParts.push(`debt/GDP ${r.debtToGdp}%`)
      if (r.currentAccount != null) macroParts.push(`CA ${r.currentAccount > 0 ? '+' : ''}${r.currentAccount}%`)
      const macroStr = macroParts.length ? `  ·  ${macroParts.join(' · ')}` : ''
      userMessage += `${r.currency} (${r.bankName}): rate ${r.currentRate}%${rateChange}${macroStr}\n`
    }
    userMessage += '\n'
  }

  // S&P sectors (risk-on/off)
  if (data.sectors.length > 0) {
    userMessage += `## S&P 500 SECTOR MAP (today's % change — risk-on/off context)\n`
    const sorted = [...data.sectors].sort((a, b) => b.percentChange - a.percentChange)
    for (const s of sorted) userMessage += `${s.sector}${s.symbol ? ` (${s.symbol})` : ''}: ${s.percentChange > 0 ? '+' : ''}${s.percentChange}%\n`
    userMessage += '\n'
  }

  // Open trades (alignment check)
  const openTrades = await db.trade.findMany({
    where: { outcome: 'Open' },
    select: { pair: true, direction: true, strongCcy: true, weakCcy: true, entryPrice: true, slPrice: true, tpPrice: true, grade: true, session: true, divScore: true, date: true },
  })
  if (openTrades.length > 0) {
    userMessage += `## OPEN TRADES — ASSESS ALIGNMENT\n`
    for (const t of openTrades) {
      userMessage += `${t.pair} ${t.direction} | Strong: ${t.strongCcy} | Weak: ${t.weakCcy} | Entry: ${t.entryPrice} | Grade: ${t.grade}\n`
    }
    userMessage += '\n'
  }

  // Compute snapshot age (matches the freshness gate the cron uses)
  const dataAgeMinutes = data.barchart?.fetchedAt
    ? Math.floor((Date.now() - new Date(data.barchart.fetchedAt).getTime()) / 60_000)
    : null

  // bare mode skips the system prompt — the caller's environment (e.g. a
  // Claude Project with strategy.md in knowledge) already provides the rules.
  return NextResponse.json({
    ...(bare ? {} : { systemPrompt: RFDM_SYSTEM_PROMPT }),
    userMessage,
    responseShape: RESPONSE_SHAPE_EXAMPLE,
    dataAgeMinutes,
    instructions: bare
      ? "Apply your project's RFDM rules (from strategy.md and prompt.md in Project Knowledge) to userMessage. Return JSON matching responseShape. POST to /api/scoring/save with Bearer ROUTINE_SECRET."
      : 'Read systemPrompt and userMessage. Return JSON matching responseShape. POST your result to /api/scoring/save with Authorization: Bearer ROUTINE_SECRET.',
    bareMode: bare,
  })
}
