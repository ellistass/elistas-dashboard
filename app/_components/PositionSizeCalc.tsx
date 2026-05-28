'use client'
// app/_components/PositionSizeCalc.tsx
// Sidebar-friendly position-size calculator. Vertical stack of inputs so it
// fits a narrow 320px column without overflowing. Pair input has a small
// chevron-style datalist of common pairs.

import { useMemo, useState } from 'react'
import { pipSize, riskInAccountCcy, lotSizeFor } from '@/lib/position-size'

interface AccountLite {
  id: string
  name: string
  currency: string
  currentBalance: number
}

const COMMON_PAIRS = [
  'EUR/USD', 'GBP/USD', 'AUD/USD', 'NZD/USD',
  'USD/JPY', 'USD/CAD', 'USD/CHF',
  'EUR/GBP', 'EUR/JPY', 'GBP/JPY',
  'XAU/USD', 'XAG/USD',
]

export function PositionSizeCalc({ accounts, defaultPair }: {
  accounts: AccountLite[]
  defaultPair?: string
}) {
  const [pair,   setPair]   = useState(defaultPair ?? 'GBP/USD')
  const [entry,  setEntry]  = useState<string>('')
  const [sl,     setSl]     = useState<string>('')
  const [riskPct, setRiskPct] = useState<string>('0.5')

  const results = useMemo(() => {
    const e = parseFloat(entry), s = parseFloat(sl), r = parseFloat(riskPct)
    if (!Number.isFinite(e) || !Number.isFinite(s) || !Number.isFinite(r)) return []
    if (e === s) return []
    const pip = pipSize(pair)
    const stopPips = Math.abs(e - s) / pip
    return accounts.map((a) => {
      const riskDollars = riskInAccountCcy(a.currentBalance, r)
      const lots = lotSizeFor({ riskDollars, stopPips, pair, accountCcy: a.currency })
      return { account: a, lots, riskDollars, stopPips }
    })
  }, [pair, entry, sl, riskPct, accounts])

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    minWidth: 0,        // critical: lets inputs shrink to fit the container
    padding: '7px 10px',
    fontSize: 12,
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 3,
    display: 'block',
  }

  return (
    <div className="card" style={{ padding: '14px 16px', minWidth: 0 }}>
      <p className="section-label" style={{ marginTop: 0, marginBottom: 10 }}>Position size</p>

      {/* Pair on its own row */}
      <div style={{ marginBottom: 8 }}>
        <span style={labelStyle}>Pair</span>
        <input
          list="ps-pair-list"
          value={pair}
          onChange={(e) => setPair(e.target.value.toUpperCase())}
          style={fieldStyle}
          placeholder="GBP/USD"
        />
        <datalist id="ps-pair-list">
          {COMMON_PAIRS.map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>

      {/* Entry + SL on one row — 2 cols, each minmax(0,1fr) so they never overflow */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 8,
        marginBottom: 8,
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Entry</span>
          <input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="1.2640" style={fieldStyle} />
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>SL</span>
          <input value={sl} onChange={(e) => setSl(e.target.value)} placeholder="1.2580" style={fieldStyle} />
        </div>
      </div>

      {/* Risk % */}
      <div style={{ marginBottom: 4 }}>
        <span style={labelStyle}>Risk %</span>
        <input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} placeholder="0.5" style={fieldStyle} />
      </div>

      {results.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
          Enter entry + SL to see lot sizes per account.
        </p>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {results.map((r) => (
            <div key={r.account.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '7px 10px', background: 'var(--bg-card-2)', borderRadius: 6,
              minWidth: 0,
            }}>
              <span style={{ color: 'var(--text-2)', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.account.name}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <span className="font-mono" style={{ color: 'var(--text-1)', fontWeight: 500, fontSize: 12 }}>
                  {r.lots.toFixed(2)} lots
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 10 }}>
                  ${Math.round(r.riskDollars)} · {r.stopPips.toFixed(0)} pips
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
