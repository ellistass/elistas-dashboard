'use client'
// app/_components/dashboard/Banners.tsx
// Contextual banner stack shown under the header: score status, market
// condition, session recommendation, divergence warnings, fetch errors.
// Pure presentation — same conditions as the pre-redesign page.

import { Zap } from 'lucide-react'
import type { ScoringResult } from './types'

interface Props {
  scoreStatus: { ok: boolean; msg: string } | null
  onDismissStatus: () => void
  scores?: ScoringResult | null
  warnings: string[]
  fetchErrors: string[]
  hasLiveData: boolean
  onOpenManual: () => void
}

export function DashBanners({
  scoreStatus, onDismissStatus, scores, warnings, fetchErrors, hasLiveData, onOpenManual,
}: Props) {
  return (
    <>
      {/* Score run status */}
      {scoreStatus && (
        <div className="font-mono" style={{
          marginBottom: 14, padding: '10px 16px', borderRadius: 10, fontSize: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: scoreStatus.ok ? 'var(--green-dim)' : 'var(--red-dim)',
          border: `1px solid ${scoreStatus.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
          color: scoreStatus.ok ? 'var(--green)' : 'var(--red)',
        }}>
          <span>{scoreStatus.ok ? '✓ ' : '✗ '}{scoreStatus.msg}</span>
          <button onClick={onDismissStatus}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.5, fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Market condition (thin / holiday-heavy) */}
      {scores?.marketCondition && scores.marketCondition !== 'Normal' && (
        <div style={{
          marginBottom: 14, padding: '12px 16px', borderRadius: 10,
          background: 'var(--red-dim)', border: '1px solid var(--red-border)', color: 'var(--red)',
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, margin: '0 0 4px' }}>
            ⚠ MARKET CONDITION — {scores.marketCondition.toUpperCase()}
          </p>
          {scores.sessionRecommendation && (
            <p style={{ fontSize: 11, margin: 0, opacity: 0.85, lineHeight: 1.5 }}>
              {scores.sessionRecommendation}
            </p>
          )}
        </div>
      )}

      {/* Session recommendation (normal days) */}
      {scores?.sessionRecommendation && (!scores.marketCondition || scores.marketCondition === 'Normal') && (
        <div style={{
          marginBottom: 14, padding: '10px 16px', borderRadius: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Zap size={13} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 11, color: 'var(--text-body)', margin: 0, lineHeight: 1.5 }}>
            {scores.sessionRecommendation}
          </p>
        </div>
      )}

      {/* Divergence warnings */}
      {warnings.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '12px 16px', borderRadius: 10,
          background: 'var(--amber-dim)', border: '1px solid var(--amber-border)', color: 'var(--amber)',
        }}>
          <p className="kicker" style={{ color: 'var(--amber)', marginBottom: 4 }}>⚠ Divergence warnings</p>
          {warnings.map((w, i) => (
            <p key={i} style={{ fontSize: 11, margin: '2px 0', opacity: 0.85 }}>→ {w}</p>
          ))}
        </div>
      )}

      {/* Fetch errors */}
      {fetchErrors.length > 0 && !hasLiveData && (
        <div style={{
          marginBottom: 14, padding: '10px 16px', borderRadius: 10,
          background: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
          color: 'var(--amber)', fontSize: 11,
        }}>
          <strong>Fetch warning:</strong> {fetchErrors.join(' · ')}
          <button onClick={onOpenManual}
            style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 11 }}>
            Enter data manually →
          </button>
        </div>
      )}
    </>
  )
}
