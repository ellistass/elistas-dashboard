'use client'
// app/_components/AccountTiles.tsx
// Per-account tile row at the top of the dashboard. Toggles between:
//   • per-account view — one tile per account, sizes adaptively
//       (1 = full-width, 2-3 = flex evenly, 4+ = horizontal scroll)
//   • total view       — one aggregate tile across all accounts
// Preference persisted to localStorage so it survives reloads.

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface AccountTile {
  id: string
  name: string
  broker: string
  status: string
  currency: string
  startingBalance: number
  currentBalance: number
  currentEquity?: number | null
  maxDrawdownPct: number
  dailyDrawdownLimitPct: number
  currentDrawdownPct: number
  payoutStatus?: string
  isActive: boolean
  stats: {
    openTrades: number
    todayR: number
    todayPnLDollars: number
    closedToday: number
    dailyDdLimitDollars: number
    dailyDdUsedDollars: number
    dailyDdPctOfLimit: number
    profitTargetDollars: number | null
    profitFromStart: number
    profitTargetPct: number | null
    drawdownRemaining: number
    drawdownDanger: boolean
    firstOpenPair: string | null
    firstOpenDirection: string | null
  }
}

interface Props { accounts: AccountTile[] }

const STATUS_STYLES: Record<string, { bg: string; fg: string; border: string }> = {
  Phase1:   { bg: 'rgba(99,102,241,0.12)',  fg: '#6366f1', border: 'rgba(99,102,241,0.25)' },
  Phase2:   { bg: 'rgba(167,139,250,0.12)', fg: '#a78bfa', border: 'rgba(167,139,250,0.25)' },
  Funded:   { bg: 'var(--green-dim)',       fg: 'var(--green)',  border: 'var(--green-border)' },
  Live:     { bg: 'var(--green-dim)',       fg: 'var(--green)',  border: 'var(--green-border)' },
  Passed:   { bg: 'var(--green-dim)',       fg: 'var(--green)',  border: 'var(--green-border)' },
  Breached: { bg: 'var(--red-dim)',         fg: 'var(--red)',    border: 'var(--red-border)' },
  Failed:   { bg: 'var(--red-dim)',         fg: 'var(--red)',    border: 'var(--red-border)' },
  Archived: { bg: 'var(--bg-elevated)',     fg: 'var(--text-3)', border: 'var(--border)' },
}

function fmtMoney(n: number, ccy: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: ccy, maximumFractionDigits: 0,
  }).format(n)
}
function ddColor(pctOfLimit: number): string {
  if (pctOfLimit >= 0.7) return 'var(--red)'
  if (pctOfLimit >= 0.4) return 'var(--amber)'
  return 'var(--green)'
}
function tdColor(pctRemaining: number, maxPct: number): string {
  const pctUsed = 1 - pctRemaining / maxPct
  if (pctUsed >= 0.7) return 'var(--red)'
  if (pctUsed >= 0.4) return 'var(--amber)'
  return 'var(--green)'
}

// ─── Per-account tile ────────────────────────────────────────────────────────

