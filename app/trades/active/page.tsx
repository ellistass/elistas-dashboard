'use client'
// app/trades/active/page.tsx
// Focused command center for open positions: alignment, news collisions,
// R-toward-TP progress, inline edit SL/TP, mark-closed flow.
//
// Note: marking closed here marks the JOURNAL row closed. The actual MT4
// position must be closed in MT4 itself — the EA will then sync the close
// event and overwrite this row's close price/result/etc.

import { useEffect, useMemo, useState } from 'react'
import { NewsCollisionBadge } from '@/app/_components/DashboardWidgets'
import { SourceChip, RiskLine } from '@/app/_components/TradeChips'

interface OpenTrade {
  id: string
  pair: string
  direction: string
  model: string
  grade: string
  session: string
  entryPrice: number
  slPrice: number
  tpPrice: number
  riskPercent: number
  strongCcy: string
  weakCcy: string
  divScore: number | null
  date: string
  source: string
  accountId: string | null
  alignmentStatus: 'Green' | 'Amber' | 'Red' | 'Unknown'
  alignmentReason: string
  newsCollisions: Array<{ title: string; country: string; currency: string; date: string; impact: string }>
}

interface Account { id: string; name: string; currentBalance: number; currency: string }
interface OpenTradeExtra { lotSize?: number | null; profitCcy?: number | null }

