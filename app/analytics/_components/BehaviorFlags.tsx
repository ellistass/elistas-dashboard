'use client'
// app/analytics/_components/BehaviorFlags.tsx — 4 tinted flag tiles + broken-rule chips.

import { Flame, Gauge, MoveDiagonal, OctagonX, Siren } from 'lucide-react'
import type { ReactNode } from 'react'
import { RULE_LABELS, type AnalyticsResponse } from './types'
import { Kicker, MONO, SectionCard } from './ui'

const AMBER = { fg: 'var(--amber)', bg: 'rgba(246,183,60,0.06)', border: 'rgba(246,183,60,0.24)' }
const RED   = { fg: 'var(--red)',   bg: 'rgba(255,84,112,0.06)', border: 'rgba(255,84,112,0.24)' }

function FlagTile({ tone, icon, label, value, sub }: {
  tone: typeof AMBER; icon: ReactNode; label: string; value: string; sub: string
}) {
  return (
    <div style={{ background: tone.bg, border: `1px solid ${tone.border}`, padding: '13px 14px', borderRadius: 10 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: tone.fg, fontWeight: 500 }}>
        {icon}{label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 21, fontWeight: 500, color: 'var(--text-1)', marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-label)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

export function BehaviorFlags({ data, days }: { data: AnalyticsResponse; days: number }) {
  const b = data.behavior
  const chips = Object.entries(b.ruleViolations.byType).sort((x, y) => y[1] - x[1])

  return (
    <SectionCard style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <Kicker icon={<Siren size={14} strokeWidth={2} />}>Behavior flags</Kicker>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>last {days} days</span>
      </div>
      <div className="an-flags" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <FlagTile tone={AMBER} icon={<Gauge size={13} strokeWidth={2} />} label="Overtrading"
                  value={`${b.overtrading.daysFlagged} days`} sub={`${b.overtrading.rapidSuccessions} rapid entries`} />
        <FlagTile tone={RED} icon={<Flame size={13} strokeWidth={2} />} label="Revenge trading"
                  value={`${b.revenge.length} trades`} sub="within 60min of loss" />
        <FlagTile tone={AMBER} icon={<MoveDiagonal size={13} strokeWidth={2} />} label="Sizing drift"
                  value={`${b.sizingDrift.length} trades`} sub=">1.5σ above baseline" />
        <FlagTile tone={RED} icon={<OctagonX size={13} strokeWidth={2} />} label="Rule violations"
                  value={`${b.ruleViolations.tradeCount} trades`} sub="break ≥1 hard rule" />
      </div>
      {chips.length > 0 && (
        <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--border-faint)', display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginRight: 2 }}>
            Broken rules
          </span>
          {chips.map(([type, n]) => (
            <span key={type} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 10px',
              background: 'var(--bg-card-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)',
            }}>
              {RULE_LABELS[type] ?? type}
              <span style={{ fontFamily: MONO, color: 'var(--red)' }}>{n}</span>
            </span>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
