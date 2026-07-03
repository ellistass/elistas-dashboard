'use client'
// app/_components/MultiIdeaHero.tsx
// "Today's calls" — Claude's ranked ideas as a priority-1 hero card + secondary
// idea cards with Take / Watch / Skip actions inline (v2 visual redesign; all
// action flows and POST payloads are unchanged). Take opens a per-account
// $-risk + MT4-ticket picker. Skip opens an optional-reason form. Watch can be
// one-click or armed with an entry/SL anchor.

import { useMemo, useState } from 'react'
import {
  ImagePlus, Star, Sparkles, CirclePlus, Eye, X, Check,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

interface Idea {
  pair: string
  direction: 'Long' | 'Short'
  grade: string
  strong: string
  weak: string
  divergence: number
  session?: string[]
  reason?: string
  confidence?: string
  pricedInRisk?: boolean
  source?: 'claude' | 'user-discretionary'
  userModel?: string
  strongScore?: number
  weakScore?: number
}
interface AccountLite {
  id: string
  name: string
  currency: string
  currentBalance: number
  status: string
}
interface IdeaAction {
  userAction: string
  invalidationReason: string | null
  tradeId: string | null
  outcomeId: string
}

interface Props {
  ideas: Idea[]
  ideaActions?: Record<string, IdeaAction>
  accounts: AccountLite[]
  onChanged?: () => void
  /** ISO date of the alert these ideas belong to; defaults to today */
  alertDate?: string
  source?: 'claude' | 'user-discretionary'
  /** Scoring model tag shown on the hero (e.g. "sonnet") */
  scoringModel?: string | null
  /** "View all →" destination */
  viewAllHref?: string
}

const PRESET_REASONS = [
  'no clean entry',
  'news risk',
  'low confidence',
  'already at risk limit',
  'against H4 structure',
  'volume not confirming',
]

function fmtSigned(n: unknown, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(digits)
}

function GradePill({ grade }: { grade: string }) {
  const s = grade === 'A+' ? { bg: 'var(--green-dim)', fg: 'var(--green)', bd: 'var(--green-border)' }
    : grade === 'B' ? { bg: 'var(--amber-dim)', fg: 'var(--amber)', bd: 'var(--amber-border)' }
    : grade === 'Skip' ? { bg: 'var(--red-dim)', fg: 'var(--red)', bd: 'var(--red-border)' }
    : { bg: 'var(--bg-elevated)', fg: 'var(--text-label)', bd: 'var(--border-strong)' }
  return (
    <span className="font-mono" style={{
      background: s.bg, color: s.fg, border: `1px solid ${s.bd}`,
      padding: '1px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
    }}>{grade}</span>
  )
}

function DirLabel({ direction, size = 13 }: { direction: 'Long' | 'Short'; size?: number }) {
  const long = direction === 'Long'
  const Icon = long ? ArrowUpRight : ArrowDownRight
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      color: long ? 'var(--green)' : 'var(--red)', fontSize: size, fontWeight: 500,
    }}>
      <Icon size={size + 2} strokeWidth={2} />
      {direction}
    </span>
  )
}

