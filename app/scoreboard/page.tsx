'use client'
// app/scoreboard/page.tsx — Algorithm Scoreboard (v2 hifi redesign)
// Grades Claude's ideas vs the trader's discretionary calls on one scale.
// Data contract unchanged: GET /api/scoreboard?source&days.

import { useEffect, useMemo, useState } from 'react'
import {
  Trophy, Layers, Sparkles, User, Award, Ruler, GitCompareArrows,
  ShieldX, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

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

type Source = 'both' | 'claude' | 'user-discretionary'

const MONO = "'DM Mono', monospace"

const SOURCES: { id: Source; label: string; Icon: typeof Layers }[] = [
  { id: 'both', label: 'Both', Icon: Layers },
  { id: 'claude', label: 'Claude', Icon: Sparkles },
  { id: 'user-discretionary', label: 'You', Icon: User },
]
const DAY_CHIPS = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 365, label: '1Y' },
]

const GRADE_META: Record<string, { color: string; bg: string; border: string }> = {
  'A+': { color: 'var(--green)', bg: 'var(--green-dim)', border: 'var(--green-border)' },
  'B': { color: 'var(--amber)', bg: 'var(--amber-dim)', border: 'var(--amber-border)' },
  'C': { color: 'var(--text-label)', bg: 'var(--bg-elevated)', border: 'var(--border-strong)' },
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

export default function ScoreboardPage() {
  const [source, setSource] = useState<Source>('both')
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
  const overallWinRate = useMemo(() => {
    if (!data) return null
    const w = data.directional.Long.wins + data.directional.Short.wins
    const l = data.directional.Long.losses + data.directional.Short.losses
    return w + l > 0 ? w / (w + l) : null
  }, [data])

  if (loading || !data) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        Loading scoreboard…
      </div>
    )
  }

  const { totals, directional, grades, pipEdge, invalidationAccuracy: inv, dimensions } = data
  const totW = directional.Long.wins + directional.Short.wins
  const totL = directional.Long.losses + directional.Short.losses

  // 3-tier edge verdict — mirrors the prototype's `edgeVerdict` exactly.
  const edgeVerdict = pipEdge.edgeRatio == null
    ? 'not enough decisive calls to measure edge yet.'
    : pipEdge.edgeRatio > 1.5
      ? 'wins are markedly bigger than losses — the math favours you even at a coin-flip hit rate.'
      : pipEdge.edgeRatio > 1.0
        ? 'wins outpace losses, but the margin is tight. Protect the winners.'
        : 'losses currently outweigh wins per trade — review the worst pairs below.'

  return (
    <div>
      <style>{`
        .sb-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px; }
        .sb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        .sb-dims { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sb-inv-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
        @media (max-width: 900px) {
          .sb-kpis { grid-template-columns: repeat(2, 1fr); }
          .sb-cols, .sb-dims { grid-template-columns: 1fr; }
          .sb-inv-tiles { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>Algorithm scoreboard</h1>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 12, color: 'var(--text-3)', paddingTop: 6 }}>
              <Trophy size={13} strokeWidth={2} />calls graded
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-label)', fontWeight: 300 }}>
            {totals.evaluated} ideas evaluated · {totals.pending} pending · Claude vs your discretion on one scale.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <div className="seg">
            {SOURCES.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={source === id ? 'on' : undefined}
                onClick={() => setSource(id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Sora', sans-serif", fontSize: 12, padding: '7px 13px' }}
              >
                <Icon size={13} strokeWidth={2} />{label}
              </button>
            ))}
          </div>
          <div className="seg">
            {DAY_CHIPS.map((d) => (
              <button
                key={d.days}
                className={days === d.days ? 'on' : undefined}
                onClick={() => setDays(d.days)}
                style={{ fontSize: 12, padding: '7px 11px' }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {totals.evaluated === 0 ? (
        <div className="card" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>No evaluated ideas yet for this filter.</p>
          <p style={{ margin: '8px 0 0', fontSize: 12 }}>
            The daily cron evaluates each idea after market close — keep running analysis and logging setups.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI strip ── */}
          <div className="sb-kpis">
            <KpiTile
              label="Overall hit rate"
              value={pct(overallWinRate)}
              sub={`${totW} of ${totW + totL} decisive`}
              color="var(--text-1)" bg="var(--bg-card-raised)" border="var(--border)"
            />
            <KpiTile
              label="Long accuracy"
              value={pct(directional.Long.winRate)}
              sub={`${directional.Long.count} calls`}
              color="var(--green)" bg="rgba(35,224,160,0.05)" border="rgba(35,224,160,0.22)"
            />
            <KpiTile
              label="Short accuracy"
              value={pct(directional.Short.winRate)}
              sub={`${directional.Short.count} calls`}
              color="var(--red)" bg="rgba(255,84,112,0.05)" border="rgba(255,84,112,0.22)"
            />
            <KpiTile
              label="Edge ratio"
              value={pipEdge.edgeRatio != null ? `${pipEdge.edgeRatio.toFixed(2)}×` : '—'}
              sub="win size vs loss size"
              color="var(--accent)" bg="rgba(58,212,236,0.05)" border="rgba(58,212,236,0.22)"
            />
            <KpiTile
              label="Taken / Skipped"
              value={`${totals.taken} / ${totals.invalidated}`}
              sub={`${totals.watched} watched`}
              color="var(--text-1)" bg="var(--bg-card-raised)" border="var(--border)"
            />
          </div>

          {/* ── Grade + directional · Pip-move edge ── */}
          <div className="sb-cols">
            <section className="card" style={{ padding: '17px 18px' }}>
              <CardKicker icon={<Award size={14} strokeWidth={2} />} label="Hit rate by grade" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 14 }}>
                {(['A+', 'B', 'C'] as const).map((g) => {
                  const b = grades[g] ?? { count: 0, wins: 0, losses: 0, neutral: 0, winRate: null }
                  const m = GRADE_META[g]
                  const fill = Math.round((b.winRate ?? 0) * 100)
                  return (
                    <div key={g} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 78px', alignItems: 'center', gap: 12 }}>
                      <span style={{
                        display: 'inline-flex', justifyContent: 'center', padding: '3px 0', borderRadius: 6,
                        fontFamily: MONO, fontSize: 12, color: m.color, background: m.bg, border: `1px solid ${m.border}`,
                      }}>{g}</span>
                      <div style={{ height: 9, borderRadius: 5, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                        <div style={{ width: `${fill}%`, height: '100%', background: m.color, borderRadius: 5 }} />
                      </div>
                      <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{pct(b.winRate)}</span>
                        <span style={{ color: 'var(--text-3)', marginLeft: 7 }}>{b.count}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-faint)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <DirTile label="Long" color="var(--green)" icon={<ArrowUpRight size={13} strokeWidth={2} />} bucket={directional.Long} />
                <DirTile label="Short" color="var(--red)" icon={<ArrowDownRight size={13} strokeWidth={2} />} bucket={directional.Short} />
              </div>
            </section>

            <section className="card" style={{ padding: '17px 18px' }}>
              <CardKicker icon={<Ruler size={14} strokeWidth={2} />} label="Pip-move edge" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                <InnerStat
                  label="Avg pips when right"
                  value={pipEdge.avgPipsWhenRight != null ? `+${pipEdge.avgPipsWhenRight.toFixed(0)}` : '—'}
                  color="var(--green)" sub={`${pipEdge.winCount} wins`}
                />
                <InnerStat
                  label="Avg pips when wrong"
                  value={pipEdge.avgPipsWhenWrong != null ? pipEdge.avgPipsWhenWrong.toFixed(0) : '—'}
                  color="var(--red)" sub={`${pipEdge.lossCount} losses`}
                />
                <InnerStat
                  label="Avg R when right"
                  value={pipEdge.avgRWhenRight != null ? `+${pipEdge.avgRWhenRight.toFixed(2)}R` : '—'}
                  color="var(--green)"
                />
                <InnerStat
                  label="Avg R when wrong"
                  value={pipEdge.avgRWhenWrong != null ? `${pipEdge.avgRWhenWrong.toFixed(2)}R` : '—'}
                  color="var(--red)"
                />
              </div>
              <div style={{
                marginTop: 14, padding: '12px 14px', borderRadius: 10,
                background: 'rgba(58,212,236,0.06)', border: '1px solid rgba(58,212,236,0.22)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
                  <GitCompareArrows size={16} strokeWidth={2} />
                </span>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--accent)', fontFamily: MONO }}>
                    {pipEdge.edgeRatio != null ? pipEdge.edgeRatio.toFixed(2) : '—'}×
                  </span>{' '}
                  edge — {edgeVerdict}
                </p>
              </div>
            </section>
          </div>

          {/* ── Invalidation accuracy ── */}
          <section className="card" style={{ padding: '17px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <CardKicker icon={<ShieldX size={14} strokeWidth={2} />} label="Invalidation accuracy" />
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>skips that were right to skip</span>
            </div>
            {inv.total === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
                No invalidated ideas yet — once you start skipping setups this section fills in.
              </p>
            ) : (
              <>
                <div className="sb-inv-tiles">
                  <InnerStat label="Correct skips" value={String(inv.correctSkips)} color="var(--green)" sub={`${pct(inv.correctPct)} of decisive`} />
                  <InnerStat label="Missed (would win)" value={String(inv.missedSkips)} color="var(--red)" />
                  <InnerStat label="Neutral skips" value={String(inv.neutralSkips)} color="var(--text-label)" />
                  <InnerStat
                    label="R cost of misses"
                    value={`${inv.netRCostOfMissed > 0 ? '+' : ''}${inv.netRCostOfMissed.toFixed(1)}R`}
                    color={inv.netRCostOfMissed > 0 ? 'var(--amber)' : 'var(--text-3)'}
                    sub="left on table"
                  />
                </div>
                {Object.keys(inv.byReason).length > 0 && (
                  <>
                    <p style={{ margin: '0 0 8px', fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>By reason</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {Object.entries(inv.byReason)
                        .sort((a, b) => b[1].count - a[1].count)
                        .map(([reason, r]) => {
                          const correct = r.count > 0 ? r.correct / r.count : 0
                          return (
                            <div key={reason} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              fontSize: 12, padding: '9px 12px', background: 'var(--bg-inset)',
                              border: '1px solid var(--bg-elevated)', borderRadius: 8, gap: 12,
                            }}>
                              <span style={{ color: 'var(--text-body)' }}>{reason}</span>
                              <span style={{ fontFamily: MONO, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                {r.count} skipped ·{' '}
                                <span style={{ color: correct >= 0.6 ? 'var(--green)' : 'var(--red)' }}>
                                  {Math.round(correct * 100)}% correct
                                </span>
                              </span>
                            </div>
                          )
                        })}
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          {/* ── Best & worst dimensions ── */}
          <div className="sb-dims">
            <DimensionCard title="Best pairs" good rows={dimensions.byPair} />
            <DimensionCard title="Worst pairs" good={false} rows={dimensions.worstPair} />
            <DimensionCard title="Best strong-currency calls" good rows={dimensions.byStrong} />
            <DimensionCard title="Worst strong-currency calls" good={false} rows={dimensions.worstStrong} />
          </div>
        </>
      )}
    </div>
  )
}

/* ── Subcomponents ─────────────────────────────────────────────────────── */

function CardKicker({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {icon}{label}
    </span>
  )
}

function KpiTile({ label, value, sub, color, bg, border }: {
  label: string; value: string; sub: string; color: string; bg: string; border: string
}) {
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: '14px 15px', minWidth: 0 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 500, marginTop: 7, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-label)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
    </div>
  )
}

function DirTile({ label, color, icon, bucket }: { label: string; color: string; icon: React.ReactNode; bucket: Bucket }) {
  return (
    <div style={{ background: 'var(--bg-inset)', border: '1px solid var(--bg-elevated)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color }}>
        {icon}{label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: 'var(--text-1)', marginTop: 5 }}>{pct(bucket.winRate)}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{bucket.count} calls</div>
    </div>
  )
}

function InnerStat({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--bg-inset)', border: '1px solid var(--bg-elevated)', borderRadius: 10, padding: '12px 14px', minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</p>
      <p style={{ margin: '5px 0 0', fontFamily: MONO, fontSize: 20, fontWeight: 500, color }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function DimensionCard({ title, good, rows }: { title: string; good: boolean; rows: GroupBucket[] }) {
  const color = good ? 'var(--green)' : 'var(--red)'
  const Icon = good ? TrendingUp : TrendingDown
  const rowBg = (rate: number | null) => {
    const a = (0.05 + Math.abs((rate ?? 0.5) - 0.5) * 0.22).toFixed(2)
    return good ? `rgba(35,224,160,${a})` : `rgba(255,84,112,${a})`
  }
  return (
    <section className="card" style={{ padding: '17px 18px' }}>
      <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color }}>
        <Icon size={14} strokeWidth={2} />{title}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
        {rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>Not enough data yet.</p>
        ) : rows.map((g) => (
          <div key={g.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 10px', borderRadius: 7, background: rowBg(g.winRate),
          }}>
            <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-1)' }}>{g.key}</span>
            <span style={{ fontFamily: MONO, fontSize: 13 }}>
              <span style={{ color, fontWeight: 500 }}>{pct(g.winRate)}</span>
              <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>{g.wins}/{g.count}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
