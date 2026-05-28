'use client'
// app/_components/MultiIdeaHero.tsx
// Top of dashboard when an analysis exists. Shows Claude's ranked ideas as cards
// with Take / Watch / Skip actions inline. Take opens an account selector + risk
// preview. Skip opens an optional-reason form. Watch is a one-click commit.

import { useMemo, useState } from 'react'

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
  const [open, setOpen] = useState<null | 'take' | 'skip'>(null)
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '')
  const [riskPct, setRiskPct] = useState<string>('0.5')
  const [reason, setReason] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

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

  const account = accounts.find((a) => a.id === accountId)
  const riskDollars = account ? Math.round((parseFloat(riskPct || '0') / 100) * account.currentBalance) : 0

  async function doTake() {
    if (!accountId) return
    setSubmitting(true)
    try {
      await fetch('/api/ideas/take', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: idea.pair, direction: idea.direction,
          strong: idea.strong, weak: idea.weak, grade: idea.grade,
          divergence: idea.divergence,
          session: idea.session, reason: idea.reason,
          accountId, riskPct: parseFloat(riskPct), source: effectiveSource, alertDate,
        }),
      })
      setOpen(null)
      onChanged?.()
    } finally { setSubmitting(false) }
  }

  async function doWatch() {
    setSubmitting(true)
    try {
      await fetch('/api/ideas/watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: idea.pair, direction: idea.direction,
          grade: idea.grade, strong: idea.strong, weak: idea.weak,
          divergence: idea.divergence, source: effectiveSource, alertDate,
        }),
      })
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
      isHero ? 'rgba(0,212,138,0.25)' : 'var(--border)'
    }`,
    borderRadius: 10,
    padding: isHero ? '14px 16px' : '11px 13px',
    backgroundImage: isHero ? 'radial-gradient(ellipse at top right, rgba(0,212,138,0.05), transparent 60%)' : undefined,
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
          <button onClick={doWatch} disabled={submitting || watched} style={btnStyle(watched ? 'watching' : 'ghost', isHero)}>
            {watched ? 'Watching' : 'Watch'}
          </button>
          <button onClick={() => setOpen('skip')} disabled={submitting} style={btnStyle(invalidated ? 'skipped' : 'danger', isHero)}>
            {invalidated ? 'Skipped' : 'Skip'}
          </button>
        </div>
      )}

      {/* Take flow — account picker + risk preview */}
      {open === 'take' && (
        <div style={{ marginTop: 6, padding: 8, background: 'var(--bg-card-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                    style={{ flex: '1 1 140px', minWidth: 0, padding: '5px 8px', fontSize: 11 }}>
              {accounts.length === 0 && <option value="">No accounts</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {a.status}</option>
              ))}
            </select>
            <input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} placeholder="risk%"
                   style={{ width: 56, padding: '5px 8px', fontSize: 11, textAlign: 'center' }} />
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>%</span>
          </div>
          {account && (
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              {riskPct}% on {account.name} = ${riskDollars.toLocaleString()} at risk
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button onClick={doTake} disabled={submitting || !accountId} style={btnStyle('primary', false)}>
              {submitting ? '…' : 'Confirm take →'}
            </button>
            <button onClick={() => setOpen(null)} disabled={submitting} style={btnStyle('ghost', false)}>Cancel</button>
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
