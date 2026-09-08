'use client'
// app/_components/dashboard/DashHeader.tsx
// v2 dashboard header: H1 + session pill + DM Mono meta line on the left,
// engine segmented control + Run Analysis / Telegram / Manual toggle on the right.
// Pure presentation — all state and actions live in app/page.tsx.

import { Clock, Zap, Send, RotateCw } from 'lucide-react'

export type Engine = 'sonnet' | 'haiku' | 'rules' | 'routine'

interface Props {
  session: string | null
  clock: string
  scoredAgo: string | null       // "8m ago" or null when never scored
  dataAgeMin: number | null      // minutes; null = unknown
  hasLiveData: boolean
  scoringModel?: string | null
  engine: Engine
  onEngine: (e: Engine) => void
  scoring: boolean
  sent: boolean
  loading: boolean
  onRun: (sendAlert: boolean) => void
  onRefresh: () => void
  manualOn: boolean
  onManualToggle: () => void
}

const ENGINES: Array<{ v: Engine; label: string }> = [
  { v: 'sonnet', label: 'Sonnet' },
  { v: 'haiku', label: 'Haiku' },
  { v: 'rules', label: 'Rules' },
  { v: 'routine', label: 'Routine' },
]

function Spinner({ dark }: { dark?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 13, height: 13,
      border: `2px solid ${dark ? 'rgba(4,34,42,0.3)' : 'rgba(255,255,255,0.2)'}`,
      borderTopColor: dark ? 'var(--accent-on)' : 'var(--text-1)',
      borderRadius: '50%', animation: 'spin 0.75s linear infinite',
    }} />
  )
}

export function DashHeader({
  session, clock, scoredAgo, dataAgeMin, hasLiveData, scoringModel,
  engine, onEngine, scoring, sent, loading, onRun, onRefresh, manualOn, onManualToggle,
}: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 14, flexWrap: 'wrap', marginBottom: 18,
    }}>
      {/* Left: title + session pill + meta line */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: 'var(--text-1)' }}>
            Dashboard
          </h1>
          {session && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 500, padding: '3px 11px', borderRadius: 999,
              background: 'var(--green-dim)', color: 'var(--green)',
              border: '1px solid var(--green-border)',
            }}>
              <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              {session} open
            </span>
          )}
        </div>
        <div className="font-mono" style={{
          display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
          fontSize: 11, color: 'var(--text-3)',
        }}>
          <Clock size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span style={{ color: 'var(--text-label)' }}>{clock} WAT</span>
          <span>·</span>
          <span>{scoredAgo ? `scored ${scoredAgo}` : 'no scores yet'}</span>
          {scoringModel && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--purple)' }}>{scoringModel}</span>
            </>
          )}
          {dataAgeMin != null && (
            <>
              <span>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                data {dataAgeMin}m
              </span>
            </>
          )}
          {hasLiveData && (
            <>
              <span>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--green)' }}>
                <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                live
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right: refresh only.
          The RFDM controls that lived here — the engine picker (Sonnet /
          Haiku / rules / routine), Run Analysis, the Telegram send and the
          Manual data-entry toggle — moved off the dashboard when Wyckoff
          became the strategy. Nothing about RFDM was deleted: the scoring API,
          the prompt, the cron at 06:30/13:30 UTC and the whole /analysis
          history are untouched and still running. What is gone is the manual
          trigger, so an RFDM run now happens on schedule rather than on a
          button. The props are still accepted so restoring the block is a
          paste, not a rewrite. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={onRefresh} disabled={loading} title="Refresh dashboard data"
          style={{
            width: 36, height: 36, borderRadius: 9,
            border: '1px solid var(--border)', background: 'var(--bg-card-2)',
            color: 'var(--text-2)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
          {loading ? <Spinner /> : <RotateCw size={14} strokeWidth={2} />}
        </button>
      </div>
    </div>
  )
}