function PerAccountTile({ acc }: { acc: AccountTile }) {
  const equity = acc.currentEquity ?? acc.currentBalance
  const statusStyle = STATUS_STYLES[acc.status] ?? STATUS_STYLES.Archived
  const todayPos = acc.stats.todayPnLDollars >= 0
  const dailyDdPct = acc.stats.dailyDdPctOfLimit
  const totalDdPctUsed = acc.maxDrawdownPct > 0
    ? Math.max(0, Math.min(1, acc.currentDrawdownPct / acc.maxDrawdownPct))
    : 0
  const dangerBorder = dailyDdPct >= 0.7 || acc.stats.drawdownDanger
  const profitPct = acc.stats.profitTargetPct
  const hasTarget = acc.stats.profitTargetDollars != null

  return (
    <Link href="/accounts" style={{ textDecoration: 'none', minWidth: 0, display: 'block' }}>
      <div style={{
        background: 'var(--bg-card)',
        border: `1px solid ${dangerBorder ? 'var(--amber-border)' : 'var(--border)'}`,
        borderRadius: 10, padding: '11px 13px',
        minWidth: 0, height: '100%',
        cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-3)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = dangerBorder ? 'var(--amber-border)' : 'var(--border)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</span>
          <span style={{ background: statusStyle.bg, color: statusStyle.fg, border: `1px solid ${statusStyle.border}`,
            padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 500, letterSpacing: '0.05em',
            textTransform: 'uppercase', flexShrink: 0 }}>{acc.status}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
          <span className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-1)' }}>
            {fmtMoney(equity, acc.currency)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>equity</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>
          <span>bal {fmtMoney(acc.currentBalance, acc.currency)}</span>
          <span style={{ color: acc.stats.closedToday > 0 ? (todayPos ? 'var(--green)' : 'var(--red)') : 'var(--text-3)' }}>
            today {acc.stats.closedToday === 0 ? '—' : `${todayPos ? '+' : ''}${fmtMoney(acc.stats.todayPnLDollars, acc.currency)} · ${acc.stats.todayR > 0 ? '+' : ''}${acc.stats.todayR.toFixed(1)}R`}
          </span>
        </div>

        <DDBar label="DAILY DD"
          rightHint={`${fmtMoney(acc.stats.dailyDdUsedDollars, acc.currency)} of ${fmtMoney(acc.stats.dailyDdLimitDollars, acc.currency)}`}
          fillPct={dailyDdPct} fillColor={ddColor(dailyDdPct)} />

        <DDBar label="TOTAL DD"
          rightHint={`${acc.currentDrawdownPct.toFixed(1)}% of ${acc.maxDrawdownPct.toFixed(0)}%`}
          fillPct={totalDdPctUsed} fillColor={tdColor(acc.stats.drawdownRemaining, acc.maxDrawdownPct)} />

        {hasTarget ? (
          <DDBar label="TARGET"
            rightHint={`${fmtMoney(acc.stats.profitFromStart, acc.currency)} of ${fmtMoney(acc.stats.profitTargetDollars!, acc.currency)} · ${Math.round((profitPct ?? 0) * 100)}%`}
            fillPct={profitPct ?? 0} fillColor={statusStyle.fg} />
        ) : acc.payoutStatus && acc.payoutStatus !== 'None' ? (
          <DDBar label="PAYOUT" rightHint={acc.payoutStatus.toLowerCase()}
            fillPct={acc.payoutStatus === 'Paid' ? 1 : 0.5} fillColor="var(--green)" />
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 10 }}>
          {acc.stats.openTrades === 0 ? (
            <><span style={{ color: 'var(--text-3)' }}>no open trades</span><span style={{ color: 'var(--text-3)' }}>○</span></>
          ) : (
            <>
              <span style={{ color: 'var(--text-2)' }}>
                {acc.stats.openTrades} open{acc.stats.firstOpenPair ? ` · ${acc.stats.firstOpenPair} ${acc.stats.firstOpenDirection === 'Long' ? '↑' : '↓'}` : ''}
              </span>
              <span style={{ color: 'var(--green)' }}>●</span>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

function DDBar({ label, rightHint, fillPct, fillColor }: {
  label: string; rightHint: string; fillPct: number; fillColor: string
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginBottom: 2, letterSpacing: '0.06em' }}>
        <span>{label}</span><span>{rightHint}</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-card-2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, fillPct * 100))}%`,
          height: '100%', background: fillColor, transition: 'width 0.3s',
        }} />
      </div>
    </div>
  )
}

// ─── Total (aggregate) tile ──────────────────────────────────────────────────

function TotalTile({ accounts }: { accounts: AccountTile[] }) {
  const totalEquity = accounts.reduce((s, a) => s + (a.currentEquity ?? a.currentBalance), 0)
  const totalBalance = accounts.reduce((s, a) => s + a.currentBalance, 0)
  const totalTodayPnL = accounts.reduce((s, a) => s + a.stats.todayPnLDollars, 0)
  const totalTodayR = accounts.reduce((s, a) => s + a.stats.todayR, 0)
  const totalOpenTrades = accounts.reduce((s, a) => s + a.stats.openTrades, 0)
  const totalClosedToday = accounts.reduce((s, a) => s + a.stats.closedToday, 0)
  const todayPos = totalTodayPnL >= 0

  // Weighted DD across accounts — flag the worst one too
  const totalDdLimit = accounts.reduce((s, a) => s + a.stats.dailyDdLimitDollars, 0)
  const totalDdUsed  = accounts.reduce((s, a) => s + a.stats.dailyDdUsedDollars, 0)
  const aggregateDdPct = totalDdLimit > 0 ? Math.min(1, totalDdUsed / totalDdLimit) : 0
  const worstAcc = [...accounts].sort((a, b) => b.stats.dailyDdPctOfLimit - a.stats.dailyDdPctOfLimit)[0]
  const worstDdPct = worstAcc?.stats.dailyDdPctOfLimit ?? 0

  const totalTargetDollars = accounts.reduce((s, a) => s + (a.stats.profitTargetDollars ?? 0), 0)
  const totalTargetEarned = accounts.reduce((s, a) => s + (a.stats.profitFromStart > 0 ? a.stats.profitFromStart : 0), 0)
  const aggregateTargetPct = totalTargetDollars > 0
    ? Math.max(0, Math.min(1, totalTargetEarned / totalTargetDollars))
    : null

  const phaseCounts: Record<string, number> = {}
  for (const a of accounts) phaseCounts[a.status] = (phaseCounts[a.status] ?? 0) + 1

  const dangerBorder = worstDdPct >= 0.7

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${dangerBorder ? 'var(--amber-border)' : 'var(--border)'}`,
      borderRadius: 10, padding: '14px 18px', width: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>
          All accounts <span style={{ color: 'var(--text-3)' }}>· {accounts.length}</span>
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(phaseCounts).map(([status, n]) => {
            const s = STATUS_STYLES[status] ?? STATUS_STYLES.Archived
            return (
              <span key={status} style={{
                background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
                padding: '1px 7px', borderRadius: 3, fontSize: 9, fontWeight: 500,
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>{status} · {n}</span>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total equity</div>
          <div className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-1)', marginTop: 2 }}>
            {fmtMoney(totalEquity)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            bal {fmtMoney(totalBalance)}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today P&L</div>
          <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: totalClosedToday === 0 ? 'var(--text-3)' : todayPos ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
            {totalClosedToday === 0 ? '—' : `${todayPos ? '+' : ''}${fmtMoney(totalTodayPnL)}`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            {totalClosedToday === 0 ? 'no trades closed' : `${totalTodayR > 0 ? '+' : ''}${totalTodayR.toFixed(2)}R · ${totalClosedToday} closed`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Open positions</div>
          <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: totalOpenTrades > 0 ? 'var(--text-1)' : 'var(--text-3)', marginTop: 2 }}>
            {totalOpenTrades}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            across {accounts.filter((a) => a.stats.openTrades > 0).length} account(s)
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <DDBar label="AGGREGATE DAILY DD"
          rightHint={`${fmtMoney(totalDdUsed)} of ${fmtMoney(totalDdLimit)}`}
          fillPct={aggregateDdPct} fillColor={ddColor(aggregateDdPct)} />
        {worstAcc && worstDdPct >= 0.3 && (
          <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: -2, marginBottom: 6 }}>
            ⚠ worst: {worstAcc.name} at {Math.round(worstDdPct * 100)}% of its daily limit
          </div>
        )}
        {aggregateTargetPct != null && (
          <DDBar label="AGGREGATE TARGET PROGRESS"
            rightHint={`${fmtMoney(totalTargetEarned)} of ${fmtMoney(totalTargetDollars)} · ${Math.round(aggregateTargetPct * 100)}%`}
            fillPct={aggregateTargetPct} fillColor="var(--blue)" />
        )}
      </div>
    </div>
  )
}

// ─── Main component with view toggle ─────────────────────────────────────────

const VIEW_STORAGE_KEY = 'elistas:account-tile-view'

export function AccountTiles({ accounts }: Props) {
  const active = accounts.filter((a) => a.isActive)
  const [view, setView] = useState<'per-account' | 'total'>('per-account')

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(VIEW_STORAGE_KEY) : null
    if (stored === 'total' || stored === 'per-account') setView(stored)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  if (active.length === 0) return null

  const totalEquity = active.reduce((s, a) => s + (a.currentEquity ?? a.currentBalance), 0)
  const totalTodayPnL = active.reduce((s, a) => s + a.stats.todayPnLDollars, 0)
  const todayPos = totalTodayPnL >= 0
  const hasClosedToday = active.some((a) => a.stats.closedToday > 0)

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
        <div className="section-label" style={{ margin: 0 }}>Accounts · {active.length} active</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            total <span className="font-mono" style={{ color: 'var(--text-1)' }}>{fmtMoney(totalEquity)}</span>
            {hasClosedToday && (
              <> · today <span className="font-mono" style={{ color: todayPos ? 'var(--green)' : 'var(--red)' }}>
                {todayPos ? '+' : ''}{fmtMoney(totalTodayPnL)}
              </span></>
            )}
          </div>
          {/* Total vs Per-account toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}>
            {([
              { v: 'total',       label: 'Total' },
              { v: 'per-account', label: 'Per account' },
            ] as const).map((o) => (
              <button key={o.v} onClick={() => setView(o.v)} style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 4,
                background: view === o.v ? 'var(--bg-elevated)' : 'transparent',
                color: view === o.v ? 'var(--text-1)' : 'var(--text-3)',
                border: 'none', cursor: 'pointer',
              }}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      {view === 'total' ? (
        <TotalTile accounts={active} />
      ) : (
        <div className="account-tile-grid">
          {active.map((acc) => <PerAccountTile key={acc.id} acc={acc} />)}
        </div>
      )}
    </div>
  )
}
