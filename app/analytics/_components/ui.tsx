'use client'
// app/analytics/_components/ui.tsx — shared primitives for the analytics screen.

import type { CSSProperties, ReactNode } from 'react'

export const MONO = "'DM Mono', monospace"

/** Signed number string: +2.4 / -1.0 */
export function signed(n: number, dp = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(dp)}`
}

/** "02 Jun" style short date. */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** DM Mono uppercase card section label with a leading Lucide icon. */
export function Kicker({ icon, children, style }: { icon?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontFamily: MONO, fontSize: 10, fontWeight: 500,
      letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--text-3)',
      ...style,
    }}>
      {icon}{children}
    </span>
  )
}

/** Primary section card — #0f1119, 14px radius, 17/18 padding. */
export function SectionCard({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <section className={className} style={{
      border: '1px solid var(--border)', borderRadius: 14,
      background: 'var(--bg-card)', padding: '17px 18px',
      ...style,
    }}>
      {children}
    </section>
  )
}

export const GRADE_META: Record<string, { c: string; bg: string; b: string }> = {
  'A+':   { c: '#23e0a0', bg: 'rgba(35,224,160,0.1)', b: 'rgba(35,224,160,0.28)' },
  'B':    { c: '#f6b73c', bg: 'rgba(246,183,60,0.1)', b: 'rgba(246,183,60,0.28)' },
  'C':    { c: '#8b93b0', bg: '#1e2130',              b: '#333850' },
  'Skip': { c: '#ff5470', bg: 'rgba(255,84,112,0.1)', b: 'rgba(255,84,112,0.28)' },
}

/** Small grade pill — DM Mono 12px, 6px radius. */
export function GradePill({ grade }: { grade: string }) {
  const m = GRADE_META[grade] ?? GRADE_META['C']
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 6,
      fontFamily: MONO, fontSize: 12, color: m.c, background: m.bg, border: `1px solid ${m.b}`,
    }}>
      {grade}
    </span>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>{text}</div>
}
