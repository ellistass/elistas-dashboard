"use client";
// app/_components/StrategyScoreboard.tsx
//
// Per-strategy hero cards used at the top of /analytics. Each card carries its
// strategy's visual identity (custom SVG showing the actual chart pattern) and
// the same metric layout: $ headline, win rate, best/worst, W/L bar, reliable
// R footnote.
//
// Trailing "+ Add a strategy" placeholder card invites future expansion —
// when you're ready to test another setup, add it to STRATEGIES in
// ./strategies.ts and it appears here automatically.

import React from "react";
import { STRATEGIES, StrategyDef } from "./strategies";

interface StrategyStats {
  wins: number; losses: number; be: number; count: number;
  totalR: number; totalPnL: number;
  reliableR: number; reliableCount: number;
  bestPnL: number; worstPnL: number;
}

interface Props {
  byModel: Record<string, StrategyStats>;
}

export function StrategyScoreboard({ byModel }: Props) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.max(2, STRATEGIES.length + 1)}, minmax(0, 1fr))`,
      gap: 10,
    }}>
      {STRATEGIES.map((s) => {
        const stats = byModel[s.code] ?? {
          wins: 0, losses: 0, be: 0, count: 0,
          totalR: 0, totalPnL: 0, reliableR: 0, reliableCount: 0,
          bestPnL: 0, worstPnL: 0,
        };
        return <StrategyCard key={s.code} def={s} stats={stats} />;
      })}
      <AddStrategyPlaceholder />
    </div>
  );
}

// ── Individual card ──────────────────────────────────────────────────────────

function StrategyCard({ def, stats }: { def: StrategyDef; stats: StrategyStats }) {
  const winRate = stats.wins + stats.losses > 0
    ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0;
  const avgPnL  = stats.count > 0 ? stats.totalPnL / stats.count : 0;
  const reliableAvgR = stats.reliableCount > 0 ? stats.reliableR / stats.reliableCount : 0;
  const pnlColor = stats.totalPnL > 0 ? def.accent
                 : stats.totalPnL < 0 ? 'var(--red)' : 'var(--text-2)';
  const dollar = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    })}`;

  return (
    <div className="card" style={{
      padding: 0, overflow: 'hidden',
      borderColor: def.accentBorder,
      backgroundImage: `linear-gradient(180deg, ${def.accentDim} 0%, transparent 60%)`,
    }}>
      {/* Visual — the strategy's signature chart pattern */}
      <PatternVisual kind={def.visualKind} accent={def.accent} />

      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            color: def.accent, padding: '2px 8px',
            background: def.accentDim, borderRadius: 4,
          }}>
            MODEL {def.code}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>{def.name}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 10px' }}>{def.subtitle}</p>

        {stats.count === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '14px 0 0' }}>
            No trades tagged with Model {def.code} yet.
          </p>
        ) : (
          <>
            <div className="font-mono" style={{
              fontSize: 26, fontWeight: 600, color: pnlColor,
              margin: '8px 0 2px', lineHeight: 1.1,
            }}>
              {dollar(stats.totalPnL)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
              {stats.count} {stats.count === 1 ? 'trade' : 'trades'} · avg {dollar(avgPnL)} / trade
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
              <ScoreStat label="Win rate" value={`${winRate.toFixed(1)}%`} />
              <ScoreStat label="Best"  value={dollar(stats.bestPnL)}  color={stats.bestPnL  > 0 ? def.accent : undefined} />
              <ScoreStat label="Worst" value={dollar(stats.worstPnL)} color={stats.worstPnL < 0 ? 'var(--red)' : undefined} />
            </div>

            <WinLossBar wins={stats.wins} losses={stats.losses} be={stats.be} accent={def.accent} />

            {stats.reliableCount > 0 ? (
              <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '10px 0 0', lineHeight: 1.4 }}>
                R: <span className="font-mono" style={{ color: 'var(--text-2)' }}>
                  {stats.reliableR >= 0 ? '+' : ''}{stats.reliableR.toFixed(2)}R
                </span>
                {' avg '}
                <span className="font-mono" style={{ color: 'var(--text-2)' }}>
                  {reliableAvgR >= 0 ? '+' : ''}{reliableAvgR.toFixed(2)}R
                </span>
                {' · '}{stats.reliableCount} reliable
              </p>
            ) : (
              <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '10px 0 0', fontStyle: 'italic' }}>
                R hidden — no trades with a verified initial SL yet.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Placeholder card for future strategies ───────────────────────────────────

function AddStrategyPlaceholder() {
  return (
    <div className="card" style={{
      padding: 16,
      borderStyle: 'dashed',
      borderColor: 'var(--border)',
      background: 'transparent',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', minHeight: 280,
    }}>
      <div style={{
        fontSize: 32, fontWeight: 300, color: 'var(--text-3)',
        width: 48, height: 48, borderRadius: '50%',
        border: '1px dashed var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10,
      }}>+</div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 4px', fontWeight: 500 }}>
        Add a strategy
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, lineHeight: 1.5, maxWidth: 200 }}>
        Edit <span className="font-mono">app/_components/strategies.ts</span> to add Model C, D, … with its own visual + color.
      </p>
    </div>
  );
}

// ── Pattern visuals ──────────────────────────────────────────────────────────
// Each one is a stylized chart showing the strategy's signature event.

