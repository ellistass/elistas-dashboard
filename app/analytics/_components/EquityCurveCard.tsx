'use client'
// app/analytics/_components/EquityCurveCard.tsx — cumulative-R equity curve (Recharts).

import { LineChart as LineChartIcon } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalyticsResponse } from './types'
import { EmptyState, fmtDate, Kicker, MONO, SectionCard, signed } from './ui'

export function EquityCurveCard({ data }: { data: AnalyticsResponse }) {
  const curve = data.equityCurve
  const realR = data.kpi.totalR
  const discR = data.discipline.followed.totalR

  return (
    <SectionCard style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <Kicker icon={<LineChartIcon size={14} strokeWidth={2} />}>Equity curve · cumulative R</Kicker>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: MONO, fontSize: 11 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--green)' }}>
            <span style={{ width: 14, height: 2, background: 'var(--green)', borderRadius: 2 }} />
            Real {signed(realR, 1)}R
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-label)' }}>
            <span style={{ width: 14, height: 0, borderTop: '2px dashed #565d78' }} />
            If rules followed {signed(discR, 1)}R
          </span>
        </div>
      </div>
      {curve.length > 1 ? (
        <>
          <div style={{ width: '100%', height: 210 }}>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={curve} margin={{ top: 10, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid horizontal vertical={false} stroke="#161925" />
                <XAxis dataKey="date" hide />
                <YAxis
                  width={34} axisLine={false} tickLine={false}
                  tick={{ fontSize: 10, fill: '#565d78', fontFamily: MONO }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card-2)', border: '1px solid var(--border)',
                    borderRadius: 8, fontSize: 11, fontFamily: MONO,
                  }}
                  labelStyle={{ color: 'var(--text-2)' }}
                  labelFormatter={(d: string) => fmtDate(d)}
                  formatter={(v: number) => `${signed(v, 2)}R`}
                />
                <Line type="monotone" dataKey="real" name="Real"
                      stroke="#23e0a0" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="disciplined" name="If rules followed"
                      stroke="#565d78" strokeWidth={1} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: MONO, fontSize: 10, color: 'var(--text-3)' }}>
            <span>{fmtDate(curve[0].date)}</span>
            <span>{fmtDate(curve[curve.length - 1].date)}</span>
          </div>
        </>
      ) : (
        <EmptyState text="Not enough closed trades yet." />
      )}
    </SectionCard>
  )
}
