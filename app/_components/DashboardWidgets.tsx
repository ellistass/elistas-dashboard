'use client'
// app/_components/DashboardWidgets.tsx
// Drop-in widgets for the live dashboard. Each one renders an empty/skeleton
// state if data is missing — never throws, never crashes the page.

import React from 'react'

// ─── Time formatting helpers ──────────────────────────────────────────────────

function fmtAge(mins: number | null): string {
  if (mins == null) return 'never'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${mins % 60}m ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtCountdown(ms: number): string {
  if (ms < 0) return 'now'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// ─── Freshness strip ──────────────────────────────────────────────────────────

interface FreshnessTile {
  source: string
  label: string
  fetchedAt: string | null
  ageMinutes: number | null
  status: 'fresh' | 'stale' | 'missing'
}

export function FreshnessStrip({ tiles }: { tiles?: FreshnessTile[] }) {
  if (!tiles?.length) return null
  const dotColor = (s: FreshnessTile['status']) =>
    s === 'fresh' ? 'var(--green)' : s === 'stale' ? 'var(--amber)' : 'var(--red)'
  return (
    <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <span className="section-label" style={{ margin: 0 }}>Data freshness</span>
        {tiles.map((t) => (
          <div key={t.source} style={{ display: 'flex', alignItems: 'center', gap: 6 }}
               title={t.fetchedAt ? new Date(t.fetchedAt).toLocaleString() : 'No data yet'}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor(t.status), display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{t.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtAge(t.ageMinutes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Daily R progression ──────────────────────────────────────────────────────

interface DailyRStatus {
  todayR: number
  cutoffR: number
  pctOfCutoff: number
  state: 'safe' | 'caution' | 'stop'
  closedToday: number
}

export function DailyRBar({ data }: { data?: DailyRStatus }) {
  if (!data) return null
  const fill = Math.min(1, data.pctOfCutoff) * 100
  const stopped = data.state === 'stop'
  const caution = data.state === 'caution'
  const color = stopped ? 'var(--red)' : caution ? 'var(--amber)' : 'var(--green)'
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span className="section-label" style={{ margin: 0 }}>Today's R</span>
        <span className="font-mono" style={{ fontSize: 18, fontWeight: 500, color }}>
          {data.todayR > 0 ? '+' : ''}{data.todayR.toFixed(2)}R
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--bg-card-2)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${fill}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
        <div style={{
          position: 'absolute', right: 0, top: -2, bottom: -2, width: 2,
          background: 'var(--red)', opacity: 0.6,
        }} title="-2R cutoff" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
        <span>{data.closedToday} closed today</span>
        <span>cutoff −2R</span>
      </div>
      {stopped && (
        <div style={{
          marginTop: 10, padding: '8px 12px',
          background: 'var(--red-dim)', border: '1px solid var(--red-border)',
          borderRadius: 6, fontSize: 12, color: 'var(--red)', fontWeight: 500, textAlign: 'center',
        }}>
          STOP — daily loss limit reached. No new entries today.
        </div>
      )}
    </div>
  )
}

// ─── Next high-impact event countdown ─────────────────────────────────────────

interface CalEvent {
  title: string
  country: string
  currency: string
  date: string
  impact: string
}

export function NextEventCountdown({ event }: { event?: CalEvent | null }) {
  const [now, setNow] = React.useState<number>(Date.now())
  React.useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(i)
  }, [])
  if (!event) return null
  const dt = new Date(event.date).getTime()
  const remaining = dt - now
  const urgent = remaining < 30 * 60_000

  return (
    <div className="card" style={{
      padding: '14px 16px',
      border: urgent ? '1px solid var(--amber-border)' : '1px solid var(--border)',
      background: urgent ? 'var(--amber-dim)' : 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span className="section-label" style={{ margin: 0 }}>Next high-impact</span>
        <span className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: urgent ? 'var(--amber)' : 'var(--text-1)' }}>
          in {fmtCountdown(remaining)}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>
        <span style={{ color: urgent ? 'var(--amber)' : 'var(--green)' }}>{event.currency}</span> · {event.title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
        {new Date(event.date).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

// ─── DXY + VIX strip ──────────────────────────────────────────────────────────

interface MacroTile { symbol: string; name: string; latest: number; percentChange: number }

export function MacroStrip({ macros }: { macros?: MacroTile[] }) {
  if (!macros?.length) return null
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {macros.map((m) => {
        const pos = m.percentChange >= 0
        return (
          <div key={m.symbol} className="card" style={{ padding: '10px 14px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.symbol}</span>
              <span className="font-mono" style={{ fontSize: 11, color: pos ? 'var(--green)' : 'var(--red)' }}>
                {pos ? '+' : ''}{m.percentChange.toFixed(2)}%
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-1)', marginTop: 2 }}>
              {m.latest.toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{m.name}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Trade plan / today's ideas board ─────────────────────────────────────────

interface Idea {
  pair: string
  direction: string
  grade: string
  strong: string
  weak: string
  divergence: number
  session?: string[]
  reason?: string
  confidence?: string
  pricedInRisk?: boolean
}

export function TradePlanBoard({ ideas, onTake, takenPairs }: {
  ideas?: Idea[]
  onTake?: (idea: Idea) => void
  takenPairs?: Set<string>
}) {
  if (!ideas?.length) {
    return (
      <div className="card" style={{ padding: '16px 18px' }}>
        <p className="section-label" style={{ marginTop: 0 }}>Today's trade plan</p>
        <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>
          No ideas yet — run analysis first.
        </p>
      </div>
    )
  }
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <p className="section-label" style={{ marginTop: 0 }}>Today's trade plan</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ideas.slice(0, 5).map((idea) => {
          const taken = takenPairs?.has(`${idea.pair}|${idea.direction}`)
          const gradeCls =
            idea.grade === 'A+' ? 'badge-aplus' : idea.grade === 'B' ? 'badge-b' :
            idea.grade === 'Skip' ? 'badge-skip' : 'badge-c'
          return (
            <div key={`${idea.pair}-${idea.direction}`} style={{
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 12px',
              background: 'var(--bg-card-2)', borderRadius: 8, border: '1px solid var(--border-subtle)',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="font-mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>{idea.pair}</span>
                  <span style={{ fontSize: 11, color: idea.direction === 'Long' ? 'var(--green)' : 'var(--red)' }}>
                    {idea.direction === 'Long' ? '↑ Long' : '↓ Short'}
                  </span>
                  <span className={gradeCls} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3 }}>{idea.grade}</span>
                  {idea.confidence && (
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>· {idea.confidence}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  div {idea.divergence?.toFixed(1)} · {idea.strong} vs {idea.weak}
                  {idea.session?.length ? ` · ${idea.session.join(', ')}` : ''}
                </div>
                {idea.reason && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
                    {idea.reason}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {taken ? (
                  <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>✓ Taken</span>
                ) : onTake ? (
                  <button onClick={() => onTake(idea)} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 6,
                    background: 'transparent', color: 'var(--text-2)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}>
                    Take →
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Recent alerts log ────────────────────────────────────────────────────────

interface RecentAlert {
  id: string
  date: string
  sentAt: string | null
  pair: string | null
  direction: string | null
  grade: string | null
}

export function AlertsLog({ alerts }: { alerts?: RecentAlert[] }) {
  if (!alerts?.length) return null
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <p className="section-label" style={{ marginTop: 0 }}>Recent alerts</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {alerts.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--text-2)' }}>
              {a.pair ? (
                <>
                  <span className="font-mono" style={{ color: 'var(--text-1)' }}>{a.pair}</span>
                  {a.direction === 'Long' ? ' ↑' : a.direction === 'Short' ? ' ↓' : ''}
                  {a.grade ? ` · ${a.grade}` : ''}
                </>
              ) : '—'}
            </span>
            <span style={{ color: 'var(--text-3)' }}>
              {a.sentAt ? new Date(a.sentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Multi-timeframe bias chips ───────────────────────────────────────────────
// Three chips per pair: Today (intraday from % change), Week (from 5d or std dev),
// Macro (from rate differential between base/quote).

export interface MtfBias {
  today: 'long' | 'short' | 'range'
  week:  'long' | 'short' | 'range'
  macro: 'long' | 'short' | 'range'
}

export function MtfBiasChips({ bias }: { bias?: MtfBias }) {
  if (!bias) return null
  const chip = (label: string, b: 'long' | 'short' | 'range') => {
    const color = b === 'long' ? 'var(--green)' : b === 'short' ? 'var(--red)' : 'var(--text-3)'
    const bg    = b === 'long' ? 'var(--green-dim)' : b === 'short' ? 'var(--red-dim)' : 'var(--bg-card-2)'
    return (
      <span style={{
        fontSize: 9, padding: '2px 6px', borderRadius: 3,
        background: bg, color: color, fontWeight: 500,
        letterSpacing: '0.05em', textTransform: 'uppercase',
      }} title={`${label}: ${b}`}>
        {label}·{b === 'long' ? '↑' : b === 'short' ? '↓' : '↔'}
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {chip('D', bias.today)}
      {chip('W', bias.week)}
      {chip('M', bias.macro)}
    </div>
  )
}

// ─── News-collision badge on open trade cards ─────────────────────────────────

export function NewsCollisionBadge({ events }: { events?: CalEvent[] }) {
  if (!events?.length) return null
  const next = events[0]
  const mins = Math.max(0, Math.floor((new Date(next.date).getTime() - Date.now()) / 60_000))
  const urgent = mins < 30
  return (
    <div style={{
      marginTop: 8, padding: '6px 10px',
      background: urgent ? 'var(--red-dim)' : 'var(--amber-dim)',
      border: `1px solid ${urgent ? 'var(--red-border)' : 'var(--amber-border)'}`,
      borderRadius: 6, fontSize: 11, color: urgent ? 'var(--red)' : 'var(--amber)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span>⚠</span>
      <span style={{ fontWeight: 500 }}>{next.currency} {next.title}</span>
      <span style={{ marginLeft: 'auto', opacity: 0.85 }}>in {fmtCountdown(mins * 60_000)}</span>
      {events.length > 1 && <span style={{ fontSize: 10, opacity: 0.75 }}>+{events.length - 1} more</span>}
    </div>
  )
}
