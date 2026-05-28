'use client'
// app/_components/DiagnosticsPanel.tsx
// Collapsed-by-default panel listing what data the dashboard is currently
// receiving from the API. Useful for "why isn't sector / rates / etc. showing"
// — instead of guessing, look at the counts here.

import { useState } from 'react'

interface Props {
  sectors?: any[]
  rates?: any[]
  freshness?: any[]
  todaysIdeas?: any[]
  macros?: any[]
  nextEvent?: any | null
  barchartFetchedAt?: string | null
  ratesFetchedAt?: string | null
  scoredAt?: string | null
  scoringModel?: string | null
}

function timeAgo(s?: string | null): string {
  if (!s) return 'never'
  const mins = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

export function DiagnosticsPanel(props: Props) {
  const [open, setOpen] = useState(false)
  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    { label: 'S&P sectors',         value: `${props.sectors?.length ?? 0} loaded`,        ok: (props.sectors?.length ?? 0) > 0 },
    { label: 'Central bank rates',  value: `${props.rates?.length ?? 0} loaded`,          ok: (props.rates?.length ?? 0) > 0 },
    { label: 'DXY/VIX macros',      value: `${props.macros?.length ?? 0} loaded`,         ok: (props.macros?.length ?? 0) > 0 },
    { label: 'Today\'s ideas',      value: `${props.todaysIdeas?.length ?? 0} loaded`,    ok: (props.todaysIdeas?.length ?? 0) > 0 },
    { label: 'Next event',          value: props.nextEvent ? props.nextEvent.title : 'none', ok: !!props.nextEvent },
    { label: 'Barchart snapshot',   value: timeAgo(props.barchartFetchedAt),              ok: !!props.barchartFetchedAt },
    { label: 'Rates snapshot',      value: timeAgo(props.ratesFetchedAt),                 ok: !!props.ratesFetchedAt },
    { label: 'Last scored',         value: `${timeAgo(props.scoredAt)}${props.scoringModel ? ` · ${props.scoringModel}` : ''}`, ok: !!props.scoredAt },
  ]

  const issues = rows.filter((r) => !r.ok).length

  return (
    <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', background: 'transparent', border: 'none',
        cursor: 'pointer', padding: 0,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13 }}>🩺</span>
          <span style={{ fontSize: 11, color: 'var(--text-1)', fontWeight: 500 }}>Data flow diagnostics</span>
          {issues > 0 ? (
            <span style={{ fontSize: 10, color: 'var(--amber)' }}>· {issues} missing</span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--green)' }}>· all green</span>
          )}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.label} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              background: 'var(--bg-card-2)', borderRadius: 5,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%',
                background: r.ok ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }} title={r.value}>{r.value}</span>
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            <strong style={{ color: 'var(--text-2)' }}>To populate missing data:</strong> sectors come from barchart-sync — run <span className="font-mono">npm run sync:now</span> in the barchart-sync folder. Today's ideas + scoredAt appear after running analysis or routine.
          </div>
        </div>
      )}
    </div>
  )
}
