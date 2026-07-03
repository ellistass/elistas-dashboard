'use client'
// app/_components/dashboard/StrengthRead.tsx
// "Currency strength read" card — RFDM strongest vs weakest with strength bars.
// Maps directly onto the scoring result's top3 / bottom3 (notes = tag field).
// Neutral / excluded / all-score chips kept below a divider so nothing from the
// old Currency Ranking card is lost.

import { ArrowLeftRight, TrendingUp, TrendingDown, Zap } from 'lucide-react'

interface CurrencyScore { cur: string; score: number; tag: string }
interface ScoresLite {
  top3: CurrencyScore[]
  bottom3: CurrencyScore[]
  priority1?: { divergence: number } | null
  allScores?: CurrencyScore[]
  neutralCurrencies?: string[]
  excludedCurrencies?: string[]
  excludedReasons?: string[]
}

/** Empty state shown in place of the strength read before any analysis run. */
export function EmptyScoreHero({ session, scoring, onRun }: {
  session: string | null
  scoring: boolean
  onRun: () => void
}) {
  return (
    <div className="card" style={{
      padding: scoring ? '28px 24px' : '18px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      backgroundImage: 'radial-gradient(ellipse at top right, rgba(58,212,236,0.05) 0%, transparent 60%)',
    }}>
      {scoring ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.75s linear infinite', marginBottom: 10 }} />
          <p style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 500, margin: 0 }}>Claude is analysing the markets…</p>
        </div>
      ) : (
        <>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Zap size={14} strokeWidth={2} style={{ color: 'var(--accent)' }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>
                Ready to score the {session ? `${session.toLowerCase()} session` : 'market'}
              </p>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
              Rank all 10 currencies, build the 9-pair matrix and surface today's setups.
            </p>
          </div>
          <button onClick={onRun}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 20px', borderRadius: 9, border: 'none',
              background: 'var(--accent)', color: 'var(--accent-on)',
              boxShadow: 'var(--accent-glow)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
            <Zap size={14} strokeWidth={2} />
            Run Analysis
          </button>
        </>
      )}
    </div>
  )
}

function fmtSigned(n: unknown, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(digits)
}

function StrengthTile({ kind, rows, maxAbs }: {
  kind: 'strong' | 'weak'
  rows: CurrencyScore[]
  maxAbs: number
}) {
  const strong = kind === 'strong'
  const color = strong ? 'var(--green)' : 'var(--red)'
  const Icon = strong ? TrendingUp : TrendingDown
  return (
    <div style={{
      background: strong ? 'rgba(35,224,160,0.05)' : 'rgba(255,84,112,0.05)',
      border: `1px solid ${strong ? 'var(--green-border)' : 'var(--red-border)'}`,
      borderRadius: 10, padding: '12px 14px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon size={13} strokeWidth={2} style={{ color }} />
        <span className="kicker" style={{ color }}>{strong ? 'Strongest' : 'Weakest'}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {rows.map((c) => {
          const pct = maxAbs > 0 ? Math.max(6, Math.min(100, (Math.abs(c.score ?? 0) / maxAbs) * 100)) : 6
          return (
            <div key={c.cur} style={{ minWidth: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 48px', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{c.cur}</span>
                <div style={{ height: 5, background: 'var(--bg-inset)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
                <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color, textAlign: 'right' }}>
                  {fmtSigned(c.score, 1)}
                </span>
              </div>
              {c.tag && (
                <div style={{
                  fontSize: 10, color: 'var(--text-3)', marginTop: 2, paddingLeft: 48,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }} title={c.tag}>
                  {c.tag}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StrengthRead({ scores }: { scores: ScoresLite }) {
  const top3 = scores.top3 ?? []
  const bottom3 = scores.bottom3 ?? []
  const maxAbs = Math.max(
    ...top3.map((c) => Math.abs(c.score ?? 0)),
    ...bottom3.map((c) => Math.abs(c.score ?? 0)),
    0.1,
  )
  const spread = scores.priority1?.divergence

  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="kicker" style={{ marginBottom: 5 }}>RFDM · Relative flow divergence</div>
          <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, color: 'var(--text-1)' }}>
            Currency strength read
          </h2>
        </div>
        {typeof spread === 'number' && Number.isFinite(spread) && (
          <span className="font-mono" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 500, padding: '5px 12px', borderRadius: 999,
            color: 'var(--accent)', background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)', flexShrink: 0,
          }}>
            <ArrowLeftRight size={12} strokeWidth={2} />
            {spread.toFixed(1)}σ spread
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        <StrengthTile kind="strong" rows={top3} maxAbs={maxAbs} />
        <StrengthTile kind="weak" rows={bottom3} maxAbs={maxAbs} />
      </div>

      {/* All / neutral / excluded — compact carry-over from the old ranking card */}
      {(scores.allScores?.length || scores.neutralCurrencies?.length || scores.excludedCurrencies?.length) ? (
        <div style={{ borderTop: '1px solid var(--border-faint)', marginTop: 14, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(scores.allScores?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px' }}>
              <span className="kicker" style={{ fontSize: 9 }}>All</span>
              {scores.allScores!.map((c) => (
                <span key={c.cur} className="font-mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                  {c.cur}{' '}
                  <span style={{ color: (c.score ?? 0) > 0 ? 'var(--green)' : (c.score ?? 0) < 0 ? 'var(--red)' : 'var(--text-3)' }}>
                    {fmtSigned(c.score, 1)}
                  </span>
                </span>
              ))}
            </div>
          )}
          {(scores.neutralCurrencies?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span className="kicker" style={{ fontSize: 9 }}>Neutral</span>
              {scores.neutralCurrencies!.map((cur) => (
                <span key={cur} className="font-mono" style={{
                  fontSize: 10, padding: '1px 8px', borderRadius: 999,
                  background: 'var(--bg-elevated)', color: 'var(--text-3)', border: '1px solid var(--border)',
                }}>{cur}</span>
              ))}
            </div>
          )}
          {(scores.excludedCurrencies?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span className="kicker" style={{ fontSize: 9, color: 'var(--amber)' }}>Excluded</span>
              {scores.excludedCurrencies!.map((cur, i) => (
                <span key={cur} className="font-mono" title={scores.excludedReasons?.[i] ?? ''} style={{
                  fontSize: 10, padding: '1px 8px', borderRadius: 999,
                  background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber-border)',
                }}>{cur}</span>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
