'use client'
// app/_components/MultiIdeaHero.tsx
// Top of dashboard when an analysis exists. Shows Claude's ranked ideas as cards
// with Take / Watch / Skip actions inline. Take opens an account selector + risk
// preview. Skip opens an optional-reason form. Watch is a one-click commit.

import { useMemo, useState } from 'react'
import { ImagePlus } from 'lucide-react'

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
}

const PRESET_REASONS = [
  'no clean entry',
  'news risk',
  'low confidence',
  'already at risk limit',
  'against H4 structure',
  'volume not confirming',
]

export function MultiIdeaHero({
  ideas, ideaActions = {}, accounts, onChanged, alertDate, source = 'claude',
}: Props) {
  const [logOpen, setLogOpen] = useState(false)
  const hasIdeas = ideas && ideas.length > 0
  const top = hasIdeas ? ideas[0] : null
  const rest = hasIdeas ? ideas.slice(1, 5) : []
  const single = hasIdeas && ideas.length === 1

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
        <div className="section-label" style={{ margin: 0 }}>
          {hasIdeas ? `Today's calls · ${ideas.length} ranked` : "Today's calls"}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {hasIdeas && (
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {countTaken(ideaActions)} taken · {countSkipped(ideaActions)} skipped
            </div>
          )}
          {!logOpen && (
            <button onClick={() => setLogOpen(true)} style={{
              fontSize: 11, color: 'var(--blue)', background: 'transparent',
              border: '1px solid var(--blue-border)', padding: '3px 10px',
              borderRadius: 6, cursor: 'pointer',
            }}>+ Log my setup</button>
          )}
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
          padding: 14, background: 'var(--bg-card)', border: '1px dashed var(--border)',
          borderRadius: 10, textAlign: 'center', fontSize: 12, color: 'var(--text-3)',
        }}>
          No calls yet. Run analysis or log your own setup above.
        </div>
      )}

      {hasIdeas && single && top && (
        <IdeaCard idea={top} size="hero" actions={ideaActions} accounts={accounts}
                  alertDate={alertDate} source={source} onChanged={onChanged} />
      )}
      {hasIdeas && !single && top && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }}>
          <IdeaCard idea={top} size="hero" actions={ideaActions} accounts={accounts}
                    alertDate={alertDate} source={source} onChanged={onChanged} rank={1} />
          {rest.slice(0, 2).map((idea, i) => (
            <IdeaCard key={`${idea.pair}-${idea.direction}-${i}`} idea={idea} size="small"
                      actions={ideaActions} accounts={accounts}
                      alertDate={alertDate} source={source} onChanged={onChanged} rank={i + 2} />
          ))}
        </div>
      )}

      {hasIdeas && rest.length > 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(rest.length - 2, 4)}, 1fr)`, gap: 8, marginTop: 8 }}>
          {rest.slice(2).map((idea, i) => (
            <IdeaCard key={`b-${idea.pair}-${idea.direction}-${i}`} idea={idea} size="small"
                      actions={ideaActions} accounts={accounts}
                      alertDate={alertDate} source={source} onChanged={onChanged} rank={i + 4} />
          ))}
        </div>
      )}
    </div>
  )
}

function IdeaCard({
  idea, size, actions = {}, accounts, alertDate, source = 'claude', onChanged, rank,
}: {
  idea: Idea
  size: 'hero' | 'small'
  actions?: Record<string, IdeaAction>
  accounts: AccountLite[]
  alertDate?: string
  source?: 'claude' | 'user-discretionary'
  onChanged?: () => void
  rank?: number
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
  const gradeStyle = useMemo(() => {
    if (idea.grade === 'A+') return { bg: 'var(--green-dim)', fg: 'var(--green)' }
    if (idea.grade === 'B') return { bg: 'var(--amber-dim)', fg: 'var(--amber)' }
    if (idea.grade === 'Skip') return { bg: 'var(--red-dim)', fg: 'var(--red)' }
    return { bg: 'var(--bg-elevated)', fg: 'var(--text-2)' }
  }, [idea.grade])

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

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: `1px solid ${
      taken        ? 'var(--green-border)' :
      watched      ? 'var(--blue-border)'  :
      invalidated  ? 'var(--red-border)'   :
      isHero ? 'rgba(35,224,160,0.25)' : 'var(--border)'
    }`,
    borderRadius: 10,
    padding: isHero ? '14px 16px' : '11px 13px',
    backgroundImage: isHero ? 'radial-gradient(ellipse at top right, rgba(35,224,160,0.05), transparent 60%)' : undefined,
    minWidth: 0,
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isHero ? 8 : 6, flexWrap: 'wrap' }}>
        {/* Source chip — distinguishes Claude's calls from your own */}
        <span style={{
          fontSize: 9, letterSpacing: '0.06em', fontWeight: 500,
          padding: '1px 6px', borderRadius: 3,
          background: effectiveSource === 'user-discretionary' ? 'var(--blue-dim)' : 'var(--green-dim)',
          color:      effectiveSource === 'user-discretionary' ? 'var(--blue)' : 'var(--green)',
          border:     `1px solid ${effectiveSource === 'user-discretionary' ? 'var(--blue-border)' : 'var(--green-border)'}`,
        }}>
          {effectiveSource === 'user-discretionary' ? 'YOUR CALL' : 'CLAUDE'}
        </span>
        {rank && effectiveSource === 'claude' && (
          <span style={{
            fontSize: isHero ? 11 : 10, color: rank === 1 ? 'var(--green)' : 'var(--text-2)',
            letterSpacing: '0.1em', fontWeight: 500,
          }}>
            {rank === 1 ? '#1' : `#${rank}`}
          </span>
        )}
        <span style={{
          background: gradeStyle.bg, color: gradeStyle.fg,
          padding: '1px 6px', borderRadius: 3,
          fontSize: 10, fontWeight: 500,
        }}>{idea.grade}</span>
        {idea.confidence && (
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>· {idea.confidence}</span>
        )}
        {taken && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)' }}>✓ Taken</span>}
        {watched && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--blue)' }}>👁 Watching</span>}
        {invalidated && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--red)' }}>✕ Skipped</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span className="font-mono" style={{ fontSize: isHero ? 22 : 16, fontWeight: 500, color: 'var(--text-1)' }}>
          {idea.pair}
        </span>
        <span style={{ color: idea.direction === 'Long' ? 'var(--green)' : 'var(--red)', fontSize: isHero ? 13 : 11 }}>
          {idea.direction === 'Long' ? '↑ Long' : '↓ Short'}
        </span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, lineHeight: 1.5 }}>
        div {idea.divergence?.toFixed(1)} · {idea.strong} vs {idea.weak}
        {idea.session?.length ? ` · ${idea.session.join(', ')}` : ''}
        {idea.pricedInRisk && <span style={{ color: 'var(--amber)' }}> · pricedIn</span>}
      </div>

      {isHero && idea.reason && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.5 }}>
          {idea.reason}
        </div>
      )}

      {/* Action row — only show when not in a sub-flow */}
      {!open && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setOpen('take')} disabled={submitting} style={btnStyle(taken ? 'taken' : 'primary', isHero)}>
            {taken ? 'Taken' : 'Take'}
          </button>
          <button onClick={() => setOpen(open === 'watch' ? null : 'watch')} disabled={submitting} style={btnStyle(watched ? 'watching' : 'ghost', isHero)}>
            {watched ? 'Watching' : 'Watch'}
          </button>
          <button onClick={() => setOpen('skip')} disabled={submitting} style={btnStyle(invalidated ? 'skipped' : 'danger', isHero)}>
            {invalidated ? 'Skipped' : 'Skip'}
          </button>
        </div>
      )}

      {/* Take flow — multi-account picker + risk preview + screenshot */}
      {open === 'take' && (
        <div style={{ marginTop: 6, padding: 8, background: 'var(--bg-card-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
              Accounts to take this on ({tickedAccounts.length}/{accounts.length})
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0.5, 1, 2].map((pct) => (
                <button key={pct} type="button" onClick={() => applyPctAll(pct)}
                        title={`Set every ticked account's $ risk to ${pct}% of its live balance`}
                        style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
                  {pct}% all
                </button>
              ))}
              <button type="button" onClick={selectAllAccounts}
                      style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
                All
              </button>
              <button type="button" onClick={clearAccounts}
                      style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
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
                    borderRadius: 6, border: `1px solid ${r.on ? 'rgba(58,212,236,0.35)' : 'var(--border)'}`,
                    background: r.on ? 'rgba(58,212,236,0.06)' : 'transparent',
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
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
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
                        style={{ width: 62, padding: '4px 6px', fontSize: 11, textAlign: 'right', fontFamily: 'DM Mono, monospace', opacity: r.on ? 1 : 0.45 }}
                      />
                      {r.on && amt > 0 && a.currentBalance > 0 && (
                        <span style={{
                          fontSize: 9, fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap', minWidth: 34,
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
                      style={{ width: 118, padding: '4px 6px', fontSize: 10, fontFamily: 'DM Mono, monospace', opacity: r.on ? 1 : 0.45, flexShrink: 0 }}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {tickedAccounts.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              {tickedAccounts.length === 1
                ? tickedAccounts[0].name
                : `${tickedAccounts.length} accounts`} · ${Math.round(totalRiskDollars).toLocaleString()} total at risk
            </div>
          )}

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <label style={{
              fontSize: 10, padding: '4px 8px', borderRadius: 6, cursor: uploading ? 'wait' : 'pointer',
              border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent',
              opacity: uploading ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <ImagePlus size={12} style={{ color: 'var(--accent)' }} />
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
              <a href={screenshotUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--blue)' }}>
                preview
              </a>
            )}
            {uploadErr && <span style={{ fontSize: 10, color: 'var(--red)' }}>{uploadErr}</span>}
          </div>

          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
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
        <div style={{ marginTop: 6, padding: 8, background: 'var(--bg-card-2)', borderRadius: 6, border: '1px solid var(--blue-border)' }}>
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
                style={{ width: '100%', padding: '5px 8px', fontSize: 11, fontFamily: 'monospace' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 9, color: 'var(--text-3)', marginBottom: 2 }}>Swing-low SL</label>
              <input
                value={watchSl}
                onChange={(e) => setWatchSl(e.target.value)}
                placeholder="1.22800"
                style={{ width: '100%', padding: '5px 8px', fontSize: 11, fontFamily: 'monospace' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
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
        <div style={{ marginTop: 6, padding: 8, background: 'var(--bg-card-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Why skip? (optional)</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {PRESET_REASONS.map((r) => (
              <button key={r} onClick={() => setReason(r)} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 4,
                background: reason === r ? 'var(--amber-dim)' : 'transparent',
                color: reason === r ? 'var(--amber)' : 'var(--text-3)',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>{r}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="or type a reason..."
                 style={{ width: '100%', padding: '5px 8px', fontSize: 11, marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 4 }}>
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
    </div>
  )
}

// Sensible default $ risk: pct% of the live balance, rounded to a whole dollar.
function defaultRisk(balance: number, pct: number): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0
  return Math.round(balance * (pct / 100))
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'taken' | 'watching' | 'skipped'

function btnStyle(variant: BtnVariant, big: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1,
    padding: big ? '6px 10px' : '5px 8px',
    fontSize: big ? 11 : 10,
    fontWeight: 500,
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }
  switch (variant) {
    case 'primary':  return { ...base, background: 'var(--green)',     color: '#001a14', border: 'none' }
    case 'ghost':    return { ...base, background: 'transparent',      color: 'var(--text-2)', border: '1px solid var(--border)' }
    case 'danger':   return { ...base, background: 'transparent',      color: 'var(--red)',    border: '1px solid var(--red-border)' }
    case 'taken':    return { ...base, background: 'var(--green-dim)', color: 'var(--green)',  border: '1px solid var(--green-border)' }
    case 'watching': return { ...base, background: 'var(--blue-dim)',  color: 'var(--blue)',   border: '1px solid var(--blue-border)' }
    case 'skipped':  return { ...base, background: 'var(--red-dim)',   color: 'var(--red)',    border: '1px solid var(--red-border)' }
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

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 10, border: '1px solid var(--blue-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--blue)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Log your own setup
        </span>
        <button onClick={onClose} style={{
          fontSize: 11, color: 'var(--text-3)', background: 'transparent',
          border: 'none', cursor: 'pointer',
        }}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pair</span>
          <input list="my-setup-pairs" value={pair} onChange={(e) => setPair(e.target.value.toUpperCase())}
                 placeholder="GBP/USD"
                 style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }} />
          <datalist id="my-setup-pairs">{COMMON_PAIRS.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="Long">Long ↑</option>
            <option value="Short">Short ↓</option>
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Grade</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value as any)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="A+">A+</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Model</span>
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
          <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strong currency</span>
          <select value={strong} onChange={(e) => setStrong(e.target.value)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="">—</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Weak currency</span>
          <select value={weak} onChange={(e) => setWeak(e.target.value)}
                  style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }}>
            <option value="">—</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Why this setup (one sentence)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
               placeholder="GBP/JPY H4 spring at 198.00, liquidity grab + reclaim"
               style={{ width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 11, boxSizing: 'border-box' }} />
      </div>

      {err && (
        <div style={{ fontSize: 11, padding: '5px 8px', borderRadius: 5, background: 'var(--red-dim)',
                      color: 'var(--red)', border: '1px solid var(--red-border)', marginBottom: 8 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={submit} disabled={submitting} style={{
          background: 'var(--blue)', color: '#fff', border: 'none',
          padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
        }}>
          {submitting ? 'Logging…' : 'Log setup'}
        </button>
        <button onClick={onClose} disabled={submitting} style={{
          background: 'transparent', color: 'var(--text-2)',
          border: '1px solid var(--border)', padding: '6px 14px',
          borderRadius: 6, fontSize: 11, cursor: 'pointer',
        }}>Cancel</button>
        <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 10, color: 'var(--text-3)' }}>
          tracking-only · no position created
        </span>
      </div>
    </div>
  )
}
