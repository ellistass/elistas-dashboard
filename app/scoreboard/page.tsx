'use client'
// app/scoreboard/page.tsx — Algorithm Scoreboard
// Rates Claude's calls AND your discretionary calls on the same scale.
// Switch between Claude / You / Both via the source tabs.

import { useEffect, useMemo, useState } from 'react'

interface Bucket { count: number; wins: number; losses: number; neutral: number; winRate: number | null }
interface GroupBucket extends Bucket { key: string }

interface ScoreboardResponse {
  range: { days: number; source: string }
  totals: { total: number; evaluated: number; pending: number; taken: number; watched: number; invalidated: number }
  directional: { Long: Bucket; Short: Bucket }
  grades: Record<string, Bucket>
  pipEdge: {
    avgPipsWhenRight: number | null
    avgPipsWhenWrong: number | null
    avgRWhenRight: number | null
    avgRWhenWrong: number | null
    edgeRatio: number | null
    winCount: number
    lossCount: number
  }
  invalidationAccuracy: {
    total: number
    correctSkips: number
    missedSkips: number
    neutralSkips: number
    correctPct: number | null
    netRCostOfMissed: number
    byReason: Record<string, { count: number; correct: number; missed: number }>
  }
  dimensions: {
    byPair: GroupBucket[]
    worstPair: GroupBucket[]
    byStrong: GroupBucket[]
    worstStrong: GroupBucket[]
    byWeak: GroupBucket[]
    bySession: GroupBucket[]
  }
}

