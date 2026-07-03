'use client'
// app/_components/dashboard/RightRail.tsx
// Right-rail cards for the v2 dashboard: ACCOUNTS · AGGREGATE and RECENT ALERTS.
// Accounts map from the /api/accounts list (same rows AccountTiles consumed);
// alerts map from /api/dashboard recentAlerts.

import Link from 'next/link'
import {
  BadgeCheck, Gem, Zap, XCircle, Archive, Wallet,
  ArrowUpRight, ArrowDownRight, BellRing,
} from 'lucide-react'

// ── Accounts · aggregate ──────────────────────────────────────────────────────

interface AccountRow {
  id: string
  name: string
  status: string
  currency: string
  currentBalance: number
  currentEquity?: number | null
  isActive: boolean
  stats?: { todayR: number; closedToday: number }
}

const STATUS_META: Record<string, { Icon: any; color: string; dim: string; border: string }> = {
  Funded: { Icon: BadgeCheck, color: 'var(--green)', dim: 'var(--green-dim)', border: 'var(--green-border)' },
  Live: { Icon: BadgeCheck, color: 'var(--green)', dim: 'var(--green-dim)', border: 'var(--green-border)' },
  Passed: { Icon: BadgeCheck, color: 'var(--green)', dim: 'var(--green-dim)', border: 'var(--green-border)' },
  Phase2: { Icon: Gem, color: 'var(--purple)', dim: 'var(--purple-dim)', border: 'var(--purple-border)' },
  Phase1: { Icon: Zap, color: 'var(--accent)', dim: 'var(--accent-dim)', border: 'var(--accent-border)' },
  Breached: { Icon: XCircle, color: 'var(--red)', dim: 'var(--red-dim)', border: 'var(--red-border)' },
  Failed: { Icon: XCircle, color: 'var(--red)', dim: 'var(--red-dim)', border: 'var(--red-border)' },
  Archived: { Icon: Archive, color: 'var(--text-3)', dim: 'var(--bg-elevated)', border: 'var(--border)' },
}

function fmtMoney(n: number, ccy = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(n)
}

export function AccountsAggregateCard({ accounts }: { accounts: AccountRow[] }) {
  const active = accounts.filter((a) => a.isActive)
  if (active.length === 0) return null

  const totalEquity = active.reduce((s, a) => s + (a.currentEquity ?? a.currentBalance), 0)
  const totalTodayR = active.reduce((s, a) => s + (a.stats?.todayR ?? 0), 0)
  const anyClosed = active.some((a) => (a.stats?.closedToday ?? 0) > 0)

  return (
    <div className="card" style={{ padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Wallet size={12} strokeWidth={2} />
          Accounts · Aggregate
        </span>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{active.length} active</span>
      </div>

      <Link href="/accounts" style={{ textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, cursor: 'pointer' }}>
          <span className="font-mono" style={{ fontSize: 26, fontWeight: 500, color: 'var(--text-1)' }}>
            {fmtMoney(totalEquity)}
          </span>
          <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>
            {anyClosed ? `${totalTodayR > 0 ? '+' : ''}${totalTodayR.toFixed(1)}R today` : '— today'}
          </span>
        </div>
      </Link>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {active.map((a) => {
          const meta = STATUS_META[a.status] ?? STATUS_META.Archived
          const r = a.stats?.todayR ?? 0
          const closed = (a.stats?.closedToday ?? 0) > 0
          return (
            <Link key={a.id} href="/accounts" style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 8,
                background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 9, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
                  padding: '1px 7px', borderRadius: 999, flexShrink: 0,
                  background: meta.dim, color: meta.color, border: `1px solid ${meta.border}`,
                }}>
                  <meta.Icon size={9} strokeWidth={2} />
                  {a.status}
                </span>
                <span style={{
                  fontSize: 11, color: 'var(--text-body)', minWidth: 0, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.name}
                </span>
                <span className="font-mono" style={{
                  fontSize: 11, fontWeight: 500, flexShrink: 0,
                  color: !closed ? 'var(--text-3)' : r >= 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {closed ? `${r > 0 ? '+' : ''}${r.toFixed(1)}R` : '—'}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ── Recent alerts ─────────────────────────────────────────────────────────────

interface RecentAlert {
  id: string
  date: string
  sentAt: string | null
  pair: string | null
  direction: string | null
  grade: string | null
}

export function RecentAlertsCard({ alerts }: { alerts?: RecentAlert[] }) {
  if (!alerts?.length) return null
  return (
    <div className="card" style={{ padding: '15px 17px' }}>
      <div className="kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <BellRing size={12} strokeWidth={2} />
        Recent alerts
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {alerts.map((a) => {
          const long = a.direction === 'Long'
          const short = a.direction === 'Short'
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
              {long && <ArrowUpRight size={13} strokeWidth={2} style={{ color: 'var(--green)', flexShrink: 0 }} />}
              {short && <ArrowDownRight size={13} strokeWidth={2} style={{ color: 'var(--red)', flexShrink: 0 }} />}
              {!long && !short && <span style={{ width: 13, flexShrink: 0 }} />}
              <span style={{ color: 'var(--text-body)', minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.pair ? (
                  <>
                    <span className="font-mono" style={{ color: 'var(--text-1)' }}>{a.pair}</span>
                    {a.grade ? <span style={{ color: 'var(--text-3)' }}> · {a.grade}</span> : null}
                  </>
                ) : '—'}
              </span>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
                {a.sentAt
                  ? new Date(a.sentAt).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
