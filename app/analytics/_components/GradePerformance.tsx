'use client'
// app/analytics/_components/GradePerformance.tsx — A+/B/C breakdown with win-rate bars.

import { Award } from 'lucide-react'
import type { AnalyticsResponse } from './types'
import { GRADE_META, GradePill, Kicker, MONO, SectionCard, signed } from './ui'

const GRADES = ['A+', 'B', 'C'] as const

export function GradePerformance({ data }: { data: AnalyticsResponse }) {
  return (
    <SectionCard>
      <Kicker icon={<Award size={14} strokeWidth={2} />}>Grade performance</Kicker>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginTop: 14 }}>
        {GRADES.map(g => {
          const v = data.byGrade[g] ?? { count: 0, wins: 0, totalR: 0 }
          const winRate = v.count ? Math.round((v.wins / v.count) * 100) : 0
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
              <div style={{ height: 7, borderRadius: 4, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                <div style={{ width: `${winRate}%`, height: '100%', background: meta.c, borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                {v.count ? `${winRate}% win rate` : 'no win rate'}
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}
