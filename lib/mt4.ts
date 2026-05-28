// lib/mt4.ts — helpers for the MT4 auto-logging endpoint.
//   • Per-trade risk-% calculation from MT4 fields
//   • Symbol → "PAIR/FORMAT" normalisation (FTMO has e.g. "EURUSDm" suffix)
//   • Inference helpers (strong/weak currency, session) for auto-logged trades

const SESSIONS_WAT: Array<{ name: string; startHourUtc: number; endHourUtc: number }> = [
  // hours stored in UTC; WAT = UTC+1
  { name: 'Tokyo',    startHourUtc: 0, endHourUtc: 6 },   // 1am–7am WAT
  { name: 'London',   startHourUtc: 7, endHourUtc: 13 },  // 8am–2pm WAT
  { name: 'New York', startHourUtc: 14, endHourUtc: 17 }, // 3pm–6pm WAT
]

export function sessionFromUtcHour(utcHour: number): string {
  for (const s of SESSIONS_WAT) {
    if (utcHour >= s.startHourUtc && utcHour <= s.endHourUtc) return s.name
  }
  return 'Off-hours'
}

// Normalise MT4 broker symbols. Brokers add suffixes (e.g. EURUSDm, EURUSD.r, EURUSD#) for
// account types. Strip non-alpha, then format as "BASE/QUOTE" for the existing journal UI.
export function normaliseSymbol(symbol: string): { pair: string; base: string; quote: string } {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z]/g, '')
  // Forex pairs are 6 letters. Metals (XAUUSD, XAGUSD) handled as 6 letters too — XAU/USD reads fine.
  if (cleaned.length >= 6) {
    const base = cleaned.slice(0, 3)
    const quote = cleaned.slice(3, 6)
    return { pair: `${base}/${quote}`, base, quote }
  }
  return { pair: cleaned, base: cleaned, quote: '' }
}

// Risk % calculation. The EA sends us:
//   lotSize, entryPrice, slPrice, accountBalance,
//   pipValuePerLot (broker-supplied — how much one pip is worth on one full lot, in account currency)
// We derive risk in account currency = stopDistanceInPips × pipValuePerLot × lotSize.
// Then divide by accountBalance for the percentage.
//
// pipDigits: most pairs have pip at 4 decimals (5-digit broker → divide diff by 0.0001),
//            JPY pairs have pip at 2 decimals (3-digit broker → divide by 0.01),
//            XAU at 1 decimal (XAUUSD pip = $0.10).
export function pipSize(symbol: string): number {
  const s = symbol.toUpperCase()
  if (s.includes('JPY')) return 0.01
  if (s.startsWith('XAU')) return 0.1
  if (s.startsWith('XAG')) return 0.01
  return 0.0001
}

export function riskPercent(params: {
  entryPrice: number
  slPrice: number
  lotSize: number
  pipValuePerLot: number
  accountBalance: number
  symbol: string
}): number | null {
  const { entryPrice, slPrice, lotSize, pipValuePerLot, accountBalance, symbol } = params
  if (!entryPrice || !slPrice || !lotSize || !pipValuePerLot || !accountBalance) return null

  const pip = pipSize(symbol)
  const pipsAtRisk = Math.abs(entryPrice - slPrice) / pip
  const lossAtSL = pipsAtRisk * pipValuePerLot * lotSize
  return Number(((lossAtSL / accountBalance) * 100).toFixed(3))
}

// Compute R-multiple from MT4 fields. resultR = realized profit / planned loss at SL.
export function resultR(params: {
  entryPrice: number
  slPrice: number
  closePrice: number
  direction: 'Long' | 'Short'
  symbol: string
}): number | null {
  const { entryPrice, slPrice, closePrice, direction, symbol } = params
  const pip = pipSize(symbol)
  const riskPips = Math.abs(entryPrice - slPrice) / pip
  if (riskPips === 0) return null
  const profitPips =
    direction === 'Long'
      ? (closePrice - entryPrice) / pip
      : (entryPrice - closePrice) / pip
  return Number((profitPips / riskPips).toFixed(2))
}

// MT4 OrderType integer → direction. 0=buy 1=sell 2=buylimit 3=selllimit 4=buystop 5=sellstop
// We only auto-log filled orders (buy/sell, types 0/1).
export function directionFromOrderType(orderType: number): 'Long' | 'Short' | null {
  if (orderType === 0) return 'Long'
  if (orderType === 1) return 'Short'
  return null
}
