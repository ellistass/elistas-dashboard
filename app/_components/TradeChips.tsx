'use client'
// app/_components/TradeChips.tsx
// Small visual primitives for trade cards: source provenance chip + risk
// dollar/lot formatting. Used by the dashboard open-trades section, the
// Active Trades page, and the journal.

export type TradeSource = 'manual' | 'mt4' | 'mt4-catchup' | 'claude-idea' | 'user-discretionary' | string

interface SourceMeta {
  label: string
  color: string
  bg: string
  border: string
  short?: string
}

const SOURCE_META: Record<string, SourceMeta> = {
  'claude-idea':        { label: 'Claude',   color: 'var(--green)', bg: 'var(--green-dim)', border: 'var(--green-border)' },
  'user-discretionary': { label: 'Your call',color: 'var(--blue)',  bg: 'var(--blue-dim)',  border: 'var(--blue-border)' },
  'mt4':                { label: 'MT4 EA',   color: 'var(--text-2)',bg: 'var(--bg-elevated)', border: 'var(--border)' },
  'mt4-catchup':        { label: 'MT4 (offline)', short: 'MT4·BACK', color: 'var(--text-3)', bg: 'var(--bg-elevated)', border: 'var(--border)' },
  'manual':             { label: 'Manual',   color: 'var(--text-3)',bg: 'var(--bg-elevated)', border: 'var(--border)' },
  'idea':               { label: 'Idea',     color: 'var(--blue)',  bg: 'var(--blue-dim)',  border: 'var(--blue-border)' },
}

export function SourceChip({ source, compact }: { source: TradeSource; compact?: boolean }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.manual
  return (
    <span style={{
      fontSize: compact ? 9 : 10,
      letterSpacing: '0.06em',
      fontWeight: 500,
      padding: compact ? '1px 5px' : '1px 6px',
      borderRadius: 3,
      background: meta.bg,
      color: meta.color,
      border: `1px solid ${meta.border}`,
      whiteSpace: 'nowrap',
    }} title={`Source: ${meta.label}`}>
      {compact ? (meta.short ?? meta.label.toUpperCase()) : meta.label.toUpperCase()}
    </span>
  )
}

/** Compute the dollar amount at risk for a trade given its account balance. */
export function riskDollars(riskPercent?: number | null, accountBalance?: number | null): number | null {
  if (!riskPercent || !accountBalance) return null
  return Math.round((riskPercent / 100) * accountBalance)
}

interface RiskLineProps {
  riskPercent?: number | null
  accountBalance?: number | null
  accountCcy?: string
  lotSize?: number | null
  profitCcy?: number | null
  outcome?: string | null
}

/**
 * Compact one-liner: "0.5% · $510 risk · 0.05 lots · +$23"
 * Use as the second/third row on a trade card.
 */
export function RiskLine(props: RiskLineProps) {
  const { riskPercent, accountBalance, accountCcy = 'USD', lotSize, profitCcy, outcome } = props
  const risk$ = riskDollars(riskPercent, accountBalance)
  const fmt = (n: number) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: accountCcy, maximumFractionDigits: 0,
  }).format(n)
  const isOpen = outcome === 'Open' || outcome == null
  const pnlPos = (profitCcy ?? 0) >= 0
  return (
    <span style={{
      display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
      fontSize: 11, color: 'var(--text-3)', fontFamily: 'DM Mono, monospace',
    }}>
      {riskPercent != null && (
        <span style={{ color: 'var(--text-2)' }}>{riskPercent.toFixed(2)}%</span>
      )}
      {risk$ != null && (
        <>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span style={{ color: 'var(--text-2)' }}>{fmt(risk$)} risk</span>
        </>
      )}
      {lotSize != null && lotSize > 0 && (
        <>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span style={{ color: 'var(--text-2)' }}>{lotSize.toFixed(2)} lots</span>
        </>
      )}
      {profitCcy != null && profitCcy !== 0 && (
        <>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span style={{ color: pnlPos ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
            {pnlPos ? '+' : ''}{fmt(profitCcy)}{isOpen ? ' open' : ''}
          </span>
        </>
      )}
    </span>
  )
}
