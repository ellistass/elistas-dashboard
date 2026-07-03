'use client'
// app/_components/dashboard/MarketContext.tsx
// Secondary market-context cards carried over from the old dashboard:
// S&P sector map, central-bank macro snapshot, and session windows.
// Rendered below Open positions in the left column — informative, not primary.

import { BarChart3, Landmark, Clock3 } from 'lucide-react'

interface SectorRow { sector: string; symbol?: string; percentChange: number }
interface RateRow {
  currency: string; bankName: string; currentRate: number
  previousRate: number | null; source?: string
  inflationRate?: number | null; gdpGrowth?: number | null
}

function fmt(n: unknown, digits = 1): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—'
}
function fmtSigned(n: unknown, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(digits)
}
function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

const SESSIONS = [
  { name: 'Tokyo', time: '1am – 7am', prime: false },
  { name: 'London', time: '8am – 1pm', prime: true },
  { name: 'Pre-NY', time: '1pm – 3pm', prime: false },
  { name: 'New York', time: '3pm – 10pm', prime: true },
]

export function MarketContext({ sectors, rates, regime, session, barchartFetchedAt }: {
  sectors: SectorRow[]
  rates: RateRow[]
  regime: string
  session: string | null
  barchartFetchedAt?: string | null
}) {
  return (
    <div className="dash-context-grid">
      {/* S&P sector map */}
      {sectors.length > 0 && (
        <div className="card" style={{ padding: '15px 17px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <BarChart3 size={12} strokeWidth={2} />
              S&amp;P sectors
            </span>
            {regime && <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{regime}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...sectors].sort((a, b) => b.percentChange - a.percentChange).map((s) => {
              const pos = s.percentChange >= 0
              const mag = Math.min(Math.abs(s.percentChange) / 2, 1)
              const barW = Math.max(mag * 100, 4)
              return (
                <div key={s.sector} style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr 48px',
                  alignItems: 'center', gap: 8, fontSize: 11,
                }}>
                  <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={`${s.sector}${s.symbol ? ` (${s.symbol})` : ''}`}>
                    {s.sector}
                  </span>
                  <div style={{ height: 5, background: 'var(--bg-inset)', borderRadius: 3, position: 'relative' }}>
                    <div style={{
                      position: 'absolute', top: 0, bottom: 0,
                      [pos ? 'left' : 'right']: '50%',
                      width: `${barW / 2}%`,
                      background: pos ? 'var(--green)' : 'var(--red)',
                      borderRadius: 3,
                    }} />
                    <div style={{ position: 'absolute', top: -2, bottom: -2, left: '50%', width: 1, background: 'var(--border)' }} />
                  </div>
                  <span className="font-mono" style={{ fontSize: 11, fontWeight: 500, textAlign: 'right', color: pos ? 'var(--green)' : 'var(--red)' }}>
                    {fmtSigned(s.percentChange, 2)}%
                  </span>
                </div>
              )
            })}
          </div>
          {barchartFetchedAt && (
            <p className="font-mono" style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 10, marginBottom: 0 }}>
              updated {timeAgo(barchartFetchedAt)}
            </p>
          )}
        </div>
      )}

      {/* Macro snapshot — rates + CPI + GDP */}
      {rates.length > 0 && (
        <div className="card" style={{ padding: '15px 17px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Landmark size={12} strokeWidth={2} />
              Macro snapshot
            </span>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {rates.some((r) => r.inflationRate != null) ? 'matrix'
                : rates.some((r) => r.source === 'scraped') ? 'rates only' : 'config'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[...rates].sort((a, b) => b.currentRate - a.currentRate).map((r) => {
              const realRate = (r.currentRate != null && r.inflationRate != null)
                ? r.currentRate - r.inflationRate : null
              return (
                <div key={r.currency} style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-2)' }} title={r.bankName}>{r.currency}</span>
                    <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{fmt(r.currentRate, 2)}%</span>
                  </div>
                  {(r.inflationRate != null || r.gdpGrowth != null) && (
                    <div className="font-mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 9, color: 'var(--text-3)', marginTop: 1 }}>
                      {r.inflationRate != null && <span title="CPI inflation">CPI {r.inflationRate}%</span>}
                      {r.gdpGrowth != null && (
                        <span title="Quarterly GDP growth" style={{ color: r.gdpGrowth >= 0 ? 'var(--text-3)' : 'var(--red)' }}>
                          GDP {r.gdpGrowth > 0 ? '+' : ''}{r.gdpGrowth}%
                        </span>
                      )}
                      {realRate != null && <span title="Real rate = nominal − CPI">real {fmtSigned(realRate, 2)}%</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Session windows */}
      <div className="card" style={{ padding: '15px 17px' }}>
        <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Clock3 size={12} strokeWidth={2} />
          Sessions — WAT
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SESSIONS.map((s) => {
            const active = s.name === session
            return (
              <div key={s.name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 11px', borderRadius: 8,
                background: active ? 'var(--green-dim)' : 'var(--bg-inset)',
                border: `1px solid ${active ? 'var(--green-border)' : 'var(--border-subtle)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {active && <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />}
                  <span style={{ fontSize: 12, fontWeight: 500, color: active ? 'var(--green)' : 'var(--text-2)' }}>{s.name}</span>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.time}</span>
                </div>
                {s.prime && (
                  <span className="font-mono" style={{
                    fontSize: 9, fontWeight: 500, letterSpacing: '0.08em',
                    padding: '1px 7px', borderRadius: 999,
                    background: active ? 'var(--green-dim)' : 'var(--bg-elevated)',
                    color: active ? 'var(--green)' : 'var(--text-3)',
                    border: `1px solid ${active ? 'var(--green-border)' : 'var(--border)'}`,
                  }}>PRIME</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
