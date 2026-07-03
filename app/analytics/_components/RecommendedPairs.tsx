'use client'
// app/analytics/_components/RecommendedPairs.tsx — outcome vs your entry.
// Table on desktop; stacked cards under ~900px (toggled via .an-ideas-* classes
// defined in page.tsx's responsive <style>).

import { ArrowDownRight, ArrowUpRight, Check, Minus, Target } from 'lucide-react'
import type { AnalyticsResponse } from './types'
import { EmptyState, fmtDate, GradePill, Kicker, MONO, SectionCard, signed } from './ui'

type Idea = AnalyticsResponse['ideas']['recent'][number]

function outcomeText(i: Idea): string {
  if (i.priceMoveR != null) return `${signed(i.priceMoveR, 1)}R`
  return i.outcome ?? '—'
}

function outcomeColor(i: Idea): string {
  if (!i.takenByUser) return 'var(--text-3)'
  if (i.priceMoveR != null) return i.priceMoveR > 0 ? 'var(--green)' : i.priceMoveR < 0 ? 'var(--red)' : 'var(--text-2)'
  if (i.outcome === 'Win') return 'var(--green)'
  if (i.outcome === 'Loss') return 'var(--red)'
  return 'var(--text-2)'
}

function DirArrow({ direction }: { direction: string }) {
  const long = direction === 'Long'
  return (
    <span style={{ color: long ? 'var(--green)' : 'var(--red)', display: 'inline-flex' }}>
      {long ? <ArrowUpRight size={13} strokeWidth={2} /> : <ArrowDownRight size={13} strokeWidth={2} />}
    </span>
  )
}

function TakenMark({ taken }: { taken: boolean }) {
  return taken
    ? <span style={{ color: 'var(--green)', display: 'inline-flex' }}><Check size={15} strokeWidth={2} /></span>
    : <span style={{ color: 'var(--text-3)', display: 'inline-flex' }}><Minus size={15} strokeWidth={2} /></span>
}

const TH: React.CSSProperties = {
  padding: '9px 12px', fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 500,
}

export function RecommendedPairs({ data, days }: { data: AnalyticsResponse; days: number }) {
  const { ideas } = data
  return (
    <SectionCard style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Kicker icon={<Target size={14} strokeWidth={2} />}>Recommended pairs — outcome vs your entry</Kicker>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>last {days} days</span>
      </div>

      {/* Mini stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <MiniStat label="A+ ideas surfaced" value={String(ideas.aplusSurfaced)} color="var(--text-1)" />
        <MiniStat label="You took" value={String(ideas.taken)} color="var(--accent)" />
        <MiniStat label="Missed would-be R" value={`${signed(ideas.missedR, 1)}R`} color="var(--amber)" />
      </div>

      {ideas.recent.length === 0 ? (
        <EmptyState text="The daily idea-outcome cron will populate this once it has a full day of price action." />
      ) : (
        <>
          {/* Desktop table */}
          <table className="an-ideas-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: 'left', paddingLeft: 0 }}>Date</th>
                <th style={{ ...TH, textAlign: 'left' }}>Pair</th>
                <th style={{ ...TH, textAlign: 'center' }}>Grade</th>
                <th style={{ ...TH, textAlign: 'center' }}>Taken</th>
                <th style={{ ...TH, textAlign: 'right', paddingRight: 0 }}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {ideas.recent.map(i => (
                <tr key={i.id} style={{ borderTop: '1px solid var(--border-faint)' }}>
                  <td style={{ padding: '10px 12px 10px 0', fontFamily: MONO, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                    {fmtDate(i.alertDate)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: 14, color: 'var(--text-1)' }}>
                      <DirArrow direction={i.direction} />{i.pair}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}><GradePill grade={i.grade} /></td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}><TakenMark taken={i.takenByUser} /></td>
                  <td style={{ padding: '10px 0 10px 12px', textAlign: 'right', fontFamily: MONO, fontSize: 15, fontWeight: 500, color: outcomeColor(i) }}>
                    {outcomeText(i)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Stacked cards (narrow viewports) */}
          <div className="an-ideas-cards" style={{ flexDirection: 'column', gap: 8 }}>
            {ideas.recent.map(i => (
              <div key={i.id} style={{
                border: '1px solid var(--border-subtle)', borderRadius: 10,
                background: 'var(--bg-card-raised)', padding: '10px 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: 14, color: 'var(--text-1)' }}>
                    <DirArrow direction={i.direction} />{i.pair}
                  </span>
                  <GradePill grade={i.grade} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(i.alertDate)}</span>
                  <TakenMark taken={i.takenByUser} />
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 500, color: outcomeColor(i) }}>{outcomeText(i)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>{label}</p>
      <p style={{ margin: '3px 0 0', fontFamily: MONO, fontSize: 20, fontWeight: 500, color }}>{value}</p>
    </div>
  )
}
