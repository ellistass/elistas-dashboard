'use client'
// app/trades/active/page.tsx — Active positions (v2 redesign).
// Command center for open positions: alignment vs today's thesis, news
// collisions, risk→TP price tracks, edit SL/TP (shared drawer), mark closed.
//
// Data contract unchanged: GET /api/dashboard (openTrades) + GET /api/accounts;
// actions via PATCH /api/trades. Marking closed here marks the JOURNAL row
// closed — the actual MT4 position must be closed in MT4; the EA syncs the
// real close back and overwrites this row.
//
// The page re-fetches every 60s so floating P&L / open R stay near-live
// (the old page fetched once on mount).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2, Crosshair, Newspaper, TriangleAlert, XCircle,
} from 'lucide-react'
import { EditTradeDrawer } from '@/app/_components/EditTradeDrawer'
import { KpiRow } from './_components/KpiRow'
import { PositionCard } from './_components/PositionCard'
import { Account, OpenTrade, derivePosition, MONO } from './_components/types'

type Filter = 'all' | 'green' | 'amber' | 'red' | 'news'
type Sort = 'risk' | 'r' | 'pair'

const REFRESH_MS = 60_000

export default function ActivePositionsPage() {
  const [trades, setTrades] = useState<OpenTrade[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('risk')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<OpenTrade | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load(showSpinner = false) {
    if (showSpinner) setLoading(true)
    try {
      const [d, a] = await Promise.all([
        fetch('/api/dashboard').then((r) => r.json()),
        fetch('/api/accounts').then((r) => r.json()),
      ])
      setTrades(d.openTrades ?? [])
      setAccounts((a.accounts ?? []).map((x: any) => ({
        id: x.id, name: x.name, currentBalance: x.currentBalance,
        startingBalance: x.startingBalance, currency: x.currency,
      })))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(true)
    timer.current = setInterval(() => load(false), REFRESH_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])

  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const derived = useMemo(
    () => new Map(trades.map((t) => [t.id, derivePosition(t, t.accountId ? acctById.get(t.accountId) : undefined)])),
    [trades, acctById],
  )

  const counts = useMemo(() => ({
    all: trades.length,
    green: trades.filter((t) => t.alignmentStatus === 'Green').length,
    amber: trades.filter((t) => t.alignmentStatus === 'Amber').length,
    red: trades.filter((t) => t.alignmentStatus === 'Red').length,
    news: trades.filter((t) => t.newsCollisions?.length > 0).length,
  }), [trades])

  const unrealized = useMemo(() => {
    const rs = trades.map((t) => derived.get(t.id)?.openR).filter((r): r is number => r != null)
    return {
      sum: rs.length ? Number(rs.reduce((s, r) => s + r, 0).toFixed(1)) : null,
      coverage: rs.length,
    }
  }, [trades, derived])

  const visible = useMemo(() => {
    let list = trades
    if (filter === 'news') list = list.filter((t) => t.newsCollisions?.length > 0)
    else if (filter !== 'all') list = list.filter((t) => t.alignmentStatus.toLowerCase() === filter)
    const d = (id: string) => derived.get(id)
    return [...list].sort((a, b) => {
      if (sort === 'pair') return a.pair.localeCompare(b.pair)
      if (sort === 'r') return (d(b.id)?.openR ?? -Infinity) - (d(a.id)?.openR ?? -Infinity)
      return (d(b.id)?.riskDollars ?? -1) - (d(a.id)?.riskDollars ?? -1)
    })
  }, [trades, filter, sort, derived])

  const accountCount = new Set(trades.map((t) => t.accountId).filter(Boolean)).size

  async function saveMarkClosed(t: OpenTrade, closePrice: number) {
    const outcome = closePrice === t.entryPrice ? 'BE' : (
      (t.direction === 'Long' && closePrice > t.entryPrice) ||
      (t.direction === 'Short' && closePrice < t.entryPrice) ? 'Win' : 'Loss'
    )
    await fetch('/api/trades', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, closePrice, outcome }),
    })
    setSelected((prev) => { const n = new Set(prev); n.delete(t.id); return n })
    await load(false)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const chips: Array<{ key: Filter; label: string; count: number; color: string; Icon: any }> = [
    { key: 'all', label: 'All', count: counts.all, color: 'var(--accent)', Icon: null },
    { key: 'green', label: 'Aligned', count: counts.green, color: 'var(--green)', Icon: CheckCircle2 },
    { key: 'amber', label: 'Watch', count: counts.amber, color: 'var(--amber)', Icon: TriangleAlert },
    { key: 'red', label: 'Against', count: counts.red, color: 'var(--red)', Icon: XCircle },
    { key: 'news', label: 'News', count: counts.news, color: 'var(--amber)', Icon: Newspaper },
  ]

  if (loading) {
    return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading open positions…</div>
  }

  const editingAcct = editing?.accountId ? acctById.get(editing.accountId) : undefined

  return (
    <div>
      <style>{`
        .apos-kpis { }
        @media (max-width: 900px) {
          .apos-kpis { grid-template-columns: repeat(2, 1fr) !important; }
          .apos-tiles { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Active positions</h1>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: MONO, fontSize: 10.5, padding: '3px 10px', borderRadius: 999,
              color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
            }}>
              <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              live
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 0' }}>
            {trades.length} open across {accountCount} account{accountCount === 1 ? '' : 's'} · refreshes every 60s
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="kicker">Sort</span>
          <div className="seg">
            {([['risk', 'Risk'], ['r', 'R'], ['pair', 'Pair']] as Array<[Sort, string]>).map(([k, label]) => (
              <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <KpiRow
        openCount={trades.length}
        unrealizedR={unrealized.sum}
        unrealizedCoverage={unrealized.coverage}
        againstCount={counts.red}
        newsCount={counts.news}
      />

      {/* ── filter chips ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {chips.map(({ key, label, count, color, Icon }) => {
          const on = filter === key
          const filledAll = on && key === 'all'
          return (
            <button key={key} onClick={() => setFilter(key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: on ? 500 : 400, padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
              background: filledAll ? 'var(--accent)' : on ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
              color: filledAll ? 'var(--accent-on)' : on ? color : 'var(--text-2)',
              border: `1px solid ${on ? (filledAll ? 'var(--accent)' : color) : 'var(--border)'}`,
            }}>
              {Icon && <Icon size={12} strokeWidth={2} />}
              {label}
              <span style={{ fontFamily: MONO, fontSize: 11, opacity: filledAll ? 0.85 : 0.7 }}>{count}</span>
            </button>
          )
        })}

        {selected.size > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto',
            fontSize: 12, color: 'var(--text-2)',
          }}>
            <span style={{ fontFamily: MONO }}>{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
              background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)',
            }}>
              Clear
            </button>
          </span>
        )}
      </div>

      {/* ── position list ── */}
      {visible.length === 0 ? (
        <div className="card" style={{ padding: '56px 20px', textAlign: 'center' }}>
          <Crosshair size={26} strokeWidth={2} color="var(--text-3)" style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>
            {filter === 'all' ? 'No open positions' : 'No positions match this filter'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
            {filter === 'all'
              ? 'Take an idea from the dashboard or open a trade in MT4 — the EA syncs it here.'
              : 'Switch filters to see the rest of the book.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((t) => (
            <PositionCard
              key={t.id}
              trade={t}
              account={t.accountId ? acctById.get(t.accountId) : undefined}
              d={derived.get(t.id)!}
              selected={selected.has(t.id)}
              onToggleSelect={() => toggleSelect(t.id)}
              onEdit={() => setEditing(t)}
              onMarkClosed={(price) => saveMarkClosed(t, price)}
            />
          ))}
        </div>
      )}

      <p style={{ marginTop: 18, fontSize: 11, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
        Closing a trade here only updates the journal. To close the actual MT4 position, close it in MT4 —
        the EA syncs the close back automatically.
      </p>

      {/* ── shared edit drawer (SL / TP / initial SL / risk $) ── */}
      {editing && (
        <EditTradeDrawer
          trade={{
            id: editing.id,
            pair: editing.pair,
            direction: editing.direction,
            entryPrice: editing.entryPrice,
            slPrice: editing.slPrice,
            initialSlPrice: editing.initialSlPrice,
            riskPercent: editing.riskPercent,
            riskAmount: editing.riskAmount,
            tpPrice: editing.tpPrice,
            profitCcy: editing.profitCcy,
            outcome: 'Open',
            date: editing.date,
            model: editing.model,
            grade: editing.grade,
          }}
          currency={editingAcct?.currency}
          startingBalance={editingAcct?.startingBalance}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(false) }}
        />
      )}
    </div>
  )
}
