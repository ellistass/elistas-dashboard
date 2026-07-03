'use client'
// app/_components/dashboard/OpenPositions.tsx
// v2 "Open positions" section — one row-card per live trade with alignment
// pill, news-collision chip, ENTRY / NOW / OPEN R columns and a pencil that
// opens the existing EditTradeDrawer. Data = /api/dashboard openTrades +
// the per-account list (for risk-$ math and drawer context).
//
// NOTE: the dashboard API doesn't ship a live "current price" per open trade,
// so NOW shows the live P&L in account currency (from the MT4 EA's profitCcy)
// instead of a quote — the closest live number available. OPEN R is derived
// as profitCcy / (riskPercent% × balance) when both are present.

import { useState } from 'react'
import {
  ArrowUpRight, ArrowDownRight, Check, TriangleAlert, X, Pencil, Info,
} from 'lucide-react'
import { EditTradeDrawer, type EditableTrade } from '../EditTradeDrawer'
import { SourceChip } from '../TradeChips'

interface CalEvent { title: string; country: string; currency: string; date: string; impact: string }
export interface OpenTradeRow {
  id: string; pair: string; direction: string; model: string
  grade: string; session: string; entryPrice: number
  slPrice: number; tpPrice: number; strongCcy: string
  weakCcy: string; divScore?: number
  alignmentStatus: 'Green' | 'Amber' | 'Red' | 'Unknown'
  alignmentReason: string; date: string
  newsCollisions?: CalEvent[]
  source?: string; accountId?: string | null; riskPercent?: number
  lotSize?: number | null; profitCcy?: number | null
}
interface AccountLite {
  id: string; name: string; currency: string
  currentBalance: number; startingBalance?: number
}