export default function ScoreboardPage() {
  const [source, setSource] = useState<'claude' | 'user-discretionary' | 'both'>('both')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ScoreboardResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ source, days: String(days) })
    fetch(`/api/scoreboard?${params}`).then((r) => r.json()).then((d) => {
      setData(d); setLoading(false)
    })
  }, [source, days])

  // Hook MUST be called on every render — keep it above the early return.
  // useMemo runs even when data is null; we just guard inside.
  const overallWinRate = useMemo(() => {
    if (!data) return null
    const w = data.directional.Long.wins + data.directional.Short.wins
    const l = data.directional.Long.losses + data.directional.Short.losses
    return w + l > 0 ? w / (w + l) : null
  }, [data])

  if (loading || !data) {
    return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading scoreboard…</div>
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Algorithm scoreboard</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '2px 0 0' }}>
          {data.totals.evaluated} ideas evaluated · {data.totals.pending} pending · last {days} days
        </p>
      </div>

      {/* Source + time controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { v: 'both', label: 'Both' },
            { v: 'claude', label: 'Claude' },
            { v: 'user-discretionary', label: 'You' },
          ] as const).map((o) => (
            <button key={o.v} onClick={() => setSource(o.v)} style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 6,
              background: source === o.v ? 'var(--bg-elevated)' : 'transparent',
              color: source === o.v ? 'var(--text-1)' : 'var(--text-2)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}>{o.label}</button>
          ))}
        </div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ padding: '6px 10px' }}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {data.totals.evaluated === 0 ? (
        <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
          <p style={{ margin: 0, fontSize: 14 }}>No evaluated ideas yet for this filter.</p>
          <p style={{ margin: '8px 0 0', fontSize: 12 }}>The daily cron evaluates each idea after market close — keep running analysis and logging setups.</p>
        </div>
      ) : (
        <>
          {/* ── Headline KPI strip ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            <KpiTile label="Overall hit rate" value={pct(overallWinRate)} sub={`${data.directional.Long.wins + data.directional.Short.wins} wins of ${data.directional.Long.wins + data.directional.Short.wins + data.directional.Long.losses + data.directional.Short.losses}`} />
            <KpiTile label="Long accuracy" value={pct(data.directional.Long.winRate)} sub={`${data.directional.Long.count} calls`} />
            <KpiTile label="Short accuracy" value={pct(data.directional.Short.winRate)} sub={`${data.directional.Short.count} calls`} />
            <KpiTile label="Edge ratio" value={data.pipEdge.edgeRatio ? `${data.pipEdge.edgeRatio.toFixed(2)}×` : '—'} sub="right vs wrong" />
            <KpiTile label="Taken / Skipped" value={`${data.totals.taken} / ${data.totals.invalidated}`} sub={`${data.totals.watched} watched`} />
          </div>

          {/* ── Grade hit rate ── */}
          <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
            <p className="section-label" style={{ marginTop: 0 }}>Hit rate by grade</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['A+', 'B', 'C'].map((g) => {
                const b = data.grades[g] ?? { count: 0, wins: 0, losses: 0, neutral: 0, winRate: null }
                const color = g === 'A+' ? 'var(--green)' : g === 'B' ? 'var(--amber)' : 'var(--text-3)'
                return (
                  <div key={g} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px', alignItems: 'center', gap: 10 }}>
                    <span className={
                      g === 'A+' ? 'badge-aplus' : g === 'B' ? 'badge-b' : 'badge-c'
                    } style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, textAlign: 'center' }}>{g}</span>
                    <div style={{ height: 8, background: 'var(--bg-card-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(b.winRate ?? 0) * 100}%`, height: '100%', background: color }} />
                    </div>
                    <span style={{ textAlign: 'right', fontSize: 11 }}>
                      <span className="font-mono" style={{ color: 'var(--text-1)', fontWeight: 500 }}>{pct(b.winRate)}</span>
                      <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{b.count}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Pip-move edge ── */}
          <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
            <p className="section-label" style={{ marginTop: 0 }}>Pip-move edge</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Stat label="Avg pips when right" value={data.pipEdge.avgPipsWhenRight != null ? `+${data.pipEdge.avgPipsWhenRight.toFixed(0)}` : '—'} color="var(--green)" sub={`${data.pipEdge.winCount} wins`} />
              <Stat label="Avg pips when wrong" value={data.pipEdge.avgPipsWhenWrong != null ? `${data.pipEdge.avgPipsWhenWrong.toFixed(0)}` : '—'} color="var(--red)" sub={`${data.pipEdge.lossCount} losses`} />
              <Stat label="Avg R when right" value={data.pipEdge.avgRWhenRight != null ? `+${data.pipEdge.avgRWhenRight.toFixed(2)}R` : '—'} color="var(--green)" />
              <Stat label="Avg R when wrong" value={data.pipEdge.avgRWhenWrong != null ? `${data.pipEdge.avgRWhenWrong.toFixed(2)}R` : '—'} color="var(--red)" />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '10px 0 0' }}>
              Edge ratio {data.pipEdge.edgeRatio ? `${data.pipEdge.edgeRatio.toFixed(2)}×` : '—'} —
              {data.pipEdge.edgeRatio && data.pipEdge.edgeRatio > 1.5 ? ' wins are bigger than losses, the math is in your favour even with a coin-flip hit rate.'
               : data.pipEdge.edgeRatio && data.pipEdge.edgeRatio > 1.0 ? ' wins outpace losses, but tight margin.'
               : ' losses currently outweigh wins per trade — review the worst pairs/grades below.'}
            </p>
          </div>

          {/* ── Invalidation accuracy ── */}
          <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
            <p className="section-label" style={{ marginTop: 0 }}>Invalidation accuracy</p>
            {data.invalidationAccuracy.total === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No invalidated ideas yet — once you start skipping setups this section fills in.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <Stat label="Correct skips" value={`${data.invalidationAccuracy.correctSkips}`} sub={`${pct(data.invalidationAccuracy.correctPct)}`} color="var(--green)" />
                  <Stat label="Missed (would've won)" value={`${data.invalidationAccuracy.missedSkips}`} color="var(--red)" />
                  <Stat label="Neutral skips" value={`${data.invalidationAccuracy.neutralSkips}`} color="var(--text-3)" />
                  <Stat label="R cost of misses" value={`${data.invalidationAccuracy.netRCostOfMissed > 0 ? '+' : ''}${data.invalidationAccuracy.netRCostOfMissed.toFixed(1)}R`} color={data.invalidationAccuracy.netRCostOfMissed > 0 ? 'var(--amber)' : 'var(--text-3)'} />
                </div>
                {Object.keys(data.invalidationAccuracy.byReason).length > 0 && (
                  <>
                    <p style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '8px 0 6px' }}>By reason</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {Object.entries(data.invalidationAccuracy.byReason)
                        .sort((a, b) => b[1].count - a[1].count)
                        .map(([reason, r]) => {
                          const pctCorrect = r.count > 0 ? r.correct / r.count : 0
                          const isAccurate = pctCorrect >= 0.6
                          return (
                            <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                              <span style={{ color: 'var(--text-2)' }}>"{reason}"</span>
                              <span style={{ color: 'var(--text-3)' }}>
                                {r.count} skipped · <span style={{ color: isAccurate ? 'var(--green)' : 'var(--red)' }}>{Math.round(pctCorrect * 100)}% correct</span>
                              </span>
                            </div>
                          )
                        })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Best & worst dimensions ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <DimensionCard title="Best pairs"   data={data.dimensions.byPair}    color="var(--green)" />
            <DimensionCard title="Worst pairs"  data={data.dimensions.worstPair} color="var(--red)" />
            <DimensionCard title="Best strong-currency calls" data={data.dimensions.byStrong} color="var(--green)" />
            <DimensionCard title="Worst strong-currency calls" data={data.dimensions.worstStrong} color="var(--red)" />
          </div>
        </>
      )}
    </div>
  )
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dash-stat">
      <p className="lbl">{label}</p>
      <p className="val">{value}</p>
      {sub && <p className="sub">{sub}</p>}
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: 'var(--text-3)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p className="font-mono" style={{ fontSize: 18, fontWeight: 500, margin: '2px 0 0', color: color ?? 'var(--text-1)' }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '2px 0 0' }}>{sub}</p>}
    </div>
  )
}

function DimensionCard({ title, data, color }: { title: string; data: GroupBucket[]; color: string }) {
  if (!data.length) return null
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <p className="section-label" style={{ marginTop: 0 }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((g) => (
          <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span className="font-mono" style={{ color: 'var(--text-1)' }}>{g.key}</span>
            <span>
              <span className="font-mono" style={{ color, fontWeight: 500 }}>{pct(g.winRate)}</span>
              <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{g.wins}/{g.count}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}
