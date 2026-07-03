'use client'
// app/_components/DiagnosticsPanel.tsx
// Slim v2 diagnostics row — Activity icon + "Diagnostics" + a green/amber
// system pulse on the right; expands into the full data-flow checklist
// (including per-source freshness) for debugging "why isn't X showing".

import { useState } from 'react'
import { Activity, ChevronDown, ChevronRight } from 'lucide-react'

interface FreshnessTile {
  source: string
  label: string
  fetchedAt: string | null
  ageMinutes: number | null
  status: 'fresh' | 'stale' | 'missing'
}

interface Props {
  sectors?: any[]
  rates?: any[]
  freshness?: FreshnessTile[]
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
function fmtAge(mins: number | null): string {
  if (mins == null) return 'never'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${mins % 60}m ago`
  return `${Math.floor(h / 24)}d ago`
}

export function DiagnosticsPanel(props: Props) {
  const [open, setOpen] = useState(false)
  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    { label: 'S&P sectors',         value: `${props.sectors?.length ?? 0} loaded`,        ok: (props.sectors?.length ?? 0) > 0 },
    { label: 'Central bank rates',  value: `${props.rates?.length ?? 0} loaded`,          ok: (props.rates?.length ?? 0) > 0 },
    { label: 'DXY/VIX macros',      value: `${props.macros?.length ?? 0} loaded`,         ok: (props.macros?.length ?? 0) > 0 },
    { label: "Today's ideas",       value: `${props.todaysIdeas?.length ?? 0} loaded`,    ok: (props.todaysIdeas?.length ?? 0) > 0 },
    { label: 'Next event',          value: props.nextEvent ? props.nextEvent.title : 'none', ok: !!props.nextEvent },
    { label: 'Barchart snapshot',   value: timeAgo(props.barchartFetchedAt),              ok: !!props.barchartFetchedAt },
    { label: 'Rates snapshot',      value: timeAgo(props.ratesFetchedAt),                 ok: !!props.ratesFetchedAt },
    { label: 'Last scored',         value: `${timeAgo(props.scoredAt)}${props.scoringModel ? ` · ${props.scoringModel}` : ''}`, ok: !!props.scoredAt },
    ...(props.freshness ?? []).map((t) => ({
      label: t.label,
      value: fmtAge(t.ageMinutes),
      ok: t.status === 'fresh',
    })),
  ]

  const issues = rows.filter((r) => !r.ok).length
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="card" style={{ padding: '11px 15px' }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', background: 'transparent', border: 'none',
        cursor: 'pointer', padding: 0,
      }}>
        <Activity size={13} strokeWidth={2} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>Diagnostics</span>
        <span className="font-mono" style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 10, color: issues > 0 ? 'var(--amber)' : 'var(--green)',
        }}>
          <span className={issues > 0 ? '' : 'pulse-dot'} style={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: issues > 0 ? 'var(--amber)' : 'var(--green)',
          }} />
          {issues > 0 ? `${issues} missing` : 'all systems ok'}
        </span>
        <Chevron size={13} strokeWidth={2} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
          {rows.map((r) => (
            <div key={r.label} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px',
              background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 7,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%',
                background: r.ok ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }} title={r.value}>{r.value}</span>
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-2)' }}>To populate missing data:</strong> sectors come from barchart-sync — run <span className="font-mono">npm run sync:now</span> in the barchart-sync folder. Today's ideas + scoredAt appear after running analysis or routine.
          </div>
        </div>
      )}
    </div>
  )
}
