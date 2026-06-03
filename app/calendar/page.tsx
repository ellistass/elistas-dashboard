'use client'
// app/calendar/page.tsx — Trading P&L calendar.
// Month-grid view, each day cell shows net R + $ + trade count, color-coded
// green/red by daily performance. Click a day → drills into that day's trades.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface DayCell {
  date: string
  trades: number
  wins: number
  losses: number
  breakEven: number
  netR: number
  netDollars: number
  pairs: string[]
  bestR: number | null
  worstR: number | null
}

interface PhaseSummary {
  trades: number
  wins: number
  losses: number
  netR: number
  netDollars: number
  winRate: number | null
}

interface CalendarResponse {
  year: number
  month: number
  phase: string
  days: DayCell[]
  summary: {
    totalR: number
    totalDollars: number
    tradingDays: number
    greenDays: number
    redDays: number
    winRateOfDays: number | null
    bestDay: DayCell | null
    worstDay: DayCell | null
    tradesTotal: number
  }
  phaseBreakdown: {
    phase1: PhaseSummary
    phase2: PhaseSummary
    funded: PhaseSummary
  }
}

type Phase = 'all' | 'phase1' | 'phase2' | 'funded'

const PHASE_TABS: Array<{ v: Phase; label: string; color: string }> = [
  { v: 'all',    label: 'All',      color: 'var(--text-1)' },
  { v: 'phase1', label: 'Phase 1',  color: '#6366f1' },
  { v: 'phase2', label: 'Phase 2',  color: '#a78bfa' },
  { v: 'funded', label: 'Funded',   color: 'var(--green)' },
]

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth() + 1)
  const [phase, setPhase] = useState<Phase>('all')
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DayCell | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/calendar?year=${year}&month=${month}&phase=${phase}`).then((r) => r.json()).then((d) => {
      setData(d)
      setLoading(false)
      setSelected(null)
    })
  }, [year, month, phase])

  const cells = useMemo(() => buildMonthGrid(year, month, data?.days ?? []), [year, month, data])

  function shiftMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1)   { m = 12; y-- }
    if (m > 12)  { m = 1;  y++ }
    setMonth(m); setYear(y); setSelected(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>{MONTH_NAMES[month - 1]} {year}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '2px 0 0' }}>
            {loading ? 'Loading…' : data
              ? `${data.summary.tradesTotal} trades · ${data.summary.tradingDays} trading days · ${data.summary.greenDays} green · ${data.summary.redDays} red`
              : '—'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => shiftMonth(-1)} style={navBtn}>← Prev</button>
          <button onClick={() => { setYear(now.getUTCFullYear()); setMonth(now.getUTCMonth() + 1); setSelected(null) }} style={navBtn}>Today</button>
          <button onClick={() => shiftMonth(+1)} style={navBtn}>Next →</button>
        </div>
      </div>

      {/* Phase tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {PHASE_TABS.map((tab) => {
          const isActive = phase === tab.v
          const phaseR = tab.v === 'all'
            ? null
            : data?.phaseBreakdown[tab.v as 'phase1' | 'phase2' | 'funded']?.netR ?? null
          return (
            <button key={tab.v} onClick={() => setPhase(tab.v)} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 6,
              background: isActive ? 'var(--bg-elevated)' : 'transparent',
              color: isActive ? 'var(--text-1)' : 'var(--text-2)',
              border: `1px solid ${isActive ? tab.color : 'var(--border)'}`,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              borderLeft: isActive ? `3px solid ${tab.color}` : `1px solid var(--border)`,
            }}>
              <span>{tab.label}</span>
              {phaseR != null && (
                <span className="font-mono" style={{
                  fontSize: 10,
                  color: phaseR > 0 ? 'var(--green)' : phaseR < 0 ? 'var(--red)' : 'var(--text-3)',
                }}>
                  {phaseR > 0 ? '+' : ''}{phaseR.toFixed(1)}R
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Per-phase strip — always visible regardless of selected tab */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          {(['phase1', 'phase2', 'funded'] as const).map((p) => {
            const ps = data.phaseBreakdown[p]
            const tab = PHASE_TABS.find((t) => t.v === p)!
            const active = phase === p
            return (
              <button key={p} onClick={() => setPhase(p)} style={{
                background: 'var(--bg-card)',
                border: `1px solid ${active ? tab.color : 'var(--border)'}`,
                borderLeft: `3px solid ${tab.color}`,
                borderRadius: 8, padding: '10px 12px', minWidth: 0,
                textAlign: 'left', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: tab.color, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>{tab.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{ps.trades}t</span>
                </div>
                <div className="font-mono" style={{
                  fontSize: 16, fontWeight: 500,
                  color: ps.netR > 0 ? 'var(--green)' : ps.netR < 0 ? 'var(--red)' : 'var(--text-2)',
                }}>
                  {ps.trades === 0 ? '—' : `${ps.netR > 0 ? '+' : ''}${ps.netR.toFixed(2)}R`}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                  {ps.trades === 0 ? 'no trades' : `${ps.wins}W ${ps.losses}L · ${ps.netDollars >= 0 ? '+' : ''}${fmtMoney(ps.netDollars)}`}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {data && data.summary.tradesTotal > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 14 }}>
          <StatTile label="Net R" value={`${data.summary.totalR > 0 ? '+' : ''}${data.summary.totalR.toFixed(2)}R`} color={data.summary.totalR >= 0 ? 'var(--green)' : 'var(--red)'} />
          <StatTile label="Net P&L" value={`${data.summary.totalDollars > 0 ? '+' : ''}${fmtMoney(data.summary.totalDollars)}`} color={data.summary.totalDollars >= 0 ? 'var(--green)' : 'var(--red)'} />
          <StatTile label="Day win rate" value={data.summary.winRateOfDays != null ? `${Math.round(data.summary.winRateOfDays * 100)}%` : '—'} sub={`${data.summary.greenDays}/${data.summary.tradingDays}`} />
          <StatTile
            label="Best day"
            value={data.summary.bestDay ? `+${data.summary.bestDay.netR.toFixed(1)}R` : '—'}
            sub={data.summary.bestDay
              ? `${MONTH_NAMES[month-1].slice(0,3)} ${data.summary.bestDay.date.slice(8)} · ${data.summary.bestDay.netDollars >= 0 ? '+' : ''}${fmtMoney(data.summary.bestDay.netDollars)}`
              : ''}
            color="var(--green)"
          />
          <StatTile
            label="Worst day"
            value={data.summary.worstDay ? `${data.summary.worstDay.netR.toFixed(1)}R` : '—'}
            sub={data.summary.worstDay
              ? `${MONTH_NAMES[month-1].slice(0,3)} ${data.summary.worstDay.date.slice(8)} · ${data.summary.worstDay.netDollars >= 0 ? '+' : ''}${fmtMoney(data.summary.worstDay.netDollars)}`
              : ''}
            color="var(--red)"
          />
        </div>
      )}

      {/* Calendar grid */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
          {WEEKDAY_NAMES.map((wd) => (
            <div key={wd} style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', padding: '4px 0' }}>{wd}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} style={{ minHeight: 70 }} />
            const isPositive = cell.day && cell.day.netR > 0
            const isNegative = cell.day && cell.day.netR < 0
            const bg = !cell.day ? 'transparent'
              : isPositive ? 'rgba(0,212,138,0.10)'
              : isNegative ? 'rgba(255,77,106,0.10)'
              : 'var(--bg-card-2)'
            const border = !cell.day ? '1px solid var(--border)'
              : isPositive ? '1px solid var(--green-border)'
              : isNegative ? '1px solid var(--red-border)'
              : '1px solid var(--border)'
            const isToday = cell.dateStr === todayStr()
            const isSelected = selected?.date === cell.dateStr
            return (
              <button
                key={cell.dateStr}
                onClick={() => cell.day && setSelected(selected?.date === cell.day.date ? null : cell.day)}
                disabled={!cell.day}
                style={{
                  minHeight: 70, padding: '5px 7px', textAlign: 'left',
                  background: bg, border,
                  borderRadius: 6,
                  cursor: cell.day ? 'pointer' : 'default',
                  position: 'relative',
                  outline: isSelected ? '2px solid var(--blue)' : 'none',
                  outlineOffset: -2,
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                }}
              >
                <div style={{
                  fontSize: 10, color: isToday ? 'var(--green)' : 'var(--text-3)',
                  fontWeight: isToday ? 600 : 400,
                }}>{cell.dayNum}{isToday ? ' · today' : ''}</div>
                {cell.day && (
                  <>
                    <div className="font-mono" style={{
                      fontSize: 13, fontWeight: 500,
                      color: isPositive ? 'var(--green)' : isNegative ? 'var(--red)' : 'var(--text-2)',
                    }}>
                      {cell.day.netR > 0 ? '+' : ''}{cell.day.netR.toFixed(1)}R
                    </div>
                    <div className="font-mono" style={{
                      fontSize: 11, fontWeight: 500,
                      color: isPositive ? 'var(--green)' : isNegative ? 'var(--red)' : 'var(--text-2)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                    }}>
                      {cell.day.netDollars > 0 ? '+' : ''}{fmtMoney(cell.day.netDollars)}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                      {cell.day.trades}t · {cell.day.wins}w {cell.day.losses}l
                    </div>
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selected && (
        <div className="card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <p className="section-label" style={{ margin: 0 }}>
              {new Date(selected.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
            </p>
            <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 10 }}>
            <Stat label="Net R" value={`${selected.netR > 0 ? '+' : ''}${selected.netR.toFixed(2)}R`} color={selected.netR >= 0 ? 'var(--green)' : 'var(--red)'} />
            <Stat label="Net $" value={`${selected.netDollars > 0 ? '+' : ''}${fmtMoney(selected.netDollars)}`} color={selected.netDollars >= 0 ? 'var(--green)' : 'var(--red)'} />
            <Stat label="Trades" value={String(selected.trades)} sub={`${selected.wins}W / ${selected.losses}L / ${selected.breakEven}BE`} />
            <Stat label="Best / Worst" value={selected.bestR != null ? `+${selected.bestR.toFixed(1)} / ${selected.worstR?.toFixed(1)}R` : '—'} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
            Pairs: {selected.pairs.join(', ')}
          </div>
          <Link href={`/journal?date=${selected.date}`} style={{
            display: 'inline-block', fontSize: 11, color: 'var(--blue)',
            padding: '5px 12px', borderRadius: 6, border: '1px solid var(--blue-border)',
            background: 'var(--blue-dim)', textDecoration: 'none',
          }}>
            Open day in Journal →
          </Link>
        </div>
      )}
    </div>
  )
}

// Build a 7-col grid of cells covering the whole month, padded with empty
// cells before day 1 (Mon-first week) and after the last day.
function buildMonthGrid(year: number, month: number, days: DayCell[]): Array<{ dateStr: string; dayNum: number; day?: DayCell } | null> {
  const map = new Map(days.map((d) => [d.date, d]))
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const lastOfMonth = new Date(Date.UTC(year, month, 0))
  // weekday 0=Sun..6=Sat; we want Monday as first column → shift
  const firstWeekday = (firstOfMonth.getUTCDay() + 6) % 7
  const totalDays = lastOfMonth.getUTCDate()

  const cells: Array<{ dateStr: string; dayNum: number; day?: DayCell } | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ dateStr, dayNum: d, day: map.get(dateStr) })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function todayStr(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="dash-stat">
      <p className="lbl">{label}</p>
      <p className="val" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="sub">{sub}</p>}
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 16, fontWeight: 500, marginTop: 2, color: color ?? 'var(--text-1)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  fontSize: 12, padding: '5px 12px', borderRadius: 6,
  background: 'var(--bg-card-2)', color: 'var(--text-2)',
  border: '1px solid var(--border)', cursor: 'pointer',
}