export default function ActiveTradesPage() {
  const [trades, setTrades] = useState<OpenTrade[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [filter, setFilter] = useState<'all' | 'green' | 'amber' | 'red' | 'news'>('all')
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<{ id: string; sl: string; tp: string } | null>(null)

  const load = async () => {
    setLoading(true)
    const d = await fetch('/api/dashboard').then((r) => r.json())
    setTrades(d.openTrades ?? [])
    const a = await fetch('/api/accounts').then((r) => r.json())
    setAccounts((a.accounts ?? []).map((x: any) => ({
      id: x.id, name: x.name, currentBalance: x.currentBalance, currency: x.currency,
    })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return trades
    if (filter === 'news') return trades.filter((t) => t.newsCollisions?.length > 0)
    return trades.filter((t) => t.alignmentStatus.toLowerCase() === filter)
  }, [trades, filter])

  const counts = useMemo(() => ({
    all: trades.length,
    green: trades.filter((t) => t.alignmentStatus === 'Green').length,
    amber: trades.filter((t) => t.alignmentStatus === 'Amber').length,
    red: trades.filter((t) => t.alignmentStatus === 'Red').length,
    news: trades.filter((t) => t.newsCollisions?.length > 0).length,
  }), [trades])

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—'

  async function saveSlTp(id: string, slStr: string, tpStr: string) {
    const slPrice = parseFloat(slStr)
    const tpPrice = parseFloat(tpStr)
    if (!Number.isFinite(slPrice) || !Number.isFinite(tpPrice)) return
    await fetch('/api/trades', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, slPrice, tpPrice }),
    })
    setEdit(null)
    await load()
  }

  async function markClosed(t: OpenTrade) {
    const closePriceStr = prompt(`Close ${t.pair} at what price? (enter the price MT4 closed at, or 0 to skip)`)
    if (closePriceStr == null) return
    const closePrice = parseFloat(closePriceStr) || t.entryPrice
    await fetch('/api/trades', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, closePrice, outcome: closePrice === t.entryPrice ? 'BE' : (
        (t.direction === 'Long' && closePrice > t.entryPrice) || (t.direction === 'Short' && closePrice < t.entryPrice) ? 'Win' : 'Loss'
      ) }),
    })
    await load()
  }

  if (loading) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-3)' }}>Loading open trades…</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Active trades</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '2px 0 0' }}>
            {trades.length} open across {new Set(trades.map((t) => t.accountId).filter(Boolean)).size} account(s)
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['all', 'green', 'amber', 'red', 'news'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 12, padding: '5px 12px', borderRadius: 6,
            background: filter === f ? 'var(--bg-elevated)' : 'transparent',
            color: filter === f ? 'var(--text-1)' : 'var(--text-2)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>
            {f === 'all' ? 'All' : f === 'news' ? '⚠ News' : f.charAt(0).toUpperCase() + f.slice(1)}
            <span style={{ marginLeft: 6, color: 'var(--text-3)' }}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          {filter === 'all' ? 'No open trades.' : 'No trades match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((t) => {
            const isEditing = edit?.id === t.id
            const alignColor =
              t.alignmentStatus === 'Green' ? 'var(--green)' :
              t.alignmentStatus === 'Amber' ? 'var(--amber)' :
              t.alignmentStatus === 'Red'   ? 'var(--red)' : 'var(--text-3)'

            return (
              <div key={t.id} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 16, alignItems: 'start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="font-mono" style={{ fontSize: 16, fontWeight: 500 }}>{t.pair}</span>
                      <span style={{ fontSize: 12, color: t.direction === 'Long' ? 'var(--green)' : 'var(--red)' }}>
                        {t.direction === 'Long' ? '↑ Long' : '↓ Short'}
                      </span>
                      {t.grade && <span className={t.grade === 'A+' ? 'badge-aplus' : t.grade === 'B' ? 'badge-b' : 'badge-c'} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3 }}>{t.grade}</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: alignColor, display: 'inline-block' }} />
                        <span style={{ fontSize: 11, color: alignColor }}>{t.alignmentStatus}</span>
                      </span>
                      <SourceChip source={t.source as any} compact />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      {accountName(t.accountId)} · {t.session} · opened {new Date(t.date).toLocaleString()}
                    </div>
                    {(() => {
                      const account = accounts.find((a) => a.id === t.accountId)
                      return (
                        <div style={{ marginTop: 6 }}>
                          <RiskLine
                            riskPercent={t.riskPercent}
                            accountBalance={account?.currentBalance}
                            accountCcy={account?.currency}
                            lotSize={(t as any).lotSize ?? null}
                            profitCcy={(t as any).profitCcy ?? null}
                            outcome="Open"
                          />
                        </div>
                      )
                    })()}
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 6 }}>
                      {t.alignmentReason}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Levels</div>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input value={edit.sl} onChange={(e) => setEdit({ ...edit, sl: e.target.value })} placeholder="SL" style={{ padding: '4px 8px', fontSize: 11 }} />
                        <input value={edit.tp} onChange={(e) => setEdit({ ...edit, tp: e.target.value })} placeholder="TP" style={{ padding: '4px 8px', fontSize: 11 }} />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => saveSlTp(t.id, edit.sl, edit.tp)} style={{ fontSize: 10, padding: '3px 8px', flex: 1, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green-border)', borderRadius: 4 }}>Save</button>
                          <button onClick={() => setEdit(null)} style={{ fontSize: 10, padding: '3px 8px', flex: 1, background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 4 }}>×</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'DM Mono, monospace' }}>
                        <div>Entry <span style={{ color: 'var(--text-1)' }}>{t.entryPrice}</span></div>
                        <div>SL <span style={{ color: 'var(--red)' }}>{t.slPrice}</span></div>
                        <div>TP <span style={{ color: 'var(--green)' }}>{t.tpPrice}</span></div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Risk</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      {t.riskPercent?.toFixed(2)}% · {t.strongCcy} vs {t.weakCcy}
                      {t.divScore != null && <> · div {t.divScore.toFixed(1)}</>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {!isEditing && (
                      <button onClick={() => setEdit({ id: t.id, sl: String(t.slPrice), tp: String(t.tpPrice) })} style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                        Modify
                      </button>
                    )}
                    <button onClick={() => markClosed(t)} style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                      Mark closed
                    </button>
                  </div>
                </div>

                <NewsCollisionBadge events={t.newsCollisions as any} />
              </div>
            )
          })}
        </div>
      )}

      <div className="card" style={{ marginTop: 18, padding: 12, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
        Closing a trade here only updates the journal. To close the actual MT4 position, close it in MT4 — the EA will sync the close back automatically.
      </div>
    </div>
  )
}