function fmtR(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}R`
}
function fmtMoney(n: number, ccy = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(n)
}
function fmtCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  if (h === 0) return `${totalMin}m`
  return `${h}h ${totalMin % 60}m`
}

function openR(t: OpenTradeRow, acct?: AccountLite): number | null {
  if (t.profitCcy == null || !t.riskPercent || !acct?.currentBalance) return null
  const risk$ = (t.riskPercent / 100) * acct.currentBalance
  if (risk$ <= 0) return null
  return t.profitCcy / risk$
}

const ALIGN_META = {
  Green: { label: 'Aligned', Icon: Check, color: 'var(--green)', dim: 'var(--green-dim)', border: 'var(--green-border)' },
  Amber: { label: 'Watch', Icon: TriangleAlert, color: 'var(--amber)', dim: 'var(--amber-dim)', border: 'var(--amber-border)' },
  Red: { label: 'Against', Icon: X, color: 'var(--red)', dim: 'var(--red-dim)', border: 'var(--red-border)' },
  Unknown: { label: 'Unknown', Icon: Info, color: 'var(--text-3)', dim: 'var(--bg-elevated)', border: 'var(--border)' },
} as const

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'right', minWidth: 64 }}>
      <div className="kicker" style={{ fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 14, fontWeight: 500, color: color ?? 'var(--text-1)', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  )
}

export function OpenPositions({ trades, accounts, onChanged }: {
  trades: OpenTradeRow[]
  accounts: AccountLite[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<OpenTradeRow | null>(null)

  const rs = trades.map((t) => openR(t, accounts.find((a) => a.id === t.accountId)))
  const knownRs = rs.filter((r): r is number => r != null)
  const totalR = knownRs.length > 0 ? knownRs.reduce((a, b) => a + b, 0) : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="kicker">Open positions</span>
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {trades.length} live
            {totalR != null && (
              <> · <span style={{ color: totalR >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtR(totalR)} unrealized</span></>
            )}
          </span>
        </div>
        <a href="/journal" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>+ Add trade →</a>
      </div>

      {trades.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px 20px', borderStyle: 'dashed' }}>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px' }}>No open positions</p>
          <a href="/journal" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>Log a trade →</a>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {trades.map((t) => {
            const acct = accounts.find((a) => a.id === t.accountId)
            const meta = ALIGN_META[t.alignmentStatus] ?? ALIGN_META.Unknown
            const r = openR(t, acct)
            const long = t.direction !== 'Short'
            const DirIcon = long ? ArrowUpRight : ArrowDownRight
            const news = t.newsCollisions?.[0]
            const newsMs = news ? new Date(news.date).getTime() - Date.now() : 0
            const risk$ = t.riskPercent && acct ? Math.round((t.riskPercent / 100) * acct.currentBalance) : null
            const ccy = acct?.currency ?? 'USD'
            const borderColor = t.alignmentStatus === 'Green' ? 'var(--green-border)'
              : t.alignmentStatus === 'Amber' ? 'var(--amber-border)'
              : t.alignmentStatus === 'Red' ? 'var(--red-border)' : 'var(--border)'

            return (
              <div key={t.id} className="card" style={{ padding: '13px 16px', borderColor }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <DirIcon size={17} strokeWidth={2} style={{ color: long ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
                  <span className="font-mono" style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-1)' }}>{t.pair}</span>

                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 500, padding: '2px 9px', borderRadius: 999,
                    background: meta.dim, color: meta.color, border: `1px solid ${meta.border}`,
                  }}>
                    <meta.Icon size={10} strokeWidth={2} />
                    {meta.label}
                  </span>

                  {news && (
                    <span className="font-mono" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, padding: '2px 9px', borderRadius: 999,
                      background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber-border)',
                    }} title={`${news.currency} ${news.title}${(t.newsCollisions?.length ?? 0) > 1 ? ` (+${t.newsCollisions!.length - 1} more)` : ''}`}>
                      <TriangleAlert size={10} strokeWidth={2} />
                      {news.currency} in {fmtCountdown(newsMs)}
                    </span>
                  )}

                  {t.source && <SourceChip source={t.source} compact />}

                  {/* Right-aligned metric columns + edit */}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                    <Metric label="Entry" value={String(t.entryPrice)} />
                    <Metric
                      label="Now"
                      value={t.profitCcy != null ? `${t.profitCcy >= 0 ? '+' : ''}${fmtMoney(t.profitCcy, ccy)}` : '—'}
                      color={t.profitCcy != null ? (t.profitCcy >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-3)'}
                    />
                    <Metric
                      label="Open R"
                      value={fmtR(r)}
                      color={r == null ? 'var(--text-3)' : r >= 0 ? 'var(--green)' : 'var(--red)'}
                    />
                    <button
                      onClick={() => setEditing(t)}
                      title="Edit trade"
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: '1px solid var(--border)', background: 'var(--bg-card-2)',
                        color: 'var(--text-2)', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                      <Pencil size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {/* Sub-line: direction / model / session / risk detail */}
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: long ? 'var(--green)' : 'var(--red)' }}>{t.direction}</span>
                  {t.model && <span>Model {t.model}</span>}
                  {t.session && <span>{t.session}</span>}
                  {t.riskPercent != null && <span>{t.riskPercent.toFixed(2)}%{risk$ != null ? ` · ${fmtMoney(risk$, ccy)} risk` : ''}</span>}
                  {t.lotSize != null && t.lotSize > 0 && <span>{t.lotSize.toFixed(2)} lots</span>}
                  <span>SL {t.slPrice} → TP {t.tpPrice}</span>
                  {acct && <span>{acct.name}</span>}
                </div>

                {/* Alignment note */}
                {t.alignmentReason && (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    borderTop: '1px solid var(--border-faint)', marginTop: 10, paddingTop: 9,
                    fontSize: 11, lineHeight: 1.5,
                    color: t.alignmentStatus === 'Red' ? 'var(--red)' : t.alignmentStatus === 'Amber' ? 'var(--amber)' : 'var(--text-2)',
                  }}>
                    <Info size={12} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2, opacity: 0.8 }} />
                    <span>{t.alignmentReason}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <EditTradeDrawer
          trade={editing as unknown as EditableTrade}
          currency={accounts.find((a) => a.id === editing.accountId)?.currency ?? 'USD'}
          startingBalance={accounts.find((a) => a.id === editing.accountId)?.startingBalance}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); onChanged() }}
        />
      )}
    </div>
  )
}
