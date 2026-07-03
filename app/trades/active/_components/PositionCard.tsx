'use client'
// app/trades/active/_components/PositionCard.tsx
// One open position, v2 style: identity row + big OPEN R, price track,
// risk / stop tiles, alignment note, collapsible news-collision bar,
// and the Edit SL/TP + Mark closed actions (inline close-price popover
// replaces the old window.prompt).

import { useState } from 'react'
import {
  ArrowDownRight, ArrowLeftRight, ArrowUpRight, CheckCircle2, ChevronDown,
  HelpCircle, Info, Newspaper, Pencil, Shield, Sparkles, TriangleAlert, User, XCircle,
} from 'lucide-react'
import { PriceTrack } from './PriceTrack'
import {
  Account, DerivedPosition, OpenTrade,
  fmtCcy, fmtPrice, fmtR, timeUntil, MONO,
} from './types'

interface Props {
  trade: OpenTrade
  account: Account | undefined
  d: DerivedPosition
  selected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onMarkClosed: (closePrice: number) => Promise<void>
}

const ALIGN_META = {
  Green:   { label: 'Aligned', color: 'var(--green)', dim: 'var(--green-dim)', border: 'var(--green-border)', Icon: CheckCircle2 },
  Amber:   { label: 'Watch',   color: 'var(--amber)', dim: 'var(--amber-dim)', border: 'var(--amber-border)', Icon: TriangleAlert },
  Red:     { label: 'Against', color: 'var(--red)',   dim: 'var(--red-dim)',   border: 'var(--red-border)',   Icon: XCircle },
  Unknown: { label: 'Unknown', color: 'var(--text-3)', dim: 'var(--bg-elevated)', border: 'var(--border)',    Icon: HelpCircle },
} as const

function gradeClass(grade: string): string {
  if (grade === 'A+') return 'badge-aplus'
  if (grade === 'B') return 'badge-b'
  if (grade === 'Skip') return 'badge-skip'
  return 'badge-c'
}

