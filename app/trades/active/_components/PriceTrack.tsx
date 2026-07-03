'use client'
// app/trades/active/_components/PriceTrack.tsx
// The centerpiece of a position card: a horizontal risk→reward slider.
// Left edge = initial SL (risk side, −1R), right edge = TP (+rTarget R) —
// for Shorts too: we normalize by R, so "risk side" is always on the left.
// Markers: entry tick, optional moved-stop notch, glowing dot at the
// (P&L-derived) current price.

import { DerivedPosition, OpenTrade, fmtPrice, fmtSignedCcy, MONO } from './types'

interface Props {
  trade: OpenTrade
  d: DerivedPosition
  currency: string
}

export function PriceTrack({ trade: t, d, currency }: Props) {
  const winning = (d.openR ?? 0) >= 0
  const dotColor = winning ? 'var(--green)' : 'var(--red)'
  const dotGlow = winning ? 'rgba(35,224,160,0.55)' : 'rgba(255,84,112,0.55)'
  const pct = (p: number) => `${(p * 100).toFixed(1)}%`

  return (
    <div style={{ margin: '14px 0 4px' }}>
      {/* labels above the track */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: MONO, fontSize: 11, marginBottom: 8,
      }}>
        <span style={{ color: 'var(--red)' }}>Init SL {fmtPrice(d.initSl, t.pair)}</span>
        <span style={{ color: 'var(--text-body)' }}>
          now{' '}
          <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>
            {d.nowPrice != null ? fmtPrice(d.nowPrice, t.pair) : '—'}
          </span>
        </span>
        <span style={{ color: 'var(--green)' }}>TP {fmtPrice(t.tpPrice, t.pair)}</span>
      </div>

      {/* the track itself */}
      <div style={{ position: 'relative', height: 14 }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 5, height: 4, borderRadius: 999,
          background: 'linear-gradient(90deg, rgba(255,84,112,0.75), rgba(86,93,120,0.45) 45%, rgba(35,224,160,0.75))',
        }} />

        {/* entry tick */}
        <div title={`entry ${fmtPrice(t.entryPrice, t.pair)}`} style={{
          position: 'absolute', left: pct(d.entryPos), top: 1, width: 2, height: 12,
          marginLeft: -1, borderRadius: 1, background: 'var(--text-3)',
        }} />

        {/* moved-stop notch */}
        {d.stopPos != null && (
          <div title={`stop now ${fmtPrice(t.slPrice, t.pair)}`} style={{
            position: 'absolute', left: pct(d.stopPos), top: 2, width: 2, height: 10,
            marginLeft: -1, borderRadius: 1, background: 'var(--amber)',
          }} />
        )}

        {/* current-price dot */}
        <div style={{
          position: 'absolute', left: pct(d.nowPos), top: 2, width: 10, height: 10,
          marginLeft: -5, borderRadius: '50%',
          background: dotColor, border: '2px solid var(--bg-card)',
          boxShadow: `0 0 10px 2px ${dotGlow}`,
        }} />
      </div>

      {/* below the track: entry label left, live stats right */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: MONO, fontSize: 10.5, color: 'var(--text-3)', marginTop: 6, gap: 10, flexWrap: 'wrap',
      }}>
        <span>entry {fmtPrice(t.entryPrice, t.pair)}</span>
        <span style={{ textAlign: 'right' }}>
          {d.progressPct != null ? `${d.progressPct}% to target` : '— to target'}
          {t.lotSize != null && t.lotSize > 0 && <> · {t.lotSize.toFixed(2)} lots</>}
          {t.profitCcy != null && (
            <>
              {' · '}
              <span style={{ color: t.profitCcy >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtSignedCcy(t.profitCcy, currency)}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
