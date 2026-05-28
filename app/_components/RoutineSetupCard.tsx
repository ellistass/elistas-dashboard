'use client'
// app/_components/RoutineSetupCard.tsx
// Collapsible card that gives the user everything they need to wire a
// Claude Desktop Routine into their Elistas dashboard:
//   • the ROUTINE_SECRET (reveal + copy)
//   • the pre-filled routine prompt (one-click copy)
//   • the 6× daily schedule string
//   • the "Desktop must be on" disclosure

import { useEffect, useState } from 'react'

interface RoutineConfig {
  promptDataUrl: string
  saveUrl: string
  secret: string
  routinePrompt: string
  triggerPrompt: string
  schedules: { wat: string[]; utcCron: string[]; humanReadable: string }
}

export function RoutineSetupCard() {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState<RoutineConfig | null>(null)
  const [revealSecret, setRevealSecret] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState<'routine' | 'trigger' | null>(null)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'routine' | 'trigger'>('routine')

  useEffect(() => {
    if (open && !cfg && !loading) {
      setLoading(true)
      fetch('/api/scoring/routine-config').then((r) => r.json()).then((d) => {
        if (!d.error) setCfg(d as RoutineConfig)
        setLoading(false)
      })
    }
  }, [open, cfg, loading])

  async function copyPrompt(which: 'routine' | 'trigger') {
    if (!cfg) return
    const text = which === 'routine' ? cfg.routinePrompt : cfg.triggerPrompt
    try {
      await navigator.clipboard.writeText(text)
      setCopiedPrompt(which)
      setTimeout(() => setCopiedPrompt(null), 1500)
    } catch {}
  }
  async function copySecret() {
    if (!cfg) return
    try {
      await navigator.clipboard.writeText(cfg.secret)
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 1500)
    } catch {}
  }

  return (
    <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', background: 'transparent', border: 'none',
        cursor: 'pointer', padding: 0,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🔁</span>
          <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>Claude Desktop Routine</span>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
            free scoring — runs on your subscription
          </span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-2)' }}>
          {loading && <div style={{ color: 'var(--text-3)' }}>Loading config…</div>}
          {!loading && cfg && (
            <>
              {/* Project requirement — must be set up first */}
              <div style={{
                marginBottom: 12, padding: '10px 12px',
                background: 'var(--blue-dim)', border: '1px solid var(--blue-border)',
                borderRadius: 6, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5,
              }}>
                <p style={{ margin: '0 0 4px', color: 'var(--blue)', fontWeight: 500 }}>1️⃣ Run inside your trading project on claude.ai</p>
                Open <span className="font-mono">claude.ai</span> → your <strong>trading project</strong> (the regular chat one, NOT Cowork) — the one with <span className="font-mono">strategy.md</span> and <span className="font-mono">prompt.md</span> in Project Knowledge.
                Create the routine inside that project so it inherits your RFDM context automatically. The routine prompt below stays short because the rules already live in your project knowledge.
              </div>

              {/* Schedule */}
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>2️⃣ Schedule (6× daily)</p>
                <p className="font-mono" style={{ margin: 0, color: 'var(--text-1)' }}>{cfg.schedules.humanReadable}</p>
                <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '2px 0 0' }}>
                  UTC cron (if Claude Desktop asks): {cfg.schedules.utcCron.join('  ·  ')}
                </p>
              </div>

              {/* Secret reveal */}
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Routine secret</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={revealSecret ? cfg.secret : '•'.repeat(Math.min(24, cfg.secret.length))}
                         readOnly
                         style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 11 }} />
                  <button onClick={() => setRevealSecret((v) => !v)} style={btn('ghost')}>
                    {revealSecret ? 'Hide' : 'Reveal'}
                  </button>
                  <button onClick={copySecret} style={btn(copiedSecret ? 'success' : 'ghost')}>
                    {copiedSecret ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Mode tabs — Routine (scheduled) vs Trigger (paste in chat) */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <p style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                    3️⃣ {mode === 'routine' ? 'Routine prompt (scheduled)' : 'Trigger prompt (paste in chat anytime)'}
                  </p>
                  <button onClick={() => copyPrompt(mode)} style={btn(copiedPrompt === mode ? 'success' : 'primary')}>
                    {copiedPrompt === mode ? '✓ Copied' : 'Copy prompt'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6, padding: 2, background: 'var(--bg-card-2)', borderRadius: 6, border: '1px solid var(--border)', width: 'fit-content' }}>
                  {([
                    { v: 'routine', label: 'Auto · 6× daily', hint: 'Set once, fires on schedule' },
                    { v: 'trigger', label: 'Manual · paste in chat', hint: 'Run on demand from Desktop' },
                  ] as const).map((o) => (
                    <button key={o.v} onClick={() => setMode(o.v)} title={o.hint} style={{
                      fontSize: 10, padding: '4px 10px', borderRadius: 4,
                      background: mode === o.v ? 'var(--bg-elevated)' : 'transparent',
                      color: mode === o.v ? 'var(--text-1)' : 'var(--text-3)',
                      border: 'none', cursor: 'pointer',
                    }}>{o.label}</button>
                  ))}
                </div>
                <pre style={{
                  margin: 0, padding: 10, fontSize: 11, lineHeight: 1.5,
                  background: 'var(--bg-card-2)', border: '1px solid var(--border)',
                  borderRadius: 6, maxHeight: 200, overflow: 'auto',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'DM Mono, monospace', color: 'var(--text-2)',
                }}>{mode === 'routine' ? cfg.routinePrompt : cfg.triggerPrompt}</pre>
                <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '4px 0 0' }}>
                  {mode === 'routine'
                    ? 'Open Claude Desktop → trading project → New Routine → paste prompt → set 6× daily schedule above'
                    : 'Open Claude Desktop → trading project chat → paste prompt as a message → result posts to your dashboard'}
                </p>
              </div>

              {/* Disclosure */}
              <div style={{
                padding: '8px 10px', background: 'var(--amber-dim)',
                border: '1px solid var(--amber-border)', borderRadius: 6,
                fontSize: 11, color: 'var(--amber)',
              }}>
                <strong>Note:</strong> Claude Desktop Routines only fire when the app is running.
                If your laptop is asleep or the app is quit at a scheduled time, that run is skipped —
                the existing Vercel cron fall-back will use API credits to fill the gap.
              </div>

              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-3)' }}>
                Endpoint: <span className="font-mono">{cfg.promptDataUrl}</span> · save: <span className="font-mono">{cfg.saveUrl}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function btn(variant: 'primary' | 'ghost' | 'success'): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11, padding: '5px 10px', borderRadius: 5,
    cursor: 'pointer', flexShrink: 0,
  }
  if (variant === 'primary') return { ...base, background: 'var(--green)', color: '#001a14', border: 'none', fontWeight: 500 }
  if (variant === 'success') return { ...base, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green-border)' }
  return { ...base, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)' }
}
