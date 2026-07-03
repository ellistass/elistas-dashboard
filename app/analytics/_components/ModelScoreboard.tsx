'use client'
// app/analytics/_components/ModelScoreboard.tsx — per-model hero cards, v2 design.
// Replaces the old app/_components/StrategyScoreboard.tsx presentation on this
// screen; still driven by the STRATEGIES registry + the API's byModel block.

import { Layers, TrendingUp, Waves } from 'lucide-react'
import { STRATEGIES } from '@/app/_components/strategies'
import type { AnalyticsResponse } from './types'
import { Kicker, MONO, signed } from './ui'

type ModelStats = AnalyticsResponse['byModel'][string]

const EMPTY: ModelStats = {
  wins: 0, losses: 0, be: 0, count: 0, totalR: 0, totalPnL: 0,
  reliableR: 0, reliableCount: 0, bestPnL: 0, worstPnL: 0,
}

// Per-model visual identity (prototype hardcodes these tints per card).
const MODEL_META: Record<string, { tag: string; accent: string; chipBg: string; chipBorder: string; bg: string; border: string; Glyph: typeof TrendingUp }> = {
  A: {
    tag: 'Spring off session low', Glyph: TrendingUp,
    accent: '#23e0a0', chipBg: 'rgba(35,224,160,0.12)', chipBorder: 'rgba(35,224,160,0.35)',
    bg: 'rgba(35,224,160,0.04)', border: 'rgba(35,224,160,0.22)',
  },
  B: {
    tag: 'Fade the stop hunt', Glyph: Waves,
    accent: '#f6b73c', chipBg: 'rgba(246,183,60,0.12)', chipBorder: 'rgba(246,183,60,0.35)',
    bg: 'rgba(246,183,60,0.04)', border: 'rgba(246,183,60,0.22)',
  },
}

const FALLBACK_META = MODEL_META.A

export function ModelScoreboard({ byModel }: { byModel: AnalyticsResponse['byModel'] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Kicker icon={<Layers size={14} strokeWidth={2} />} style={{ marginBottom: 12 }}>Strategy scoreboard</Kicker>
      <div className="an-models" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        {STRATEGIES.map(def => {
          const meta = MODEL_META[def.code] ?? FALLBACK_META
          const s = byModel[def.code] ?? EMPTY
          return <ModelCard key={def.code} code={def.code} name={`Model ${def.code} · ${def.name}`} meta={meta} stats={s} />
        })}
      </div>
    </div>
  )
}

function ModelCard({ code, name, meta, stats }: {
  code: string
  name: string
  meta: (typeof MODEL_META)[string]
  stats: ModelStats
}) {
  const decisive = stats.wins + stats.losses
  const winRate = decisive ? `${Math.round((stats.wins / decisive) * 100)}%` : '—'
  const pnl = stats.totalPnL
  const pnlStr = `${pnl >= 0 ? '+$' : '-$'}${Math.abs(Math.round(pnl)).toLocaleString('en-US')}`
  const { Glyph } = meta

  return (
    <div style={{
      border: `1px solid ${meta.border}`, borderRadius: 14, background: meta.bg,
      padding: '18px 20px', position: 'relative', overflow: 'hidden',
    }}>
      {/* Faint oversized background glyph */}
      <div style={{ position: 'absolute', top: -30, right: -20, color: meta.accent, opacity: 0.14 }}>
        <Glyph size={120} strokeWidth={2} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4, position: 'relative' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: 7, fontFamily: MONO, fontSize: 13, fontWeight: 600,
          color: meta.accent, background: meta.chipBg, border: `1px solid ${meta.chipBorder}`,
        }}>
          {code}
        </span>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{name}</p>
          <p style={{ margin: '1px 0 0', fontSize: 11, color: 'var(--text-label)' }}>{meta.tag}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16, position: 'relative' }}>
        <Metric label="Win rate" value={winRate} color="var(--text-1)" />
        <Metric label="Total R" value={signed(stats.totalR, 1)} color={stats.totalR >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Metric label="Trades" value={String(stats.count)} color="var(--text-1)" />
      </div>

      <div style={{
        display: 'flex', gap: 12, marginTop: 14, paddingTop: 13,
        borderTop: '1px solid var(--border-faint)', fontFamily: MONO, fontSize: 11, position: 'relative',
      }}>
        <span style={{ color: 'var(--green)' }}>{stats.wins}W</span>
        <span style={{ color: 'var(--red)' }}>{stats.losses}L</span>
        <span style={{ color: 'var(--text-label)' }}>{stats.be}BE</span>
        <span style={{ marginLeft: 'auto', color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{pnlStr}</span>
      </div>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontFamily: MONO, fontSize: 22, fontWeight: 500, color }}>{value}</p>
    </div>
  )
}
