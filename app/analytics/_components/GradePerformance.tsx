'use client'
// app/analytics/_components/GradePerformance.tsx — A+/B/C breakdown with win-rate bars.

import { Award } from 'lucide-react'
import type { AnalyticsResponse } from './types'
import { GRADE_META, GradePill, Kicker, MONO, SectionCard, signed } from './ui'
import { rate, coverage as coverageOf } from '@/lib/stats'
import { CoverageNote } from '@/app/_components/Rate'

const GRADES = ['A+', 'B', 'C'] as const

export function GradePerformance({ data }: { data: AnalyticsResponse }) {
  // 2 of 759 closed trades carry a grade. The bars below were drawn at full
  // width off a sample of one or two, which reads exactly like a finding.
  const cov = data.coverage?.grade ? coverageOf(data.coverage.grade.present, data.coverage.grade.total) : null
  return (
    <SectionCard>
      <Kicker icon={<Award size={14} strokeWidth={2} />}>Grade performance</Kicker>
      <CoverageNote note={cov?.note ?? null} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginTop: 14 }}>
        {GRADES.map(g => {
          const v = data.byGrade[g] ?? { count: 0, wins: 0, totalR: 0 }
          const r = rate(v.wins, v.count)
          const meta = GRADE_META[g]
          return (
            <div key={g}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <GradePill grade={g} />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{v.count} trades</span>
                </span>
                <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 500, color: v.totalR >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {signed(v.totalR, 1)}R
                </span>
              </div>
              {/* A bar is a claim of proportion. Below the floor there is no
                  proportion to draw, so the track stays empty rather than
                  rendering one win out of two as a half-full bar. */}
              <div style={{ height: 7, borderRadius: 4, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                {r.pct != null && (
                  <div style={{
                    width: `${r.pct}%`, height: '100%', background: meta.c, borderRadius: 4,
                    opacity: r.confidence === 'solid' ? 1 : 0.5,
                  }} />
                )}
              </div>
              <div title={r.title} style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                {r.pct != null
                  ? `${r.label} win rate · n=${r.n}${r.confidence === 'provisional' ? ' (provisional)' : ''}`
                  : v.count > 0 ? `${r.label} — too few for a rate` : 'no trades graded'}
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}
