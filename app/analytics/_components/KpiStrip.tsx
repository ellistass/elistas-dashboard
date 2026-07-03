'use client'
// app/analytics/_components/KpiStrip.tsx — 5-tile KPI strip.

import type { AnalyticsResponse } from './types'
import { MONO, signed } from './ui'

interface Tile {
  label: string
  value: string
  sub: string
  color: string
  bg: string
  border: string
}

export function KpiStrip({ data }: { data: AnalyticsResponse }) {
  const { kpi, discipline } = data
  const disciplinePct = Math.round(kpi.disciplinePct * 100)
  const good = disciplinePct >= 70
  const counterfactual = discipline.followed.totalR - kpi.totalR
  const best = kpi.bestSession

  const tiles: Tile[] = [
    {
      label: 'Discipline', value: `${disciplinePct}%`, sub: 'rules followed',
      color: good ? 'var(--green)' : 'var(--amber)',
      bg: good ? 'rgba(35,224,160,0.05)' : 'rgba(246,183,60,0.05)',
      border: good ? 'rgba(35,224,160,0.22)' : 'rgba(246,183,60,0.22)',
    },
    {
      label: 'Win rate', value: `${Math.round(kpi.winRate * 100)}%`,
      sub: `${Math.round(discipline.followed.winRate * 100)}% rules-followed`,
      color: 'var(--text-1)', bg: 'var(--bg-card-raised)', border: 'var(--border)',
    },
    {
      label: 'Total R', value: `${signed(kpi.totalR, 1)}R`,
      sub: counterfactual > 0.1 ? `${signed(counterfactual, 1)}R if clean` : 'realized',
      color: kpi.totalR >= 0 ? 'var(--green)' : 'var(--red)',
      bg: 'var(--bg-card-raised)', border: 'var(--border)',
    },
    {
      label: 'Avg R', value: signed(kpi.avgR, 2), sub: 'per trade',
      color: 'var(--text-1)', bg: 'var(--bg-card-raised)', border: 'var(--border)',
    },
    {
      label: 'Best session', value: best?.name ?? '—',
      sub: best ? `${Math.round(best.winRate * 100)}% · ${signed(best.totalR, 1)}R` : '',
      color: 'var(--accent)', bg: 'var(--bg-card-raised)', border: 'var(--border)',
    },
  ]

  return (
    <div className="an-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: t.bg, padding: '14px 15px' }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
            {t.label}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 500, marginTop: 7, color: t.color }}>{t.value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-label)', marginTop: 3 }}>{t.sub}</div>
        </div>
      ))}
    </div>
  )
}
