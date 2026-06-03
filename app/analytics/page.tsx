'use client'
// app/analytics/page.tsx — Strategy analytics page (redesigned).
// Wired to /api/analytics — adds discipline %, behavior flags, session×hour heatmap,
// missed A+ ideas tracker, and rules-followed vs broken comparison. Account-aware.

import { useEffect, useMemo, useState } from 'react'
import {
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { StrategyScoreboard } from '@/app/_components/StrategyScoreboard'

interface Account { id: string; name: string; broker: string; isActive: boolean }
interface AnalyticsResponse {
  range: { days: number; since: string }
  accountId: string | null
  kpi: {
    tradesClosed: number
    winRate: number
    totalR: number
    avgR: number
    disciplinePct: number
    bestSession: { name: string; winRate: number; totalR: number; count: number } | null
  }
  discipline: {
    followed: { count: number; wins: number; totalR: number; winRate: number }
    broken:   { count: number; wins: number; totalR: number; winRate: number }
  }
  behavior: {
    overtrading: { daysFlagged: number; flaggedDates: string[]; rapidSuccessions: number; tradeIds: string[] }
    revenge:     Array<{ tradeId: string; minutesAfterLoss: number; sizeMultiplier: number }>
    sizingDrift: Array<{ tradeId: string; riskPercent: number; zScore: number }>
    ruleViolations: { tradeCount: number; byType: Record<string, number> }
  }
  heatmap: Array<{ session: string; watHour: number; totalR: number; tradeCount: number }>
  byGrade: Record<string, { wins: number; count: number; totalR: number }>
  byModel: Record<string, {
    wins: number; losses: number; be: number; count: number;
    totalR: number; totalPnL: number;
    reliableR: number; reliableCount: number;
    bestPnL: number; worstPnL: number;
  }>
  byPhase?: Record<string, { wins: number; losses: number; be: number; count: number; totalR: number; totalPnL: number }>
  byModelByPhase?: Record<string, { A: { wins: number; count: number; totalR: number; totalPnL: number }; B: { wins: number; count: number; totalR: number; totalPnL: number } }>
  strategyFilter?: {
    includePreStrategy: boolean
    preStrategyOnly: boolean
    tradesAfterFilter: number
    tradesBeforeFilter: number
  }
  equityCurve: Array<{ date: string; real: number; disciplined: number }>
  ideas: {
    aplusSurfaced: number
    taken: number
    missedR: number
    recent: Array<{
      id: string
      alertDate: string
      pair: string
      direction: string
      grade: string
      takenByUser: boolean
      outcome: string | null
      priceMoveR: number | null
    }>
  }
}

const RULE_LABELS: Record<string, string> = {
  'within-30min-ny-open': 'Entered within 30min of NY open',
  'after-7pm-wat': 'Entered after 19:00 WAT',
  'no-model-declared': 'No model declared',
  'sub-1to2-rr': 'Sub-1:2 R:R at entry',
  'c-grade-full-risk': 'C-grade at full risk',
  'risk-over-1pct': 'Risk above 1%',
}

type StrategyView = 'strategy' | 'all' | 'pre-strategy'

export default function AnalyticsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<string | 'all'>('all')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // Strategy view defaults to 'strategy' — pre-strategy trades excluded.
  // User can switch to 'all' for full account history, or 'pre-strategy'
  // for an audit of the noise they imported but don't normally count.
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

  const heatmapGrid = useMemo(() => buildHeatmapGrid(data?.heatmap ?? []), [data])

  if (loading || !data) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading analytics…</div>

  return (
    <div>
      {/* Header + account tabs */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-1)', margin: 0 }}>Strategy analytics</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '2px 0 0' }}>
              RFDM performance — last {days} days · {data.kpi.tradesClosed} closed trades
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={strategyView}
              onChange={e => setStrategyView(e.target.value as StrategyView)}
              style={{ padding: '6px 10px' }}
              title="Filter which trades count toward stats"
            >
              <option value="strategy">Strategy trades only</option>
              <option value="all">All-time (incl. pre-strategy)</option>
              <option value="pre-strategy">Pre-strategy only</option>
            </select>
            <select value={days} onChange={e => setDays(parseInt(e.target.value))} style={{ padding: '6px 10px' }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>
        </div>

        {/* Account tab strip */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <TabBtn active={accountId === 'all'} onClick={() => setAccountId('all')}>All accounts</TabBtn>
          {accounts.filter(a => a.isActive).map(a => (
            <TabBtn key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>
              {a.name}
            </TabBtn>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Discipline" value={`${Math.round(data.kpi.disciplinePct * 100)}%`}
                 sub="rules followed" color={data.kpi.disciplinePct >= 0.7 ? 'var(--green)' : 'var(--amber)'} />
        <KpiTile label="Win rate" value={`${Math.round(data.kpi.winRate * 100)}%`}
                 sub={`${Math.round(data.discipline.followed.winRate * 100)}% rules-followed`} />
        <KpiTile label="Total R" value={`${data.kpi.totalR > 0 ? '+' : ''}${data.kpi.totalR.toFixed(2)}R`}
                 sub={counterfactualLabel(data)} color={data.kpi.totalR >= 0 ? 'var(--green)' : 'var(--red)'} />
        <KpiTile label="Avg R" value={`${data.kpi.avgR > 0 ? '+' : ''}${data.kpi.avgR.toFixed(2)}`} sub="per trade" />
        <KpiTile label="Best session" value={data.kpi.bestSession?.name ?? '—'}
                 sub={data.kpi.bestSession ? `${Math.round(data.kpi.bestSession.winRate * 100)}% · ${data.kpi.bestSession.totalR.toFixed(1)}R` : ''} />
      </div>

      {/* Behavior flags */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between' }}>
          <span>Behavior flags</span>
          <span style={{ color: 'var(--text-3)' }}>last {days} days</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <FlagTile color="amber" label="Overtrading" value={`${data.behavior.overtrading.daysFlagged} days`}
                    sub={`${data.behavior.overtrading.rapidSuccessions} rapid entries`} />
          <FlagTile color="red" label="Revenge trading" value={`${data.behavior.revenge.length} trades`}
                    sub="within 60min of loss" />
          <FlagTile color="amber" label="Sizing drift" value={`${data.behavior.sizingDrift.length} trades`}
                    sub=">1.5σ above baseline" />
          <FlagTile color="red" label="Rule violations" value={`${data.behavior.ruleViolations.tradeCount} trades`}
                    sub="break ≥1 hard rule" />
        </div>
        {Object.keys(data.behavior.ruleViolations.byType).length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(data.behavior.ruleViolations.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, n]) => (
                <span key={type} style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 4, color: 'var(--text-2)' }}>
                  {RULE_LABELS[type] ?? type} · {n}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Equity curve */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between' }}>
          <span>Equity curve · R</span>
          <span style={{ color: 'var(--text-3)' }}>
            {data.kpi.totalR.toFixed(2)}R real · {data.discipline.followed.totalR.toFixed(2)}R if rules followed
          </span>
        </div>
        {data.equityCurve.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.equityCurve}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-card-2)', border: '1px solid var(--border)', fontSize: 12 }} />
              <Line type="monotone" dataKey="real" stroke="var(--green)" strokeWidth={2} dot={false} name="Real" />
              <Line type="monotone" dataKey="disciplined" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="4 4" dot={false} name="If rules followed" />
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState text="Not enough closed trades yet." />}
      </div>

      {/* Heatmap + grade breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 10, marginBottom: 16 }}>
        <div className="card">
          <div className="section-label" style={{ marginTop: 0 }}>Session × hour heatmap (WAT)</div>
          {heatmapGrid.cells.some(c => c.tradeCount > 0) ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: `70px repeat(${heatmapGrid.hours.length}, 1fr)`, gap: 3, fontSize: 10, color: 'var(--text-3)' }}>
                <div />
                {heatmapGrid.hours.map(h => <div key={h} style={{ textAlign: 'center' }}>{h}</div>)}
                {heatmapGrid.sessions.map(session => (
                  <RowHeatmap key={session} session={session} hours={heatmapGrid.hours} cells={heatmapGrid.cells} max={heatmapGrid.max} />
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
                Darker green = more R earned. Red = net loss.
              </p>
            </>
          ) : <EmptyState text="Trade more to see your time-of-day patterns." />}
        </div>

        <div className="card">
          <div className="section-label" style={{ marginTop: 0 }}>Grade performance</div>
          {(['A+', 'B', 'C'] as const).map(g => {
            const v = data.byGrade[g] ?? { count: 0, wins: 0, totalR: 0 }
            const winRate = v.count ? v.wins / v.count : 0
            return (
              <div key={g} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span><strong style={{ color: 'var(--text-1)' }}>{g}</strong> <span style={{ color: 'var(--text-3)' }}>· {v.count} trades</span></span>
                  <span style={{ color: v.totalR >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
                    {v.totalR > 0 ? '+' : ''}{v.totalR.toFixed(1)}R
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${winRate * 100}%`, height: '100%', background: g === 'A+' ? 'var(--green)' : g === 'B' ? 'var(--amber)' : 'var(--text-3)' }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                  {v.count ? `${Math.round(winRate * 100)}% win rate` : 'No trades'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recommended pairs — outcome vs your entry */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between' }}>
          <span>Recommended pairs — outcome vs your entry</span>
          <span style={{ color: 'var(--text-3)' }}>last {days} days</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <MiniStat label="A+ ideas surfaced" value={String(data.ideas.aplusSurfaced)} />
          <MiniStat label="You took" value={`${data.ideas.taken} ${pct(data.ideas.taken, data.ideas.aplusSurfaced)}`} />
          <MiniStat label="Missed would-be R" value={`${data.ideas.missedR > 0 ? '+' : ''}${data.ideas.missedR.toFixed(1)}R left on table`}
                    color={data.ideas.missedR > 0 ? 'var(--amber)' : 'var(--text-2)'} />
        </div>
        {data.ideas.recent.length > 0 ? (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
                <th style={{ padding: '6px 0', fontWeight: 500 }}>Date</th>
                <th style={{ fontWeight: 500 }}>Pair</th>
                <th style={{ fontWeight: 500 }}>Grade</th>
                <th style={{ fontWeight: 500 }}>Taken</th>
                <th style={{ fontWeight: 500, textAlign: 'right' }}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {data.ideas.recent.map(i => (
                <tr key={i.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 0', color: 'var(--text-2)' }}>{new Date(i.alertDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                  <td style={{ color: 'var(--text-1)' }}>{i.pair} {i.direction === 'Long' ? '↑' : '↓'}</td>
                  <td><GradeBadge grade={i.grade} /></td>
                  <td>{i.takenByUser ? '✓' : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                  <td style={{ textAlign: 'right', color: outcomeColor(i.outcome, i.priceMoveR), fontWeight: 500 }}>
                    {i.priceMoveR != null ? `${i.priceMoveR > 0 ? '+' : ''}${i.priceMoveR.toFixed(1)}R` : i.outcome ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState text="The daily idea-outcome cron will populate this once it has a full day of price action." />}
      </div>

      {/* Strategy scoreboard — extensible via app/_components/strategies.ts */}
      <div className="section-label">Strategy scoreboard</div>
      <div style={{ marginBottom: 10 }}>
        <StrategyScoreboard byModel={data.byModel} />
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="section-label" style={{ marginTop: 0 }}>Rules followed vs broken</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <SplitTile label="Followed" rate={data.discipline.followed} color="var(--green)" />
          <SplitTile label="Broken" rate={data.discipline.broken} color="var(--red)" />
        </div>
      </div>

      {/* By phase + Model × Phase cross-tab — only when present */}
      {data.byPhase && data.byModelByPhase && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="card">
            <div className="section-label" style={{ marginTop: 0 }}>By account phase</div>
            <PhaseTable byPhase={data.byPhase} />
          </div>
          <div className="card">
            <div className="section-label" style={{ marginTop: 0 }}>Model × Phase</div>
            <ModelPhaseMatrix byModelByPhase={data.byModelByPhase} />
          </div>
        </div>
      )}
    </div>
  )
}

function PhaseTable({ byPhase }: { byPhase: NonNullable<AnalyticsResponse['byPhase']> }) {
  const order = ['Phase1', 'Phase2', 'Funded', 'Unphased']
  const dollar = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <Th>Phase</Th><Th right>Trades</Th><Th right>Win %</Th><Th right>Avg $</Th><Th right>Total $</Th>
        </tr>
      </thead>
      <tbody>
        {order.map((p) => {
          const b = byPhase[p]
          if (!b || b.count === 0) return null
          const winRate = b.wins + b.losses > 0 ? (b.wins / (b.wins + b.losses)) * 100 : 0
          const avg = b.count > 0 ? b.totalPnL / b.count : 0
          const color = b.totalPnL > 0 ? 'var(--green)' : b.totalPnL < 0 ? 'var(--red)' : 'var(--text-2)'
          return (
            <tr key={p} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <Td>{p}</Td>
              <Td right mono>{b.count}</Td>
              <Td right mono>{winRate.toFixed(1)}%</Td>
              <Td right mono color="var(--text-3)">{dollar(avg)}</Td>
              <Td right mono color={color}>{dollar(b.totalPnL)}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ModelPhaseMatrix({ byModelByPhase }: { byModelByPhase: NonNullable<AnalyticsResponse['byModelByPhase']> }) {
  const order = ['Phase1', 'Phase2', 'Funded'] as const
  const dollar = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <Th>Phase</Th>
          <Th right>A — n · win %</Th>
          <Th right>A — $</Th>
          <Th right>B — n · win %</Th>
          <Th right>B — $</Th>
        </tr>
      </thead>
      <tbody>
        {order.map((p) => {
          const row = byModelByPhase[p]
          if (!row) return null
          const cell = (c: { wins: number; count: number; totalR: number; totalPnL: number }) => {
            const wr = c.count > 0 ? (c.wins / c.count) * 100 : 0
            const pnlColor = c.totalPnL > 0 ? 'var(--green)' : c.totalPnL < 0 ? 'var(--red)' : 'var(--text-3)'
            return { wr, pnlColor }
          }
          const a = cell(row.A); const b = cell(row.B)
          return (
            <tr key={p} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <Td>{p}</Td>
              <Td right mono>{row.A.count} · {a.wr.toFixed(0)}%</Td>
              <Td right mono color={a.pnlColor}>{dollar(row.A.totalPnL)}</Td>
              <Td right mono>{row.B.count} · {b.wr.toFixed(0)}%</Td>
              <Td right mono color={b.pnlColor}>{dollar(row.B.totalPnL)}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Th({ children, right }: { children: any; right?: boolean }) {
  return <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-3)', textAlign: right ? 'right' : 'left' }}>{children}</th>
}
function Td({ children, right, mono, color }: { children: any; right?: boolean; mono?: boolean; color?: string }) {
  return <td style={{ padding: '8px 10px', textAlign: right ? 'right' : 'left', fontFamily: mono ? 'var(--font-mono, monospace)' : undefined, color: color ?? 'var(--text-2)' }}>{children}</td>
}

// ─── Subcomponents ──────────────────────────────────────────────────────────────

function TabBtn(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button onClick={props.onClick} style={{
      fontSize: 12,
      padding: '5px 12px',
      background: props.active ? 'var(--bg-elevated)' : 'transparent',
      color: props.active ? 'var(--text-1)' : 'var(--text-2)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      cursor: 'pointer',
    }}>{props.children}</button>
  )
}

function KpiTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, marginTop: 4, color: color ?? 'var(--text-1)', fontFamily: 'DM Mono, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function FlagTile({ color, label, value, sub }: { color: 'amber' | 'red'; label: string; value: string; sub: string }) {
  const fg = color === 'amber' ? 'var(--amber)' : 'var(--red)'
  const bg = color === 'amber' ? 'var(--amber-dim)' : 'var(--red-dim)'
  const border = color === 'amber' ? 'var(--amber-border)' : 'var(--red-border)'
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: fg, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-1)', marginTop: 4, fontFamily: 'DM Mono, monospace' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500, marginTop: 2, color: color ?? 'var(--text-1)', fontFamily: 'DM Mono, monospace' }}>{value}</div>
    </div>
  )
}

function SplitTile({ label, rate, color }: { label: string; rate: { count: number; winRate?: number; wins?: number; totalR: number }; color: string }) {
  const wr = rate.winRate ?? (rate.count && rate.wins ? rate.wins / rate.count : 0)
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, margin: '2px 0', color, fontFamily: 'DM Mono, monospace' }}>{Math.round(wr * 100)}%</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{rate.count} trades · {rate.totalR > 0 ? '+' : ''}{rate.totalR.toFixed(1)}R</div>
    </div>
  )
}

function GradeBadge({ grade }: { grade: string }) {
  const cls = grade === 'A+' ? 'badge-aplus' : grade === 'B' ? 'badge-b' : 'badge-c'
  return <span className={cls} style={{ padding: '2px 6px', borderRadius: 3, fontSize: 11 }}>{grade}</span>
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>{text}</div>
}

function RowHeatmap({ session, hours, cells, max }: { session: string; hours: number[]; cells: Array<{ session: string; watHour: number; totalR: number; tradeCount: number }>; max: number }) {
  return (
    <>
      <div style={{ alignSelf: 'center', color: 'var(--text-2)', fontSize: 11 }}>{session}</div>
      {hours.map(h => {
        const c = cells.find(x => x.session === session && x.watHour === h)
        const totalR = c?.totalR ?? 0
        const ratio = max > 0 ? Math.abs(totalR) / max : 0
        const bg = !c?.tradeCount
          ? 'var(--bg-elevated)'
          : totalR > 0
            ? `rgba(0, 212, 138, ${0.15 + ratio * 0.7})`
            : `rgba(255, 77, 106, ${0.15 + ratio * 0.7})`
        return <div key={h} style={{ background: bg, height: 18, borderRadius: 3 }} title={c ? `${session} ${h}:00 — ${totalR.toFixed(1)}R over ${c.tradeCount} trades` : ''} />
      })}
    </>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function pct(num: number, denom: number): string {
  if (!denom) return ''
  return `(${Math.round((num / denom) * 100)}%)`
}

function counterfactualLabel(d: AnalyticsResponse): string {
  const diff = d.discipline.followed.totalR - d.kpi.totalR
  if (Math.abs(diff) < 0.1) return ''
  return diff > 0 ? `+${diff.toFixed(1)}R if no rule breaks` : ''
}

function outcomeColor(outcome: string | null, r: number | null): string {
  if (r != null) return r > 0 ? 'var(--green)' : r < 0 ? 'var(--red)' : 'var(--text-2)'
  if (outcome === 'Win') return 'var(--green)'
  if (outcome === 'Loss') return 'var(--red)'
  return 'var(--text-2)'
}

function buildHeatmapGrid(cells: Array<{ session: string; watHour: number; totalR: number; tradeCount: number }>) {
  const sessions = ['London', 'New York', 'Tokyo']
  // Cover working hours, sparse columns
  const hours = [8, 10, 12, 14, 16, 18, 20, 22]
  const max = cells.reduce((m, c) => Math.max(m, Math.abs(c.totalR)), 0)
  return { sessions, hours, cells, max }
}