export function MultiIdeaHero({
  ideas, ideaActions = {}, accounts, onChanged, alertDate, source = 'claude',
  scoringModel, viewAllHref = '/analysis',
}: Props) {
  const [logOpen, setLogOpen] = useState(false)
  const hasIdeas = ideas && ideas.length > 0
  const top = hasIdeas ? ideas[0] : null
  const rest = hasIdeas ? ideas.slice(1, 5) : []
  const sessions = top?.session?.length ? top.session.join(' / ') : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span className="kicker">Today's calls</span>
          {hasIdeas && (
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {ideas.length} ranked{sessions ? ` · ${sessions}` : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {hasIdeas && (
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {countTaken(ideaActions)} taken · {countSkipped(ideaActions)} skipped
            </span>
          )}
          {!logOpen && (
            <button onClick={() => setLogOpen(true)} style={{
              fontSize: 11, color: 'var(--text-2)', background: 'transparent',
              border: '1px solid var(--border)', padding: '3px 11px',
              borderRadius: 8, cursor: 'pointer',
            }}>+ Log my setup</button>
          )}
          <a href={viewAllHref} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            View all →
          </a>
        </div>
      </div>

      {logOpen && (
        <LogMySetupForm
          onClose={() => setLogOpen(false)}
          onLogged={() => { setLogOpen(false); onChanged?.() }}
        />
      )}

      {!hasIdeas && !logOpen && (
        <div style={{
          padding: 18, background: 'var(--bg-card)', border: '1px dashed var(--border)',
          borderRadius: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-3)',
        }}>
          No calls yet. Run analysis or log your own setup above.
        </div>
      )}

      {hasIdeas && top && (
        <IdeaCard idea={top} size="hero" actions={ideaActions} accounts={accounts}
                  alertDate={alertDate} source={source} onChanged={onChanged}
                  scoringModel={scoringModel} />
      )}
      {rest.length > 0 && (
        <div className="dash-ideas-grid">
          {rest.map((idea, i) => (
            <IdeaCard key={`${idea.pair}-${idea.direction}-${i}`} idea={idea} size="small"
                      actions={ideaActions} accounts={accounts}
                      alertDate={alertDate} source={source} onChanged={onChanged} rank={i + 2} />
          ))}
        </div>
      )}
    </div>
  )
}

function IdeaCard({
  idea, size, actions = {}, accounts, alertDate, source = 'claude', onChanged, rank, scoringModel,
}: {
  idea: Idea
  size: 'hero' | 'small'
  actions?: Record<string, IdeaAction>
  accounts: AccountLite[]
  alertDate?: string
  source?: 'claude' | 'user-discretionary'
  onChanged?: () => void
  rank?: number
  scoringModel?: string | null
}) {
  const [open, setOpen] = useState<null | 'take' | 'skip' | 'watch'>(null)
  const [watchEntry, setWatchEntry] = useState('')
  const [watchSl, setWatchSl] = useState('')
  // Per-account take rows. Default to the first active account ticked with a 1%
  // dollar risk so a single-click Take still works out of the box; the user can
  // tick in additional accounts and size each one independently.
  const [rows, setRows] = useState<Record<string, { on: boolean; riskAmount: string; ticket: string }>>(
    () => Object.fromEntries(accounts.map((a, i) => [
      a.id,
      { on: i === 0, riskAmount: i === 0 ? String(defaultRisk(a.currentBalance, 1)) : '', ticket: '' },
    ])),
  )
  const [reason, setReason] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  function toggleAccount(id: string) {
    const acct = accounts.find((a) => a.id === id)
    setRows((prev) => {
      const cur = prev[id] ?? { on: false, riskAmount: '', ticket: '' }
      const turningOn = !cur.on
      return {
        ...prev,
        [id]: {
          ...cur,
          on: turningOn,
          // When ticking on with no $ yet, seed 1% of live balance.
          riskAmount: turningOn && !cur.riskAmount && acct
            ? String(defaultRisk(acct.currentBalance, 1))
            : cur.riskAmount,
        },
      }
    })
  }
  function selectAllAccounts() {
    setRows((prev) => Object.fromEntries(accounts.map((a) => {
      const cur = prev[a.id] ?? { on: false, riskAmount: '', ticket: '' }
      return [a.id, { ...cur, on: true, riskAmount: cur.riskAmount || String(defaultRisk(a.currentBalance, 1)) }]
    })))
  }
  function clearAccounts() {
    setRows((prev) => Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, { ...r, on: false }])))
  }
  function setRow(id: string, patch: Partial<{ riskAmount: string; ticket: string }>) {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { on: false, riskAmount: '', ticket: '' }), ...patch } }))
  }
  // Quick-set: recompute every TICKED account's $ from its own live balance.
  function applyPctAll(pct: number) {
    setRows((prev) => Object.fromEntries(accounts.map((a) => {
      const cur = prev[a.id] ?? { on: false, riskAmount: '', ticket: '' }
      return [a.id, cur.on ? { ...cur, riskAmount: String(defaultRisk(a.currentBalance, pct)) } : cur]
    })))
  }

  async function pickScreenshot(file: File) {
    setUploadErr(null)
    setUploading(true)
    try {
      // The /api/upload endpoint requires a tradeId, but we don't have one yet
      // (the trade row is created inside /api/ideas/take). Use a synthetic key
      // tied to the alertDate+pair so the file lands in a predictable bucket;
      // each created trade's screenshotUrl points to this same object.
      const stamp = (alertDate ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '')
      const synthId = `idea-${stamp}-${idea.pair.replace('/', '')}-${idea.direction}`
      const fd = new FormData()
      fd.append('file', file)
      fd.append('tradeId', synthId)
      fd.append('phase', 'entry')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const j = await res.json()
      if (j.error) { setUploadErr(j.error); return }
      setScreenshotUrl(j.url)
    } catch (e: any) {
      setUploadErr(e?.message ?? 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Each idea may carry its own source (Claude vs user-discretionary). Fall back to prop.
  const effectiveSource = (idea.source ?? source) as 'claude' | 'user-discretionary'
  const actionKey = `${idea.pair}|${idea.direction}|${effectiveSource}`
  const action = actions[actionKey]
  const taken = action?.userAction === 'taken'
  const watched = action?.userAction === 'watched'
  const invalidated = action?.userAction === 'invalidated'

  const isHero = size === 'hero'

  // Aggregate risk preview across every ticked account — so when the user
  // mirrors a setup across three props, they see the combined $ exposure
  // before confirming, not just one account's share.
  const tickedAccounts = accounts.filter((a) => rows[a.id]?.on)
  const totalRiskDollars = tickedAccounts.reduce(
    (sum, a) => sum + (parseFloat(rows[a.id]?.riskAmount || '0') || 0),
    0,
  )
  const takeReady = tickedAccounts.length > 0
    && tickedAccounts.every((a) => (parseFloat(rows[a.id]?.riskAmount || '0') || 0) > 0)

  async function doTake() {
    if (!takeReady) return
    setSubmitting(true)
    try {
      await fetch('/api/ideas/take', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: idea.pair, direction: idea.direction,
          strong: idea.strong, weak: idea.weak, grade: idea.grade,
          divergence: idea.divergence,
          session: idea.session, reason: idea.reason,
          perAccount: tickedAccounts.map((a) => {
            const r = rows[a.id]
            const ticket = parseInt(r.ticket, 10)
            return {
              accountId: a.id,
              riskAmount: parseFloat(r.riskAmount),
              ...(Number.isFinite(ticket) && ticket > 0 && { ticket }),
            }
          }),
          source: effectiveSource,
          alertDate,
          screenshotUrl: screenshotUrl || undefined,
        }),
      })
      setOpen(null)
      onChanged?.()
    } finally { setSubmitting(false) }
  }

  // Watch can be one-click (no anchor) or armed with an entry + swing-low SL so
  // we can track algorithm strength against the call you didn't take. The
  // anchor is optional — if the user just wants to flag "I'm watching this"
  // without inputting prices, that still works.
  async function doWatch(withAnchor: boolean) {
    setSubmitting(true)
    try {
      const entry = withAnchor ? parseFloat(watchEntry) : NaN
      const sl    = withAnchor ? parseFloat(watchSl)    : NaN
      await fetch('/api/ideas/watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: idea.pair, direction: idea.direction,
          grade: idea.grade, strong: idea.strong, weak: idea.weak,
          divergence: idea.divergence, source: effectiveSource, alertDate,
          ...(Number.isFinite(entry) && Number.isFinite(sl) && entry !== sl && {
            watchEntryPrice: entry, watchSlPrice: sl,
          }),
        }),
      })
      setOpen(null)
      setWatchEntry(''); setWatchSl('')
      onChanged?.()
    } finally { setSubmitting(false) }
  }

  async function doSkip() {
    setSubmitting(true)
    try {
      await fetch('/api/ideas/invalidate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: idea.pair, direction: idea.direction,
          grade: idea.grade, strong: idea.strong, weak: idea.weak,
          divergence: idea.divergence,
          invalidationReason: reason || null, source: effectiveSource, alertDate,
        }),
      })
      setOpen(null)
      onChanged?.()
    } finally { setSubmitting(false) }
  }

  const stateBorder = taken ? 'var(--green-border)'
    : watched ? 'var(--accent-border)'
    : invalidated ? 'var(--red-border)'
    : isHero ? 'var(--accent-border)' : 'var(--border)'

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: `1px solid ${stateBorder}`,
    borderRadius: isHero ? 14 : 12,
    padding: isHero ? '18px 20px' : '14px 16px',
    backgroundImage: isHero ? 'radial-gradient(ellipse at top right, rgba(58,212,236,0.05), transparent 60%)' : undefined,
    minWidth: 0,
  }

  const statusChip = taken ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 10, color: 'var(--green)' }}>
      <Check size={11} strokeWidth={2} /> Taken
    </span>
  ) : watched ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 10, color: 'var(--accent)' }}>
      <Eye size={11} strokeWidth={2} /> Watching
    </span>
  ) : invalidated ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 10, color: 'var(--red)' }}>
      <X size={11} strokeWidth={2} /> Skipped
    </span>
  ) : null

  // ── Sub-flow panels (shared by hero + small) ──
  const flows = (
    <>
      {/* Take flow — multi-account picker + risk preview + screenshot */}
      {open === 'take' && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
              Accounts to take this on ({tickedAccounts.length}/{accounts.length})
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0.5, 1, 2].map((pct) => (
                <button key={pct} type="button" onClick={() => applyPctAll(pct)}
                        title={`Set every ticked account's $ risk to ${pct}% of its live balance`}
                        style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--accent-border)', borderRadius: 5, background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
                  {pct}% all
                </button>
              ))}
              <button type="button" onClick={selectAllAccounts}
                      style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
                All
              </button>
              <button type="button" onClick={clearAccounts}
                      style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
                None
              </button>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '6px 0' }}>No accounts available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
              {accounts.map((a) => {
                const r = rows[a.id] ?? { on: false, riskAmount: '', ticket: '' }
                const amt = parseFloat(r.riskAmount || '0') || 0
                const pctOfBal = a.currentBalance > 0 ? (amt / a.currentBalance) * 100 : 0
                return (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                    borderRadius: 7, border: `1px solid ${r.on ? 'var(--accent-border)' : 'var(--border)'}`,
                    background: r.on ? 'rgba(58,212,236,0.06)' : 'transparent', flexWrap: 'wrap',
                  }}>
                    <input
                      type="checkbox" checked={r.on} onChange={() => toggleAccount(a.id)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 12, height: 12, flexShrink: 0 }}
                    />
                    <span
                      onClick={() => toggleAccount(a.id)}
                      style={{ fontSize: 10, color: r.on ? 'var(--text-1)' : 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 60, flex: '1 1 auto' }}
                      title={`${a.name} · ${a.status}`}
                    >
                      {a.name}
                    </span>
                    <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      ${Math.round(a.currentBalance).toLocaleString()}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: r.on ? 'var(--text-2)' : 'var(--text-3)' }}>$</span>
                      <input
                        value={r.riskAmount}
                        onChange={(e) => setRow(a.id, { riskAmount: e.target.value })}
                        disabled={!r.on}
                        placeholder="risk"
                        inputMode="decimal"
                        style={{ width: 62, padding: '4px 6px', fontSize: 11, textAlign: 'right', opacity: r.on ? 1 : 0.45 }}
                      />
                      {r.on && amt > 0 && a.currentBalance > 0 && (
                        <span className="font-mono" style={{
                          fontSize: 9, whiteSpace: 'nowrap', minWidth: 34,
                          color: pctOfBal > 2 ? 'var(--amber)' : 'var(--text-3)',
                        }}>
                          {pctOfBal.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <input
                      value={r.ticket}
                      onChange={(e) => setRow(a.id, { ticket: e.target.value.replace(/[^0-9]/g, '') })}
                      disabled={!r.on}
                      placeholder="MT4 order # (optional)"
                      inputMode="numeric"
                      title="MT4 order number — leave blank and the EA auto-matches within 12h"
                      style={{ width: 118, padding: '4px 6px', fontSize: 10, opacity: r.on ? 1 : 0.45, flexShrink: 0 }}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {tickedAccounts.length > 0 && (
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              {tickedAccounts.length === 1
                ? tickedAccounts[0].name
                : `${tickedAccounts.length} accounts`} · ${Math.round(totalRiskDollars).toLocaleString()} total at risk
            </div>
          )}

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <label style={{
              fontSize: 10, padding: '4px 9px', borderRadius: 7, cursor: uploading ? 'wait' : 'pointer',
              border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent',
              opacity: uploading ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <ImagePlus size={12} strokeWidth={2} style={{ color: 'var(--accent)' }} />
              {screenshotUrl ? 'Replace setup screenshot' : 'Setup screenshot'}
              <input
                type="file" accept="image/*"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickScreenshot(f) }}
                style={{ display: 'none' }}
              />
            </label>
            {uploading && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>uploading…</span>}
            {screenshotUrl && !uploading && (
              <a href={screenshotUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)' }}>
                preview
              </a>
            )}
            {uploadErr && <span style={{ fontSize: 10, color: 'var(--red)' }}>{uploadErr}</span>}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={doTake} disabled={submitting || !takeReady}
                    style={{ ...btnStyle('primary', false), opacity: submitting || !takeReady ? 0.5 : 1 }}>
              {submitting ? '…' : `Confirm take${tickedAccounts.length > 1 ? ` × ${tickedAccounts.length}` : ''} →`}
            </button>
            <button onClick={() => setOpen(null)} disabled={submitting} style={btnStyle('ghost', false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Watch flow — optional entry + swing-low SL anchor for algorithm-strength tracking */}
      {open === 'watch' && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--accent-border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6, lineHeight: 1.4 }}>
            Optional: anchor this watch so we can show live R-multiple progress.
            Leave blank for a plain watch.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <div>
              <label style={{ display: 'block', fontSize: 9, color: 'var(--text-3)', marginBottom: 2 }}>Entry price</label>
              <input
                value={watchEntry}
                onChange={(e) => setWatchEntry(e.target.value)}
                placeholder="1.23456"
                style={{ width: '100%', padding: '5px 8px', fontSize: 11 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 9, color: 'var(--text-3)', marginBottom: 2 }}>Swing-low SL</label>
              <input
                value={watchSl}
                onChange={(e) => setWatchSl(e.target.value)}
                placeholder="1.22800"
                style={{ width: '100%', padding: '5px 8px', fontSize: 11 }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => doWatch(true)}
              disabled={submitting || !watchEntry || !watchSl}
              style={btnStyle('primary', false)}
              title="Arm watch with the anchor — algorithm-strength tracking enabled"
            >
              {submitting ? '…' : 'Arm with anchor'}
            </button>
            <button
              onClick={() => doWatch(false)}
              disabled={submitting}
              style={btnStyle('ghost', false)}
              title="Just flag as watching, no live tracking"
            >
              Just watch
            </button>
            <button onClick={() => setOpen(null)} disabled={submitting} style={btnStyle('ghost', false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Skip flow — optional reason */}
      {open === 'skip' && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Why skip? (optional)</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {PRESET_REASONS.map((r) => (
              <button key={r} onClick={() => setReason(r)} style={{
                fontSize: 10, padding: '3px 9px', borderRadius: 999,
                background: reason === r ? 'var(--amber-dim)' : 'transparent',
                color: reason === r ? 'var(--amber)' : 'var(--text-3)',
                border: `1px solid ${reason === r ? 'var(--amber-border)' : 'var(--border)'}`, cursor: 'pointer',
              }}>{r}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="or type a reason..."
                 style={{ width: '100%', padding: '5px 8px', fontSize: 11, marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={doSkip} disabled={submitting} style={btnStyle('danger', false)}>
              {submitting ? '…' : 'Confirm skip'}
            </button>
            <button onClick={() => { setOpen(null); setReason('') }} disabled={submitting} style={btnStyle('ghost', false)}>
              Cancel
            </button>
          </div>
          {invalidated && action?.invalidationReason && (
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>
              Previously skipped: "{action.invalidationReason}"
            </div>
          )}
        </div>
      )}
    </>
  )

  // ── HERO card ──
  if (isHero) {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 18 }}>
          {/* Left: chips + pair + reason */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="font-mono" style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
                padding: '2px 10px', borderRadius: 999,
                color: 'var(--accent)', border: '1px solid var(--accent-border)', background: 'var(--accent-dim)',
              }}>
                <Star size={10} strokeWidth={2} />
                Priority 1
              </span>
              {effectiveSource === 'claude' && scoringModel && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 500, padding: '2px 9px', borderRadius: 999,
                  color: 'var(--purple)', background: 'var(--purple-dim)', border: '1px solid var(--purple-border)',
                }}>
                  <Sparkles size={10} strokeWidth={2} />
                  {scoringModel.charAt(0).toUpperCase() + scoringModel.slice(1)}
                </span>
              )}
              {effectiveSource === 'user-discretionary' && (
                <span style={{
                  fontSize: 9, letterSpacing: '0.06em', fontWeight: 500,
                  padding: '2px 8px', borderRadius: 999,
                  background: 'var(--purple-dim)', color: 'var(--purple)', border: '1px solid var(--purple-border)',
                }}>YOUR CALL</span>
              )}
              {idea.confidence && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>· {idea.confidence}</span>}
              {idea.pricedInRisk && <span style={{ fontSize: 10, color: 'var(--amber)' }}>· pricedIn</span>}
              {statusChip}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="font-mono" style={{ fontSize: 29, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-1)' }}>
                {idea.pair}
              </span>
              <DirLabel direction={idea.direction} size={14} />
              <GradePill grade={idea.grade} />
            </div>

            {idea.reason && (
              <p style={{ fontSize: 13, color: 'var(--text-body)', margin: 0, lineHeight: 1.6, maxWidth: 620 }}>
                {idea.reason}
              </p>
            )}
          </div>

          {/* Right: stacked actions */}
          {!open && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 128, alignItems: 'stretch' }}>
              <button onClick={() => setOpen('take')} disabled={submitting} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '11px 16px', borderRadius: 9, cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                background: taken ? 'var(--green-dim)' : 'var(--accent-dim)',
                color: taken ? 'var(--green)' : 'var(--accent)',
                border: `1px solid ${taken ? 'var(--green-border)' : 'var(--accent-border)'}`,
              }}>
                <CirclePlus size={15} strokeWidth={2} />
                {taken ? 'Taken' : 'Take'}
              </button>
              <button onClick={() => setOpen('watch')} disabled={submitting} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontWeight: 500,
                background: watched ? 'var(--accent-dim)' : 'transparent',
                color: watched ? 'var(--accent)' : 'var(--text-2)',
                border: `1px solid ${watched ? 'var(--accent-border)' : 'var(--border)'}`,
              }}>
                <Eye size={12} strokeWidth={2} />
                {watched ? 'Watching' : 'Watch'}
              </button>
              <button onClick={() => setOpen('skip')} disabled={submitting} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontWeight: 500,
                background: invalidated ? 'var(--red-dim)' : 'transparent',
                color: invalidated ? 'var(--red)' : 'var(--text-2)',
                border: `1px solid ${invalidated ? 'var(--red-border)' : 'var(--border)'}`,
              }}>
                <X size={12} strokeWidth={2} />
                {invalidated ? 'Skipped' : 'Skip'}
              </button>
              {idea.session?.length ? (
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', marginTop: 2 }}>
                  {idea.session.join(' · ')}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer metric row */}
        <div style={{
          display: 'flex', gap: 28, flexWrap: 'wrap',
          borderTop: '1px solid var(--border-faint)', marginTop: 14, paddingTop: 12,
        }}>
          <div>
            <div className="kicker" style={{ fontSize: 9, marginBottom: 3 }}>Divergence</div>
            <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: 'var(--accent)' }}>
              {typeof idea.divergence === 'number' ? `${idea.divergence.toFixed(1)}σ` : '—'}
            </div>
          </div>
          <div>
            <div className="kicker" style={{ fontSize: 9, marginBottom: 3 }}>Strong · {idea.strong || '—'}</div>
            <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: 'var(--green)' }}>
              {fmtSigned(idea.strongScore, 1)}
            </div>
          </div>
          <div>
            <div className="kicker" style={{ fontSize: 9, marginBottom: 3 }}>Weak · {idea.weak || '—'}</div>
            <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: 'var(--red)' }}>
              {fmtSigned(idea.weakScore, 1)}
            </div>
          </div>
        </div>

        {flows}
      </div>
    )
  }

  // ── Secondary (small) card ──
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {rank != null && (
          <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>#{rank}</span>
        )}
        <span className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-1)' }}>{idea.pair}</span>
        <DirLabel direction={idea.direction} size={11} />
        {effectiveSource === 'user-discretionary' && (
          <span style={{
            fontSize: 9, letterSpacing: '0.06em', fontWeight: 500,
            padding: '1px 7px', borderRadius: 999,
            background: 'var(--purple-dim)', color: 'var(--purple)', border: '1px solid var(--purple-border)',
          }}>YOURS</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {statusChip}
          <GradePill grade={idea.grade} />
        </span>
      </div>

      <div style={{ display: 'flex', gap: 22, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="kicker" style={{ fontSize: 9, marginBottom: 2 }}>Div</div>
          <div className="font-mono" style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)' }}>
            {typeof idea.divergence === 'number' ? `${idea.divergence.toFixed(1)}σ` : '—'}
          </div>
        </div>
        <div>
          <div className="kicker" style={{ fontSize: 9, marginBottom: 2 }}>Pair flow</div>
          <div className="font-mono" style={{ fontSize: 14, fontWeight: 500 }}>
            <span style={{ color: 'var(--green)' }}>{fmtSigned(idea.strongScore, 1)}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}> vs </span>
            <span style={{ color: 'var(--red)' }}>{fmtSigned(idea.weakScore, 1)}</span>
          </div>
        </div>
        {idea.session?.length ? (
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{idea.session.join(' · ')}</span>
          </div>
        ) : null}
      </div>

      {!open && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setOpen('take')} disabled={submitting} style={{
            flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 600,
            background: taken ? 'var(--green-dim)' : 'var(--accent-dim)',
            color: taken ? 'var(--green)' : 'var(--accent)',
            border: `1px solid ${taken ? 'var(--green-border)' : 'var(--accent-border)'}`,
          }}>
            <CirclePlus size={12} strokeWidth={2} />
            {taken ? 'Taken' : 'Take'}
          </button>
          <button onClick={() => setOpen('watch')} disabled={submitting} title={watched ? 'Watching' : 'Watch'} style={{
            width: 30, height: 30, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: watched ? 'var(--accent-dim)' : 'transparent',
            color: watched ? 'var(--accent)' : 'var(--text-2)',
            border: `1px solid ${watched ? 'var(--accent-border)' : 'var(--border)'}`,
          }}>
            <Eye size={13} strokeWidth={2} />
          </button>
          <button onClick={() => setOpen('skip')} disabled={submitting} title={invalidated ? 'Skipped' : 'Skip'} style={{
            width: 30, height: 30, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: invalidated ? 'var(--red-dim)' : 'transparent',
            color: invalidated ? 'var(--red)' : 'var(--text-2)',
            border: `1px solid ${invalidated ? 'var(--red-border)' : 'var(--border)'}`,
          }}>
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      {flows}
    </div>
  )
}