function PatternVisual({ kind, accent }: { kind: StrategyDef['visualKind']; accent: string }) {
  return (
    <div style={{
      height: 90, background: 'var(--bg-elevated)',
      borderBottom: '1px solid var(--border-subtle)',
      position: 'relative', overflow: 'hidden',
    }}>
      {kind === 'wyckoff'      && <WyckoffSvg  accent={accent} />}
      {kind === 'liquidity-run' && <LiquiditySvg accent={accent} />}
      {kind === 'generic'      && <GenericSvg accent={accent} />}
    </div>
  );
}

// Wyckoff trap — composite showing both Spring (bottom reversal) and Upthrust
// (top reversal). Two horizontal levels mark support/resistance; price dips
// below support (Spring → long entry marker) and spikes above resistance
// (Upthrust → short entry marker), each followed by a reversal back into the
// range. Captures the symmetric nature of the trap pattern.
function WyckoffSvg({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 240 90" width="100%" height="100%" preserveAspectRatio="none">
      {/* Resistance line (top) */}
      <line x1="0" y1="22" x2="240" y2="22" stroke="var(--text-3)" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.5" />
      <text x="6" y="18" fontSize="7" fill="var(--text-3)" opacity="0.7">RESISTANCE</text>

      {/* Support line (bottom) */}
      <line x1="0" y1="68" x2="240" y2="68" stroke="var(--text-3)" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.5" />
      <text x="6" y="80" fontSize="7" fill="var(--text-3)" opacity="0.7">SUPPORT</text>

      {/* Price path: upthrust → drop → range → spring → rally */}
      <path
        d="M 10 60
           L 30 45
           L 50 25
           L 65 15
           L 75 28
           L 95 50
           L 115 60
           L 135 50
           L 155 65
           L 170 78
           L 180 70
           L 200 50
           L 220 32
           L 235 25"
        fill="none" stroke={accent} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
      />

      {/* Upthrust marker — top */}
      <circle cx="65" cy="15" r="3" fill={accent} />
      <text x="65" y="9" fontSize="7" fill={accent} textAnchor="middle" fontWeight="600">UPTHRUST</text>

      {/* Spring marker — bottom */}
      <circle cx="170" cy="78" r="3" fill={accent} />
      <text x="170" y="89" fontSize="7" fill={accent} textAnchor="middle" fontWeight="600">SPRING</text>
    </svg>
  );
}

// Liquidity run — multiple equal highs (or lows) build up resting stop
// orders, then a final spike sweeps the level to grab that liquidity, then
// the move reverses. Classic stop-hunt structure.
function LiquiditySvg({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 240 90" width="100%" height="100%" preserveAspectRatio="none">
      {/* Liquidity level (the equal highs) */}
      <line x1="0" y1="28" x2="240" y2="28" stroke="var(--text-3)" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.5" />
      <text x="6" y="24" fontSize="7" fill="var(--text-3)" opacity="0.7">EQUAL HIGHS · STOPS</text>

      {/* Price action: three rejections at the level, then the sweep, then reversal */}
      <path
        d="M 10 65
           L 25 32
           L 40 55
           L 60 32
           L 75 60
           L 95 30
           L 110 58
           L 125 30
           L 145 18
           L 160 32
           L 180 50
           L 200 65
           L 220 78
           L 235 80"
        fill="none" stroke={accent} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
      />

      {/* The sweep — where it grabs the stops */}
      <circle cx="145" cy="18" r="3.2" fill={accent} />
      <text x="145" y="12" fontSize="7" fill={accent} textAnchor="middle" fontWeight="600">SWEEP</text>

      {/* Reversal arrow */}
      <text x="200" y="82" fontSize="9" fill={accent} fontWeight="700">↘</text>
    </svg>
  );
}

// Generic — minimal up-and-to-the-right line, used for future strategies
// that haven't defined a custom visual.
function GenericSvg({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 240 90" width="100%" height="100%" preserveAspectRatio="none">
      <path
        d="M 10 70 L 60 60 L 110 55 L 160 35 L 220 20"
        fill="none" stroke={accent} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
      />
      <circle cx="220" cy="20" r="3" fill={accent} />
    </svg>
  );
}

// ── Small bits ───────────────────────────────────────────────────────────────

function ScoreStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p style={{ fontSize: 9, color: 'var(--text-3)', margin: 0, letterSpacing: '0.08em' }}>
        {label.toUpperCase()}
      </p>
      <p className="font-mono" style={{ fontSize: 13, fontWeight: 600, margin: '1px 0 0', color: color ?? 'var(--text-1)' }}>
        {value}
      </p>
    </div>
  );
}

function WinLossBar({ wins, losses, be, accent }: { wins: number; losses: number; be: number; accent: string }) {
  const total = wins + losses + be;
  if (total === 0) return null;
  const pct = (n: number) => (n / total) * 100;
  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-elevated)' }}>
        {wins   > 0 && <div style={{ width: `${pct(wins)}%`,   background: accent }} />}
        {be     > 0 && <div style={{ width: `${pct(be)}%`,     background: 'var(--text-3)', opacity: 0.4 }} />}
        {losses > 0 && <div style={{ width: `${pct(losses)}%`, background: 'var(--red)' }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
        <span><span style={{ color: accent }}>●</span> {wins}W</span>
        {be > 0 && <span><span style={{ opacity: 0.5 }}>●</span> {be}BE</span>}
        <span><span style={{ color: 'var(--red)' }}>●</span> {losses}L</span>
      </div>
    </div>
  );
}
