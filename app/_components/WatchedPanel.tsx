'use client'
// app/_components/WatchedPanel.tsx
// Right-rail "Watching" card (v2) — every idea the user clicked Watch on, with
// its peak R and live current R when the price cron has an anchor to track.
// Same data source as before (/api/ideas/watched); presentation compacted to
// one row per watch. Full anchor detail lives in each row's tooltip.

import { useEffect, useState } from 'react'
import { Eye, RotateCw, ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface WatchedRow {
  id: string
  alertDate: string
  pair: string
  direction: string
  grade: string
  source: string
  actedAt: string | null
  watchEntryPrice: number | null
  watchSlPrice: number | null
  watchStartedAt: string | null
  watchLastPrice: number | null
  watchPeakR: number | null
  watchTroughR: number | null
  watchLastSeenAt: string | null
  hasAnchor: boolean
  currentR: number | null
}

function fmtNum(n: number | null | undefined, digits = 5): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—'
}
function fmtR(n: number | null): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}R`
}

export function WatchedPanel() {
  const [rows, setRows] = useState<WatchedRow[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/ideas/watched')
      const j = await r.json()
      setRows(j.watched ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading && rows.length === 0) return null // first render — keep the rail clean
  if (rows.length === 0) return null            // nothing watched — hide the card

  return (
    <div className="card" style={{ padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Eye size={12} strokeWidth={2} />
          Watching
        </span>
        <button
          onClick={load}
          title="Refresh watched ideas"
          style={{
            width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-3)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <RotateCw size={11} strokeWidth={2} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map((r) => {
          const long = r.direction === 'Long'
          const DirIcon = long ? ArrowUpRight : ArrowDownRight
          const title = r.hasAnchor
            ? `entry ${fmtNum(r.watchEntryPrice)} · SL ${fmtNum(r.watchSlPrice)} · last ${fmtNum(r.watchLastPrice)} · trough ${fmtR(r.watchTroughR)} · ${r.grade}`
            : `no anchor armed · ${r.grade}`
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }} title={title}>
              <DirIcon size={13} strokeWidth={2} style={{ color: long ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
              <span className="font-mono" style={{ color: 'var(--text-1)', flexShrink: 0 }}>{r.pair}</span>
              <span className="font-mono" style={{
                fontSize: 10, color: 'var(--text-3)', minWidth: 0, flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {r.hasAnchor ? `peak ${fmtR(r.watchPeakR)}` : 'no anchor'}
              </span>
              <span className="font-mono" style={{
                fontSize: 12, fontWeight: 500, flexShrink: 0,
                color: r.currentR == null ? 'var(--text-3)'
                  : r.currentR > 0 ? 'var(--green)'
                  : r.currentR < 0 ? 'var(--red)'
                  : 'var(--text-2)',
              }}>
                {fmtR(r.currentR)}
              </span>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 9, color: 'var(--text-3)', margin: '10px 0 0', lineHeight: 1.4 }}>
        Current R is computed from the anchor you armed; the price cron updates it.
      </p>
    </div>
  )
}