// Sensible default $ risk: pct% of the live balance, rounded to a whole dollar.
function defaultRisk(balance: number, pct: number): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0
  return Math.round(balance * (pct / 100))
}

type BtnVariant = 'primary' | 'ghost' | 'danger'

function btnStyle(variant: BtnVariant, big: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1,
    padding: big ? '6px 10px' : '5px 10px',
    fontSize: big ? 11 : 10,
    fontWeight: 500,
    borderRadius: 7,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }
  switch (variant) {
    case 'primary':  return { ...base, background: 'var(--accent)', color: 'var(--accent-on)', border: 'none', fontWeight: 600 }
    case 'ghost':    return { ...base, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)' }
    case 'danger':   return { ...base, background: 'transparent', color: 'var(--red)', border: '1px solid var(--red-border)' }
  }
}

function countTaken(actions: Record<string, IdeaAction>): number {
  return Object.values(actions).filter((a) => a.userAction === 'taken').length
}
function countSkipped(actions: Record<string, IdeaAction>): number {
  return Object.values(actions).filter((a) => a.userAction === 'invalidated').length
}

// ─── LogMySetupForm — inline form for user-discretionary ideas ────────────────

const COMMON_PAIRS = [
  'EUR/USD', 'GBP/USD', 'AUD/USD', 'NZD/USD',
  'USD/JPY', 'USD/CAD', 'USD/CHF',
  'EUR/GBP', 'EUR/JPY', 'GBP/JPY',
  'XAU/USD', 'XAG/USD',
]
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'NOK', 'SEK']

