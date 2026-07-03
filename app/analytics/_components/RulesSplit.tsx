'use client'
// app/analytics/_components/RulesSplit.tsx — rules followed vs broken split tiles.

import { Scale } from 'lucide-react'
import type { AnalyticsResponse } from './types'
import { Kicker, MONO, SectionCard, signed } from './ui'

type Split = AnalyticsResponse['discipline']['followed']

export function RulesSplit({ data }: { data: AnalyticsResponse }) {
  return (
    <SectionCard>
      <Kicker icon={<Scale size={14} strokeWidth={2} />}>Rules followed vs broken</Kicker>
      <div className="an-splits" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <SplitTile label="Followed" split={data.discipline.followed}
                   color="var(--green)" bg="rgba(35,224,160,0.05)" border="rgba(35,224,160,0.22)" />
        <SplitTile label="Broken" split={data.discipline.broken}
                   color="var(--red)" bg="rgba(255,84,112,0.05)" border="rgba(255,84,112,0.22)" />
      </div>
    </SectionCard>
  )
}

function SplitTile({ label, split, color, bg, border }: {
  label: string; split: Split; color: string; bg: string; border: string
}) {
  return (
    <div style={{ textAlign: 'center', border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-label)' }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 500, margin: '4px 0', color }}>
        {Math.round(split.winRate * 100)}%
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {split.count} trades · {signed(split.totalR, 1)}R
      </div>
    </div>
  )
}