export function PositionCard({ trade: t, account, d, selected, onToggleSelect, onEdit, onMarkClosed }: Props) {
  const [newsOpen, setNewsOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closePrice, setClosePrice] = useState('')
  const [busy, setBusy] = useState(false)

  const align = ALIGN_META[t.alignmentStatus] ?? ALIGN_META.Unknown
  const AlignIcon = align.Icon
  const currency = account?.currency ?? 'USD'
  const isLong = t.direction === 'Long'
  const rColor = d.openR == null ? 'var(--text-3)' : d.openR >= 0 ? 'var(--green)' : 'var(--red)'

  const borderColor =
    t.alignmentStatus === 'Red' ? 'rgba(255,84,112,0.3)' :
    t.alignmentStatus === 'Amber' ? 'rgba(246,183,60,0.3)' : 'var(--border)'

  const isSonnet = t.source === 'claude-idea'
  const isYou = t.source === 'user-discretionary'
  const sourceLabel = isSonnet ? 'Sonnet' : isYou ? 'You' : t.source === 'mt4' || t.source === 'mt4-catchup' ? 'MT4' : 'Manual'
  const sourceColor = isSonnet ? 'var(--purple)' : 'var(--text-2)'
  const sourceBg = isSonnet ? 'var(--purple-dim)' : 'var(--bg-elevated)'
  const sourceBorder = isSonnet ? 'var(--purple-border)' : 'var(--border)'

  // ── Stop-now status (tile b right side) ──
  let stopNote: { text: string; color: string }
  if (d.rStop == null || d.riskDollars == null) {
    stopNote = { text: '—', color: 'var(--text-3)' }
  } else if (!d.stopMoved) {
    stopNote = { text: `${fmtCcy(d.riskDollars, currency)} at risk · original`, color: 'var(--text-3)' }
  } else if (Math.abs(d.rStop) < 0.05) {
    stopNote = { text: '$0 at risk · breakeven', color: 'var(--green)' }
  } else if (d.rStop > 0) {
    stopNote = { text: `+${fmtCcy(d.riskDollars * d.rStop, currency)} locked`, color: 'var(--green)' }
  } else {
    stopNote = { text: `${fmtCcy(d.riskDollars * -d.rStop, currency)} at risk · reduced`, color: 'var(--text-2)' }
  }

  const riskedText = d.riskDollars != null
    ? `${fmtCcy(d.riskDollars, currency)} · 1.0R`
    : t.riskPercent ? `${t.riskPercent.toFixed(2)}% · 1.0R` : '—'

  const news = t.newsCollisions ?? []

  async function confirmClose() {
    const parsed = parseFloat(closePrice)
    const price = Number.isFinite(parsed) && parsed > 0 ? parsed : t.entryPrice
    setBusy(true)
    try { await onMarkClosed(price) } finally { setBusy(false); setClosing(false); setClosePrice('') }
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: `1px solid ${borderColor}`,
      borderRadius: 14, padding: '16px 18px',
    }}>
      {/* ── top row: identity + OPEN R ── */}
      <div className="apos-card-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${t.pair} ${t.direction}`}
          style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
        />
        {isLong
          ? <ArrowUpRight size={17} strokeWidth={2} color="var(--green)" style={{ flexShrink: 0 }} />
          : <ArrowDownRight size={17} strokeWidth={2} color="var(--red)" style={{ flexShrink: 0 }} />}
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{t.pair}</span>

        {t.grade && (
          <span className={gradeClass(t.grade)} style={{
            fontFamily: MONO, fontSize: 11, padding: '2px 8px', borderRadius: 999,
          }}>{t.grade}</span>
        )}

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 999,
          color: align.color, background: align.dim, border: `1px solid ${align.border}`,
        }}>
          <AlignIcon size={11} strokeWidth={2} />
          {align.label}
        </span>

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, padding: '3px 9px', borderRadius: 999,
          color: sourceColor, background: sourceBg, border: `1px solid ${sourceBorder}`,
        }}>
          {isSonnet ? <Sparkles size={11} strokeWidth={2} /> : <User size={11} strokeWidth={2} />}
          {sourceLabel}
        </span>

        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>
          {account?.name ?? '—'}
        </span>

        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="kicker">Open R</div>
          <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: rColor, lineHeight: 1.2 }}>
            {fmtR(d.openR)}
          </div>
        </div>
      </div>

      {/* ── price track ── */}
      <PriceTrack trade={t} d={d} currency={currency} />

      {/* ── inner tiles ── */}
      <div className="apos-tiles" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div style={{
          background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Shield size={15} strokeWidth={2} color="var(--text-3)" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="kicker">Risked at entry</div>
            <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, marginTop: 2 }}>{riskedText}</div>
          </div>
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10.5, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            init SL {fmtPrice(d.initSl, t.pair)}
          </span>
        </div>

        <div style={{
          background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <ArrowLeftRight size={15} strokeWidth={2} color="var(--text-3)" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="kicker">Stop now</div>
            <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, marginTop: 2 }}>{fmtPrice(t.slPrice, t.pair)}</div>
          </div>
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10.5, color: stopNote.color, whiteSpace: 'nowrap' }}>
            {stopNote.text}
          </span>
        </div>
      </div>

      {/* ── alignment note ── */}
      {t.alignmentReason && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          <Info size={13} strokeWidth={2} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{t.alignmentReason}</span>
        </div>
      )}

      {/* ── news collision bar ── */}
      {news.length > 0 && (
        <div style={{
          marginTop: 10, background: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
          borderRadius: 8, overflow: 'hidden',
        }}>
          <button
            onClick={() => setNewsOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 12px', background: 'transparent', border: 'none',
              color: 'var(--amber)', fontSize: 12, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Newspaper size={13} strokeWidth={2} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {news[0].currency} {news[0].title} {timeUntil(news[0].date)}
              {news.length > 1 && <span style={{ color: 'var(--text-2)' }}> · +{news.length - 1} more</span>}
            </span>
            <ChevronDown size={13} strokeWidth={2} style={{
              transition: 'transform 0.15s', transform: newsOpen ? 'rotate(180deg)' : 'none', flexShrink: 0,
            }} />
          </button>
          {newsOpen && (
            <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {news.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, color: 'var(--text-body)' }}>
                  <span style={{ fontFamily: MONO, color: 'var(--amber)', flexShrink: 0 }}>{e.currency}</span>
                  <span style={{ flex: 1 }}>{e.title}</span>
                  <span style={{ fontFamily: MONO, color: 'var(--text-3)', flexShrink: 0 }}>
                    {e.impact} · {timeUntil(e.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={onEdit} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
          background: 'transparent', color: 'var(--text-body)', border: '1px solid var(--border)',
        }}>
          <Pencil size={12} strokeWidth={2} /> Edit SL / TP
        </button>

        {!closing ? (
          <button onClick={() => { setClosing(true); setClosePrice('') }} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
            background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid var(--red-border)',
          }}>
            <XCircle size={12} strokeWidth={2} /> Mark closed
          </button>
        ) : (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 6px 4px 10px', borderRadius: 8,
            background: 'var(--bg-inset)', border: '1px solid var(--red-border)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Closed at</span>
            <input
              autoFocus
              value={closePrice}
              onChange={(e) => setClosePrice(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmClose(); if (e.key === 'Escape') setClosing(false) }}
              placeholder={fmtPrice(t.entryPrice, t.pair)}
              style={{ width: 96, padding: '4px 8px', fontSize: 12, borderRadius: 6 }}
            />
            <button onClick={confirmClose} disabled={busy} style={{
              fontSize: 11, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 500,
              background: 'var(--red)', color: '#2a040c', border: 'none', opacity: busy ? 0.6 : 1,
            }}>
              {busy ? '…' : 'Confirm'}
            </button>
            <button onClick={() => setClosing(false)} disabled={busy} style={{
              fontSize: 11, padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)',
            }}>
              ×
            </button>
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10.5, color: 'var(--text-3)' }}>
          {t.session} · opened {new Date(t.date).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </div>
    </div>
  )
}
