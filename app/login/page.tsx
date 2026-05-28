'use client'

// app/login/page.tsx — single-user login.
// Background: slow-scrolling candlestick chart + live-looking currency ticker
// at the bottom. Both honor prefers-reduced-motion (see globals.css).
import { Suspense, useEffect, useMemo, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

// ── Time helpers ─────────────────────────────────────────────────────────────

function watTime(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function sessionLabel(): string {
  const h = parseInt(new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Lagos', hour: '2-digit', hour12: false,
  }), 10)
  if (h >= 1 && h < 7) return 'TOKYO'
  if (h >= 8 && h < 13) return 'LONDON'
  if (h >= 13 && h < 15) return 'PRE-NY'
  if (h >= 15 && h < 22) return 'NEW YORK'
  return 'CLOSED'
}

// ── Background chart generator ───────────────────────────────────────────────
// Deterministic pseudo-random walk so SSR and CSR match (no hydration warning).
// 90 candles, ~18px wide each = 1620px total. We render the strip twice end-to-end
// inside an overflow-hidden container, then translateX(-50%) to loop seamlessly.

function makeCandles(n: number, seed: number) {
  const rng = mulberry32(seed)
  const candles: Array<{ x: number; open: number; close: number; high: number; low: number }> = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const change = (rng() - 0.5) * 4               // ±2 per candle
    const open   = price
    const close  = price + change
    const wickUp = rng() * 1.5
    const wickDn = rng() * 1.5
    const high   = Math.max(open, close) + wickUp
    const low    = Math.min(open, close) - wickDn
    candles.push({ x: i * 18, open, close, high, low })
    price = close
  }
  return candles
}

// Tiny seedable RNG — keeps SSR/CSR output identical
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Ticker contents ──────────────────────────────────────────────────────────
// Plausible-looking pairs/prices. Not live (this is the login page) — just decor.

const TICKER_ROWS: Array<{ pair: string; price: string; change: number }> = [
  { pair: 'EUR/USD', price: '1.0846', change:  0.12 },
  { pair: 'GBP/USD', price: '1.2640', change:  0.08 },
  { pair: 'USD/JPY', price: '156.82', change: -0.34 },
  { pair: 'AUD/USD', price: '0.6512', change:  0.21 },
  { pair: 'NZD/USD', price: '0.5934', change: -0.09 },
  { pair: 'USD/CAD', price: '1.3725', change:  0.04 },
  { pair: 'USD/CHF', price: '0.8945', change: -0.18 },
  { pair: 'EUR/GBP', price: '0.8580', change:  0.03 },
  { pair: 'GBP/JPY', price: '198.21', change: -0.42 },
  { pair: 'XAU/USD', price: '2,654.30', change: 0.65 },
  { pair: 'DXY',     price: '105.42', change:  0.18 },
  { pair: 'VIX',     price: '16.84',  change: -1.24 },
  { pair: 'BTC/USD', price: '68,420', change:  0.91 },
]

