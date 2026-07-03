'use client'
// app/_components/dashboard/StatusRow.tsx
// v2 status row — four tiles: DAILY R BUDGET · NEXT HIGH-IMPACT · DXY · VIX.
// All data comes from /api/dashboard (dailyR / nextEvent / macros); each tile
// renders a graceful "—" when its slice is missing.

import { useEffect, useState } from 'react'
import { ShieldCheck, TriangleAlert, OctagonX, TrendingUp, TrendingDown } from 'lucide-react'

interface DailyRStatus {
  todayR: number
  cutoffR: number
  pctOfCutoff: number
  state: 'safe' | 'caution' | 'stop'
  closedToday: number
}
interface CalEvent { title: string; country: string; currency: string; date: string; impact: string }
interface MacroTile { symbol: string; name: string; latest: number; percentChange: number }

interface Props {
  dailyR?: DailyRStatus
  nextEvent?: CalEvent | null
  macros?: MacroTile[]
  regime?: string // "risk-on" | "risk-off" | "mixed" | ""
}

function fmtCountdown(ms: number): string {
  if (ms < 0) return 'now'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}
function fmtSigned(n: number, digits = 1): string {
  return (n > 0 ? '+' : '') + n.toFixed(digits)
}

const kicker: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
  textTransform: 'uppercase', letterSpacing: '0.13em', color: 'var(--text-3)',
}

function Tile({ children, tint, style }: {
  children: React.ReactNode
  tint?: 'green' | 'red' | 'amber'
  style?: React.CSSProperties
}) {
  const border = tint === 'green' ? 'var(--green-border)'
    : tint === 'red' ? 'var(--red-border)'
    : tint === 'amber' ? 'var(--amber-border)'
    : 'var(--border)'
  const bg = tint === 'green' ? 'rgba(35,224,160,0.05)'
    : tint === 'red' ? 'rgba(255,84,112,0.06)'
    : tint === 'amber' ? 'rgba(246,183,60,0.05)'
    : 'var(--bg-card-raised)'
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: bg, border: `1px solid ${border}`,
      borderRadius: 12, padding: '13px 15px', minWidth: 0, ...style,
    }}>
      {children}
    </div>
  )
}

export function StatusRow({ dailyR, nextEvent, macros, regime }: Props) {
  // 30s countdown tick for the event tile
  const [now, setNow] = useState<number>(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(i)
  }, [])

  // ── Tile 1: Daily R budget ──
  const state = dailyR?.state ?? 'safe'
  const danger = state === 'stop'
  const caution = state === 'caution'
  const rColor = danger ? 'var(--red)' : caution ? 'var(--amber)' : 'var(--green)'
  const StateIcon = danger ? OctagonX : caution ? TriangleAlert : ShieldCheck
  const stateLabel = danger ? 'Stop' : caution ? 'Caution' : 'Safe'
  const fillPct = Math.max(0, Math.min(1, dailyR?.pctOfCutoff ?? 0)) * 100

  // ── Tiles 3/4: DXY + VIX from macros ──
  const dxy = macros?.find((m) => /DXY/i.test(m.symbol) || /dollar/i.test(m.name)) ?? macros?.[0]
  const vix = macros?.find((m) => /VIX/i.test(m.symbol) || /vix|volatil/i.test(m.name))
    ?? (macros && macros.length > 1 ? macros[1] : undefined)
  const regimeLabel = regime === 'risk-on' ? 'Risk-on' : regime === 'risk-off' ? 'Risk-off' : regime === 'mixed' ? 'Mixed' : null

  // Next event pieces
  const evTime = nextEvent ? new Date(nextEvent.date) : null
  const remaining = evTime ? evTime.getTime() - now : 0

  return (
    <div className="dash-status">
      {/* 1 · DAILY R BUDGET */}
      <Tile tint={danger ? 'red' : caution ? 'amber' : 'green'}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <span style={kicker}>Daily R budget</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 999,
            background: danger ? 'var(--red-dim)' : caution ? 'var(--amber-dim)' : 'var(--green-dim)',
            color: rColor, border: `1px solid ${danger ? 'var(--red-border)' : caution ? 'var(--amber-border)' : 'var(--green-border)'}`,
          }}>
            <StateIcon size={11} strokeWidth={2} />
            {stateLabel}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: dailyR ? rColor : 'var(--text-3)' }}>
            {dailyR ? `${fmtSigned(dailyR.todayR, 1)}R` : '—'}
          </span>
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {dailyR ? `/ ${dailyR.cutoffR.toFixed(1)}R cutoff` : 'no closed trades'}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
          {dailyR ? (danger ? 'STOP — no new entries today' : `${dailyR.closedToday} closed today`) : 'nothing closed yet'}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'var(--bg-inset)' }}>
          <div style={{ width: `${fillPct}%`, height: '100%', background: rColor, transition: 'width 0.3s' }} />
        </div>
      </Tile>

      {/* 2 · NEXT HIGH-IMPACT */}
      <Tile>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <span style={kicker}>Next high-impact</span>
          {nextEvent && (
            <span className="font-mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--amber)' }}>
              {fmtCountdown(remaining)}
            </span>
          )}
        </div>
        {nextEvent ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span className="font-mono" style={{ color: 'var(--amber)', fontWeight: 500 }}>{nextEvent.currency}</span>
              <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · </span>
              {nextEvent.title}
            </div>
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              {evTime?.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·')} WAT
            </div>
          </>
        ) : (
          <>
            <div className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-3)' }}>—</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>no upcoming events</div>
          </>
        )}
      </Tile>

      {/* 3 · DXY */}
      <Tile>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <span style={kicker}>DXY</span>
          {dxy && (
            <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color: dxy.percentChange >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fmtSigned(dxy.percentChange, 2)}%
            </span>
          )}
        </div>
        <div className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: dxy ? 'var(--text-1)' : 'var(--text-3)' }}>
          {dxy ? dxy.latest.toFixed(2) : '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>
          {dxy ? (
            <>
              {dxy.percentChange >= 0
                ? <TrendingUp size={12} strokeWidth={2} style={{ color: 'var(--green)' }} />
                : <TrendingDown size={12} strokeWidth={2} style={{ color: 'var(--red)' }} />}
              {dxy.percentChange >= 0 ? 'Dollar bid' : 'Dollar offered'}
            </>
          ) : <span style={{ color: 'var(--text-3)' }}>no data</span>}
        </div>
      </Tile>

      {/* 4 · VIX · RISK */}
      <Tile>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <span style={kicker}>VIX · Risk</span>
          {vix && (
            <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color: vix.percentChange <= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fmtSigned(vix.percentChange, 2)}%
            </span>
          )}
        </div>
        <div className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: vix ? 'var(--text-1)' : 'var(--text-3)' }}>
          {vix ? vix.latest.toFixed(2) : '—'}
        </div>
        <div style={{ fontSize: 11, marginTop: 3, color: regimeLabel === 'Risk-on' ? 'var(--green)' : regimeLabel === 'Risk-off' ? 'var(--red)' : 'var(--text-2)' }}>
          {regimeLabel ?? (vix ? (vix.latest < 16 ? 'Risk-on' : vix.latest > 22 ? 'Risk-off' : 'Mixed') : <span style={{ color: 'var(--text-3)' }}>no data</span>)}
        </div>
      </Tile>
    </div>
  )
}
