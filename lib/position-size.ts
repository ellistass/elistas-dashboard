// lib/position-size.ts — shared lot-size math for the dashboard calculator
// and the analytics rule-violation detectors.
//
// Approach: USD-quote pairs are exact ($10/pip on 1 lot for any pair quoted in USD).
// Cross pairs use an approximation: we assume the user trades primarily USD-funded
// accounts, so a pip on EUR/GBP is roughly $13 on 1.0 lot at ~1.30 GBPUSD.
// For prop-firm-grade precision you'd use live conversion rates; for "size sanity
// check" purposes this is within ~5% across most G10 crosses.

export function pipSize(pair: string): number {
  const s = pair.replace('/', '').toUpperCase()
  if (s.includes('JPY')) return 0.01
  if (s.startsWith('XAU')) return 0.1
  if (s.startsWith('XAG')) return 0.01
  return 0.0001
}

// Approximate value of 1 pip on 1 standard lot, expressed in account currency.
// For USD accounts this matches broker spec to within a few percent.
function pipValueOneLotUsd(pair: string): number {
  const [base, quote] = pair.replace('/', '').match(/.{1,3}/g) ?? ['', '']
  // USD as quote (EURUSD, GBPUSD, AUDUSD, NZDUSD, etc.): $10/pip on 1 lot.
  if (quote === 'USD') return 10
  // USD as base (USDJPY, USDCHF, USDCAD): pip value depends on current price
  // but is close to $7-10 for most. Use $9.5 as a safe average.
  if (base === 'USD') {
    if (quote === 'JPY') return 6.7   // approx at USDJPY ~150
    return 9.5
  }
  // Metals
  if (base === 'XAU') return 10       // 1 lot = 100 oz; pip = $0.1 / oz × 100 = $10
  if (base === 'XAG') return 50       // 1 lot = 5000 oz; pip = $0.01 / oz × 5000 = $50
  // Crosses (EURJPY, GBPJPY, EURGBP, etc.) — rough average
  if (pair.includes('JPY')) return 6.5
  return 11
}

export function riskInAccountCcy(balance: number, riskPct: number): number {
  return (balance * riskPct) / 100
}

export function lotSizeFor(params: {
  riskDollars: number
  stopPips: number
  pair: string
  accountCcy: string
}): number {
  const { riskDollars, stopPips, pair } = params
  if (stopPips <= 0 || riskDollars <= 0) return 0
  const pipValue = pipValueOneLotUsd(pair)
  const lots = riskDollars / (stopPips * pipValue)
  // Brokers floor lot sizes to 2 decimals (0.01 minimum on most retail accounts)
  return Math.max(0.01, Math.round(lots * 100) / 100)
}
