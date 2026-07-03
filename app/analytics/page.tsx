'use client'
// app/analytics/page.tsx — Strategy analytics ("Stats"), v2 redesign.
// Layout & styling follow design-handoff/prototypes/.../Stats.dc.html.
// Data contract unchanged: GET /api/analytics?days&accountId&includePreStrategy&preStrategyOnly
// plus GET /api/accounts for the account tab strip.

import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BehaviorFlags } from './_components/BehaviorFlags'
import { EquityCurveCard } from './_components/EquityCurveCard'
import { GradePerformance } from './_components/GradePerformance'
import { KpiStrip } from './_components/KpiStrip'
import { ModelScoreboard } from './_components/ModelScoreboard'
import { RecommendedPairs } from './_components/RecommendedPairs'
import { RulesSplit } from './_components/RulesSplit'
import { SessionHeatmap } from './_components/SessionHeatmap'
import type { Account, AnalyticsResponse, StrategyView } from './_components/types'
import { MONO } from './_components/ui'

const VIEWS: Array<{ id: StrategyView; label: string; title: string }> = [
  { id: 'strategy',     label: 'Strategy', title: 'Strategy trades only' },
  { id: 'all',          label: 'All-time', title: 'Include pre-strategy trades' },
  { id: 'pre-strategy', label: 'Pre-strat', title: 'Pre-strategy only' },
]
const DAY_RANGES = [7, 30, 90, 365]

export default function AnalyticsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<string | 'all'>('all')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // Strategy view defaults to 'strategy' — pre-strategy trades excluded.
  const [strategyView, setStrategyView] = useState<StrategyView>('strategy')

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(d => setAccounts(d.accounts ?? d ?? []))
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ days: String(days) })
    if (accountId !== 'all') params.set('accountId', accountId)
    if (strategyView === 'all')          params.set('includePreStrategy', 'true')
    if (strategyView === 'pre-strategy') params.set('preStrategyOnly', 'true')
    fetch(`/api/analytics?${params}`).then(r => r.json()).then(d => { setData(d); setLoading(false) })
  }, [accountId, days, strategyView])

  return (
    <div>
      <style>{RESPONSIVE_CSS}</style>

      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-1)' }}>
              Strategy analytics
            </h1>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 12, color: 'var(--text-3)', paddingTop: 6 }}>
              <Activity size={13} strokeWidth={2} />RFDM performance
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-label)', fontWeight: 300 }}>
            Last {days} days · {data?.kpi.tradesClosed ?? '—'} closed trades · discipline shapes the curve.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <div className="seg">
            {VIEWS.map(v => (
              <button key={v.id} title={v.title}
                      className={strategyView === v.id ? 'on' : undefined}
                      onClick={() => setStrategyView(v.id)}
                      style={{ fontFamily: "'Sora', sans-serif", fontSize: 12, padding: '7px 12px' }}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="seg">
            {DAY_RANGES.map(d => (
              <button key={d}
                      className={days === d ? 'on' : undefined}
                      onClick={() => setDays(d)}
                      style={{ fontSize: 12, padding: '7px 11px' }}>
                {d === 365 ? '1Y' : `${d}D`}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Account tab strip ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
        <AccountPill active={accountId === 'all'} onClick={() => setAccountId('all')}>All accounts</AccountPill>
        {accounts.filter(a => a.isActive).map(a => (
          <AccountPill key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>
            {a.name}
          </AccountPill>
        ))}
      </div>

      {loading || !data ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          Loading analytics…
        </div>
      ) : (
        <>
          <KpiStrip data={data} />
          <BehaviorFlags data={data} days={days} />
          <EquityCurveCard data={data} />

          <div className="an-2col" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 14 }}>
            <SessionHeatmap data={data} />
            <GradePerformance data={data} />
          </div>

          <RecommendedPairs data={data} days={days} />
          <ModelScoreboard byModel={data.byModel} />
          <RulesSplit data={data} />
        </>
      )}
    </div>
  )
}

function AccountPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px',
      borderRadius: 8, cursor: 'pointer', fontFamily: "'Sora', sans-serif", fontSize: 12, fontWeight: 500,
      color: active ? 'var(--accent-on)' : 'var(--text-2)',
      background: active ? 'var(--accent)' : 'transparent',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    }}>
      {children}
    </button>
  )
}

// ── Responsive reflow (~900px): KPI → 2-col, flag/2-col grids → 1-col,
//    recommended-pairs table → stacked cards. ─────────────────────────────
const RESPONSIVE_CSS = `
.an-ideas-cards { display: none; }
@media (max-width: 900px) {
  .an-kpis   { grid-template-columns: repeat(2, 1fr) !important; }
  .an-flags  { grid-template-columns: repeat(2, 1fr) !important; }
  .an-2col   { grid-template-columns: 1fr !important; }
  .an-models { grid-template-columns: 1fr !important; }
  .an-ideas-table { display: none; }
  .an-ideas-cards { display: flex !important; }
}
@media (max-width: 560px) {
  .an-splits { grid-template-columns: 1fr !important; }
}
`
