'use client'
// app/analytics/_components/SessionHeatmap.tsx — session × hour (WAT) heatmap.

import { Grid3x3 } from 'lucide-react'
import type { AnalyticsResponse } from './types'
import { EmptyState, Kicker, MONO, SectionCard, signed } from './ui'

const SESSIONS = ['London', 'New York', 'Tokyo']
const HOURS = [8, 10, 12, 14, 16, 18, 20, 22]

type Cell = AnalyticsResponse['heatmap'][number]

export function SessionHeatmap({ data }: { data: AnalyticsResponse }) {
  const cells = data.heatmap
  const max = cells.reduce((m, c) => Math.max(m, Math.abs(c.totalR)), 0)
  const hasTrades = cells.some(c => c.tradeCount > 0)

  const cellFor = (session: string, hour: number): Cell | undefined =>
    cells.find(c => c.session === session && c.watHour === hour)

  return (
    <SectionCard>
      <Kicker icon={<Grid3x3 size={14} strokeWidth={2} />}>Session × hour (WAT)</Kicker>
      {hasTrades ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '74px repeat(8, 1fr)', gap: 4, alignItems: 'center', marginTop: 12 }}>
            <div />
            {HOURS.map(h => (
              <div key={h} style={{ textAlign: 'center', fontFamily: MONO, fontSize: 10, color: 'var(--text-3)' }}>{h}</div>
            ))}
            {SESSIONS.map(session => (
              <HeatRow key={session} session={session} cellFor={cellFor} max={max} />
            ))}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--text-3)' }}>
            Green = net R earned · red = net loss · empty = untraded.
          </p>
        </>
      ) : (
        <EmptyState text="Trade more to see your time-of-day patterns." />
      )}
    </SectionCard>
  )
}

function HeatRow({ session, cellFor, max }: {
  session: string
  cellFor: (session: string, hour: number) => Cell | undefined
  max: number
}) {
  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--text-label)' }}>{session}</div>
      {HOURS.map(h => {
        const c = cellFor(session, h)
        if (!c || c.tradeCount === 0) {
          return (
            <div key={h} title={`${session} ${h}:00 — no trades`}
                 style={{ height: 26, borderRadius: 5, background: 'var(--bg-inset)' }} />
          )
        }
        const r = c.totalR
        const ratio = max > 0 ? Math.min(1, Math.abs(r) / max) : 0
        const alpha = (0.18 + ratio * 0.62).toFixed(2)
        const bg = r >= 0 ? `rgba(35,224,160,${alpha})` : `rgba(255,84,112,${alpha})`
        return (
          <div key={h} title={`${session} ${h}:00 — ${signed(r, 1)}R · ${c.tradeCount} trades`}
               style={{
                 height: 26, borderRadius: 5, background: bg,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 fontFamily: MONO, fontSize: 9, color: '#04120d',
               }}>
            {signed(r, 1)}
          </div>
        )
      })}
    </>
  )
}