// ── Component ────────────────────────────────────────────────────────────────

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [clock, setClock] = useState(watTime())

  useEffect(() => {
    const t = setInterval(() => setClock(watTime()), 1000)
    return () => clearInterval(t)
  }, [])

  // Candle data is computed once and reused — never re-rendered
  const candles = useMemo(() => makeCandles(90, 9438201), [])
  const yMin = Math.min(...candles.map((c) => c.low))
  const yMax = Math.max(...candles.map((c) => c.high))
  const yScale = (v: number) => 280 - ((v - yMin) / (yMax - yMin)) * 240 - 20

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await signIn('credentials', { email, password, redirect: false, callbackUrl })
    setLoading(false)
    if (!res || res.error) { setError('Wrong email or password.'); return }
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-base)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>

      {/* ── LAYER 1: candlestick chart drifting across the background ── */}
      <div style={{
        position: 'absolute', inset: 0,
        overflow: 'hidden',
        opacity: 0.18,
        maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
        pointerEvents: 'none',
      }}>
        <div className="chart-drift" style={{ display: 'flex', width: 'max-content', height: '100%' }}>
          {[0, 1].map((dup) => (
            <svg key={dup} viewBox={`0 0 ${90 * 18} 300`} width={90 * 18} height={300}
                 style={{ height: '60vh', display: 'block', alignSelf: 'center' }}
                 preserveAspectRatio="none">
              {candles.map((c, i) => {
                const up = c.close >= c.open
                const color = up ? 'var(--green)' : 'var(--red)'
                const bodyTop = Math.min(yScale(c.open), yScale(c.close))
                const bodyH = Math.max(1, Math.abs(yScale(c.open) - yScale(c.close)))
                return (
                  <g key={`${dup}-${i}`} transform={`translate(${c.x}, 0)`}>
                    <line x1={9} y1={yScale(c.high)} x2={9} y2={yScale(c.low)}
                          stroke={color} strokeWidth={1} />
                    <rect x={2} y={bodyTop} width={14} height={bodyH} fill={color} />
                  </g>
                )
              })}
            </svg>
          ))}
        </div>
      </div>

      {/* ── LAYER 2: glow + grid texture (existing) ── */}
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600,
        background: 'radial-gradient(circle, rgba(0,212,138,0.10) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', right: '-10%',
        width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
        maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)',
      }} />

      {/* ── LAYER 3: the card ── */}
      <div style={{
        position: 'relative', zIndex: 2,
        width: 380, padding: '32px 36px',
        background: 'rgba(15,15,24,0.78)',
        border: '1px solid var(--border)', borderRadius: 16,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span className="pulse-dot" style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--green)', display: 'inline-block',
            boxShadow: '0 0 10px rgba(0,212,138,0.6)',
          }} />
          <span style={{
            fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500,
            letterSpacing: '0.18em', color: 'var(--text-1)',
          }}>ELISTAS</span>
          <span style={{ color: 'var(--border)', margin: '0 2px' }}>|</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Trading System</span>
        </div>

        <h1 style={{
          fontSize: 22, fontWeight: 500, color: 'var(--text-1)',
          margin: '20px 0 4px', letterSpacing: '-0.01em',
        }}>Welcome back</h1>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 24px' }}>
          Sign in to your trading desk
        </p>

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', marginBottom: 14 }}>
            <span style={{
              display: 'block', fontSize: 10, color: 'var(--text-3)',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: 6, fontWeight: 500,
            }}>Email</span>
            <input
              type="email" required autoFocus autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="login-input"
              placeholder="you@example.com"
              style={{ width: '100%', padding: '10px 12px', fontSize: 13 }}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 6 }}>
            <span style={{
              display: 'block', fontSize: 10, color: 'var(--text-3)',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: 6, fontWeight: 500,
            }}>Password</span>
            <input
              type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="login-input"
              style={{ width: '100%', padding: '10px 12px', fontSize: 13 }}
            />
          </label>

          <div style={{ minHeight: 28, marginTop: 10, marginBottom: 10 }}>
            {error && (
              <div style={{
                fontSize: 11, padding: '6px 10px', borderRadius: 6,
                background: 'var(--red-dim)', color: 'var(--red)',
                border: '1px solid var(--red-border)',
              }}>{error}</div>
            )}
          </div>

          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 10, border: 'none',
              background: loading ? 'var(--bg-elevated)' : 'var(--green)',
              color: loading ? 'var(--text-3)' : '#001a14',
              fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
              cursor: loading ? 'default' : 'pointer',
              transition: 'opacity 0.15s, transform 0.05s',
            }}
            onMouseDown={(e) => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)' }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <div style={{
          marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between',
          fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--text-3)',
          letterSpacing: '0.08em',
        }}>
          <span>LAGOS · {clock} WAT</span>
          <span style={{ color: sessionLabel() === 'CLOSED' ? 'var(--text-3)' : 'var(--green)' }}>
            {sessionLabel()}
          </span>
        </div>
      </div>

      {/* ── LAYER 4: live-style ticker tape pinned to the bottom ── */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: 32,
        background: 'rgba(9,9,15,0.85)',
        borderTop: '1px solid var(--border)',
        overflow: 'hidden',
        zIndex: 3,
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}>
        <div className="ticker-scroll" style={{
          height: '100%', alignItems: 'center',
          fontFamily: 'DM Mono, monospace', fontSize: 11,
        }}>
          {[0, 1].map((dup) => (
            <div key={dup} style={{ display: 'inline-flex', alignItems: 'center', gap: 24, padding: '0 24px' }}>
              {TICKER_ROWS.map((row, i) => {
                const up = row.change >= 0
                return (
                  <span key={`${dup}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--text-2)' }}>{row.pair}</span>
                    <span className="price-flicker" style={{ color: 'var(--text-1)' }}>{row.price}</span>
                    <span style={{ color: up ? 'var(--green)' : 'var(--red)' }}>
                      {up ? '▲' : '▼'} {Math.abs(row.change).toFixed(2)}
                    </span>
                    <span style={{ color: 'var(--text-3)', margin: '0 4px' }}>·</span>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}
