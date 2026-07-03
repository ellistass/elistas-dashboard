'use client'
// app/trades/active/_components/KpiRow.tsx
// Four summary tiles above the position list: open count, floating R sum,
// against-thesis count (red), news-collision count (amber).

import { Newspaper, XCircle } from 'lucide-react'
import { MONO } from './types'

interface Props {
  openCount: number
  /** Sum of open R across positions where computable; null when none computable. */
  unrealizedR: number | null
  /** How many positions the R sum actually covers (for the sub-label). */
  unrealizedCoverage: number
  againstCount: number
  newsCount: number
}

export function KpiRow({ openCount, unrealizedR, unrealizedCoverage, againstCount, newsCount }: Props) {
  const rText = unrealizedR == null
    ? '—'
    : `${unrealizedR >= 0 ? '+' : '−'}${Math.abs(unrealizedR).toFixed(1)}R`
  const rColor = unrealizedR == null ? 'var(--text-3)' : unrealizedR >= 0 ? 'var(--green)' : 'var(--red)'

  const tiles = [
    {
      label: 'Open positions', value: String(openCount), color: 'var(--text-1)',
      sub: null as string | null, bg: 'var(--bg-card-raised)', border: 'var(--border)', Icon: null as any,
      iconColor: '',
    },
    {
      label: 'Unrealized', value: rText, color: rColor,
      sub: unrealizedR != null && unrealizedCoverage < openCount ? `${unrealizedCoverage} of ${openCount} priced` : null,
      bg: 'var(--green-dim)', border: 'var(--green-border)', Icon: null, iconColor: '',
    },
    {
      label: 'Against thesis', value: String(againstCount), color: againstCount > 0 ? 'var(--red)' : 'var(--text-3)',
      sub: null, bg: 'var(--red-dim)', border: 'var(--red-border)', Icon: XCircle, iconColor: 'var(--red)',
    },
    {
      label: 'News collisions', value: String(newsCount), color: newsCount > 0 ? 'var(--amber)' : 'var(--text-3)',
      sub: null, bg: 'var(--amber-dim)', border: 'var(--amber-border)', Icon: Newspaper, iconColor: 'var(--amber)',
    },
  ]

  return (
    <div className="apos-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
      {tiles.map((tile) => (
        <div key={tile.label} style={{
          position: 'relative', background: tile.bg, border: `1px solid ${tile.border}`,
          borderRadius: 12, padding: '12px 14px', minWidth: 0,
        }}>
          {tile.Icon && (
            <tile.Icon size={14} strokeWidth={2} color={tile.iconColor}
              style={{ position: 'absolute', top: 12, right: 12, opacity: 0.85 }} />
          )}
          <div className="kicker">{tile.label}</div>
          <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 500, color: tile.color, marginTop: 4, lineHeight: 1.15 }}>
            {tile.value}
          </div>
          {tile.sub && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>{tile.sub}</div>}
        </div>
      ))}
    </div>
  )
}
