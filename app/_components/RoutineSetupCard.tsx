'use client'
// app/_components/RoutineSetupCard.tsx
// Collapsible card with everything needed to wire a claude.ai Project Routine
// to the Elistas dashboard via the MCP connector:
//   • the MCP connector URL (reveal + copy — treat like a password)
//   • the pre-filled routine prompt (one-click copy)
//   • the 6× daily schedule string
//   • the "Desktop must be on" disclosure
//
// Pre-requisite: register the URL once in claude.ai → Settings → Connectors,
// then toggle it on inside the trading Project.

import { useEffect, useState } from 'react'

interface RoutineConfig {
  mcpUrl: string | null
  mcpConfigured: boolean
  routinePrompt: string
  triggerPrompt: string
  schedules: { wat: string[]; utcCron: string[]; humanReadable: string }
  setup: { step1: string; step2: string; step3: string }
}

export function RoutineSetupCard() {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState<RoutineConfig | null>(null)
  const [revealUrl, setRevealUrl] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState<'routine' | 'trigger' | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
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
  async function copyUrl() {
    if (!cfg?.mcpUrl) return
    try {
      await navigator.clipboard.writeText(cfg.mcpUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 1500)
    } catch {}
  }

  function maskedUrl(url: string): string {
    // mask the secret segment: /api/mcp/<long-secret>/mcp → /api/mcp/••••/mcp
    return url.replace(/\/api\/mcp\/[^/]+\//, '/api/mcp/••••••••/')
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
              {/* Step 1 — register the MCP connector on claude.ai */}
              <div style={{
                marginBottom: 12, padding: '10px 12px',
                background: 'var(--blue-dim)', border: '1px solid var(--blue-border)',
                borderRadius: 6, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5,
              }}>
                <p style={{ margin: '0 0 4px', color: 'var(--blue)', fontWeight: 500 }}>1️⃣ Register the connector on claude.ai</p>
                Open <span className="font-mono">claude.ai</span> → <strong>Settings → Connectors → Add custom connector</strong>. Paste the URL below.
                Then open your <strong>trading project</strong> (with <span className="font-mono">strategy.md</span> + <span className="font-mono">prompt.md</span> in Project Knowledge) and toggle <strong>Elistas RFDM</strong> on.
                Once enabled, every chat and routine inside the project can call <span className="font-mono">get_scoring_data</span> and <span className="font-mono">save_scoring_result</span> directly — no URLs or tokens in the prompt.
              </div>

              {/* MCP URL reveal */}
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>MCP connector URL · treat like a password</p>
                {!cfg.mcpConfigured || !cfg.mcpUrl ? (
                  <div style={{ padding: '6px 10px', background: 'var(--amber-dim)', border: '1px solid var(--amber-border)', borderRadius: 6, color: 'var(--amber)', fontSize: 11 }}>
                    MCP_PUBLIC_SECRET is not set in Vercel. Add it (openssl rand -hex 32) and redeploy.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={revealUrl ? cfg.mcpUrl : maskedUrl(cfg.mcpUrl)}
                           readOnly
                           style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 11 }} />
                    <button onClick={() => setRevealUrl((v) => !v)} style={btn('ghost')}>
                      {revealUrl ? 'Hide' : 'Reveal'}
                    </button>
                    <button onClick={copyUrl} style={btn(copiedUrl ? 'success' : 'ghost')}>
                      {copiedUrl ? '✓' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>

              {/* Schedule */}
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>2️⃣ Schedule (6× daily)</p>
                <p className="font-mono" style={{ margin: 0, color: 'var(--text-1)' }}>{cfg.schedules.humanReadable}</p>
                <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '2px 0 0' }}>
                  UTC cron (if Claude Desktop asks): {cfg.schedules.utcCron.join('  ·  ')}
                </p>
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
                Tools exposed via MCP: <span className="font-mono">get_scoring_data</span> · <span className="font-mono">save_scoring_result</span>
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
