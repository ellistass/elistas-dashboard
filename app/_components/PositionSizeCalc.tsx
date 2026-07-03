'use client'
// app/_components/PositionSizeCalc.tsx
// Right-rail position-size calculator (v2). Same math as before — entry + SL
// prices derive stop pips, then risk % of each active account's live balance
// gives lot size + $ risk per account.

import { useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
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
    minWidth: 0,
    padding: '7px 10px',
    fontSize: 12,
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    fontWeight: 500,
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    marginBottom: 4,
    display: 'block',
  }

  return (
    <div className="card" style={{ padding: '15px 17px', minWidth: 0 }}>
      <div className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <Calculator size={12} strokeWidth={2} />
        Position size
      </div>

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

      {/* Entry + SL side by side (these derive SL pips) */}
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

      {/* SL pips (derived) + Risk % side by side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 8,
        marginBottom: 4,
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>SL pips</span>
          <div className="font-mono" style={{
            ...fieldStyle,
            background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
            borderRadius: 8, color: results.length > 0 ? 'var(--text-1)' : 'var(--text-3)',
          }}>
            {results.length > 0 ? results[0].stopPips.toFixed(0) : '—'}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Risk %</span>
          <input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} placeholder="0.5" style={fieldStyle} />
        </div>
      </div>

      {results.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
          Enter entry + SL to see lot sizes per account.
        </p>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.map((r) => (
            <div key={r.account.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 11px', background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)', borderRadius: 8,
              minWidth: 0, gap: 10,
            }}>
              <span style={{ color: 'var(--text-2)', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.account.name}
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
                <span className="font-mono" style={{ color: 'var(--text-1)', fontWeight: 500, fontSize: 17 }}>
                  {r.lots.toFixed(2)}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}> lots</span>
                </span>
                <span className="font-mono" style={{ color: 'var(--green)', fontWeight: 500, fontSize: 14 }}>
                  ${Math.round(r.riskDollars)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
