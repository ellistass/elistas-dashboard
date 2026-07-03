'use client'
// app/_components/dashboard/ManualPanel.tsx
// Manual data-entry panel (v2). Shown when the header "Manual" toggle is on.
// Paste Barchart / ForexFactory data → POST /api/alerts { mode: 'manual', ... }.
// State lives in app/page.tsx so a run survives closing the panel.

import { Zap, Send } from 'lucide-react'

interface Props {
  calendar: string; setCalendar: (v: string) => void
  perf: string; setPerf: (v: string) => void
  stddev: string; setStddev: (v: string) => void
  futures: string; setFutures: (v: string) => void
  scoring: boolean
  sent: boolean
  onRun: (sendAlert: boolean) => void
}

export function ManualPanel({
  calendar, setCalendar, perf, setPerf, stddev, setStddev, futures, setFutures,
  scoring, sent, onRun,
}: Props) {
  const fields = [
    { label: 'Economic calendar', value: calendar, setter: setCalendar, placeholder: 'AUD Flash Manufacturing PMI 51.0 49.8\nNZD Credit Card Spending 1.1% 2.1%' },
    { label: 'Forex performance', value: perf, setter: setPerf, placeholder: 'NZD/USD -0.41%\nGBP/USD +0.04%' },
    { label: 'Std dev / surprises', value: stddev, setter: setStddev, placeholder: 'NZD/USD -1.09\nGBP/USD -0.18' },
    { label: 'Futures (optional)', value: futures, setter: setFutures, placeholder: 'NZD Jun -0.42%\nGBP Jun +0.11%' },
  ]
  const ready = perf.trim().length > 0 || calendar.trim().length > 0

  return (
    <div className="card" style={{ marginTop: 14, padding: '16px 18px' }}>
      <div className="kicker" style={{ color: 'var(--accent)', marginBottom: 4 }}>Manual data entry</div>
      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 14px' }}>
        Paste data from Barchart / ForexFactory. Claude will analyse it directly.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
        {fields.map(({ label, value, setter, placeholder }) => (
          <div key={label}>
            <label className="kicker" style={{ fontSize: 9, display: 'block', marginBottom: 6 }}>{label}</label>
            <textarea
              style={{ width: '100%', minHeight: 84, padding: '10px 12px' }}
              placeholder={placeholder}
              value={value}
              onChange={(e) => setter(e.target.value)}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => onRun(false)} disabled={scoring || !ready}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 9, border: 'none',
            background: 'var(--accent)', color: 'var(--accent-on)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            opacity: scoring || !ready ? 0.5 : 1,
          }}>
          <Zap size={13} strokeWidth={2} />
          {scoring ? 'Analysing…' : 'Run manual analysis'}
        </button>
        <button
          onClick={() => onRun(true)} disabled={scoring || sent}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 9,
            border: `1px solid ${sent ? 'var(--green-border)' : 'var(--border)'}`,
            background: sent ? 'var(--green-dim)' : 'var(--bg-card-2)',
            color: sent ? 'var(--green)' : 'var(--text-body)',
            fontSize: 12, cursor: 'pointer', opacity: scoring || sent ? 0.6 : 1,
          }}>
          <Send size={12} strokeWidth={2} />
          {sent ? 'Sent' : 'Run + send to Telegram'}
        </button>
      </div>
    </div>
  )
}