function LogMySetupForm({ onClose, onLogged }: {
  onClose: () => void
  onLogged: () => void
}) {
  const [pair, setPair] = useState('')
  const [direction, setDirection] = useState<'Long' | 'Short'>('Long')
  const [grade, setGrade] = useState<'A+' | 'B' | 'C'>('A+')
  const [userModel, setUserModel] = useState<'A' | 'B' | ''>('')
  const [strong, setStrong] = useState('')
  const [weak, setWeak] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    if (!pair.trim()) { setErr('Pair is required'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/ideas/log-discretionary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: pair.toUpperCase().trim(),
          direction, grade,
          userModel: userModel || undefined,
          strong: strong || undefined,
          weak: weak || undefined,
          reason: reason.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErr(j.error ?? 'Failed to log setup')
        return
      }
      onLogged()
    } finally { setSubmitting(false) }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  }

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 10, border: '1px solid var(--purple-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span className="kicker" style={{ color: 'var(--purple)' }}>
          Log your own setup
        </span>
        <button onClick={onClose} style={{
          fontSize: 12, color: 'var(--text-3)', background: 'transparent',
          border: 'none', cursor: 'pointer',
        }}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Pair</span>
          <input list="my-setup-pairs" value={pair} onChange={(e) => setPair(e.target.value.toUpperCase())}
                 placeholder="GBP/USD"
                 style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }} />
          <datalist id="my-setup-pairs">{COMMON_PAIRS.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="Long">Long ↑</option>
            <option value="Short">Short ↓</option>
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Grade</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value as any)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="A+">A+</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Model</span>
          <select value={userModel} onChange={(e) => setUserModel(e.target.value as any)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="">—</option>
            <option value="A">A · Wyckoff</option>
            <option value="B">B · Liquidity</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Strong currency</span>
          <select value={strong} onChange={(e) => setStrong(e.target.value)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="">—</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={labelStyle}>Weak currency</span>
          <select value={weak} onChange={(e) => setWeak(e.target.value)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="">—</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <span style={labelStyle}>Why this setup (one sentence)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
               placeholder="GBP/JPY H4 spring at 198.00, liquidity grab + reclaim"
               style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }} />
      </div>

      {err && (
        <div style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'var(--red-dim)',
                      color: 'var(--red)', border: '1px solid var(--red-border)', marginBottom: 8 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={submit} disabled={submitting} style={{
          background: 'var(--accent)', color: 'var(--accent-on)', border: 'none',
          padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          {submitting ? 'Logging…' : 'Log setup'}
        </button>
        <button onClick={onClose} disabled={submitting} style={{
          background: 'transparent', color: 'var(--text-2)',
          border: '1px solid var(--border)', padding: '6px 14px',
          borderRadius: 8, fontSize: 11, cursor: 'pointer',
        }}>Cancel</button>
        <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 10, color: 'var(--text-3)' }}>
          tracking-only · no position created
        </span>
      </div>
    </div>
  )
}
