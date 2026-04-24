'use client'
// app/page.tsx — Elistas Live Dashboard
// Two-column: open trades + sessions (left) | scores + matrix (right)
// Run Analysis button calls Claude AI on demand

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrencyScore {
  cur: string; score: number; tag: string
  fundamental: number; pricePerf: number; stdDev: number
  notes?: string[]
}
interface PairSetup {
  pair: string; direction: string; strong: string; weak: string
  divergence: number; grade: string; session: string[]
  reason: string; strongScore: number; weakScore: number
}
interface ScoringResult {
  top3: CurrencyScore[]; bottom3: CurrencyScore[]
  pairs9: PairSetup[]; priority1: PairSetup; allScores: CurrencyScore[]
  divergenceWarnings?: string[]
  generatedAt?: string; scoredBy?: string
}
interface OpenTrade {
  id: string; pair: string; direction: string; model: string; grade: string
  session: string; entryPrice: number; slPrice: number; tpPrice: number
  strongCcy: string; weakCcy: string; divScore?: number
  alignmentStatus: 'Green' | 'Amber' | 'Red' | 'Unknown'
  alignmentReason: string
  date: string
}
interface DashboardData {
  scores: ScoringResult | null
  openTrades: OpenTrade[]
  fetchedAt: string
  fetchErrors: string[]
  hasLiveData: boolean
  scoredAt?: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_WINDOWS = [
  { name: 'Tokyo', time: '1am – 7am', prime: false },
  { name: 'London', time: '8am – 11am', prime: true },
  { name: 'Pre-NY', time: '1pm – 2pm', prime: false },
  { name: 'New York', time: '3pm – 6pm', prime: true },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function AlignmentBadge({ status }: { status: string }) {
  const map: Record<string, { emoji: string; cls: string }> = {
    Green: { emoji: '🟢', cls: 'bg-green-50 text-green-700 border-green-200' },
    Amber: { emoji: '🟡', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    Red:   { emoji: '🔴', cls: 'bg-red-50 text-red-700 border-red-200' },
    Unknown: { emoji: '⚪', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  }
  const { emoji, cls } = map[status] || map.Unknown
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>{emoji} {status}</span>
}

function GradeBadge({ grade }: { grade: string }) {
  const cls = grade === 'A+' ? 'badge-aplus' : grade === 'B' ? 'badge-b' : grade === 'Skip' ? 'badge-skip' : 'badge-c'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{grade}</span>
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score > 0 ? 'text-green-700' : score < 0 ? 'text-red-600' : 'text-gray-400'
  return <span className={`font-mono text-xs font-medium ${cls}`}>{score > 0 ? '+' : ''}{score.toFixed(1)}</span>
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoring, setScoring] = useState(false)
  const [scoreStatus, setScoreStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // Manual paste
  const [calendar, setCalendar] = useState('')
  const [perf, setPerf] = useState('')
  const [stddev, setStddev] = useState('')
  const [futures, setFutures] = useState('')

  // Fetch saved dashboard data (fast — just reads DB)
  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard')
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) { console.error('Dashboard fetch error:', e) }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 3 * 60 * 1000) // refresh view every 3 min
    return () => clearInterval(interval)
  }, [fetchDashboard])

  // Run Analysis — calls Claude AI to score live market data
  async function runAnalysis(sendAlert = false) {
    setScoring(true)
    setScoreStatus(null)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto', sendAlert }),
      })
      const json = await res.json()

      if (!res.ok) {
        setScoreStatus({ ok: false, msg: json.error || 'Scoring failed' })
      } else {
        setData(prev => prev
          ? { ...prev, scores: json, hasLiveData: true, fetchErrors: json.fetchErrors || [], scoredAt: new Date().toISOString() }
          : { scores: json, openTrades: [], fetchedAt: new Date().toISOString(), fetchErrors: json.fetchErrors || [], hasLiveData: true, scoredAt: new Date().toISOString() }
        )
        const top = json.top3?.map((c: any) => c.cur).join(' · ') || '—'
        const bot = json.bottom3?.map((c: any) => c.cur).join(' · ') || '—'
        setScoreStatus({
          ok: true,
          msg: `✓ Claude scored live data · Strong: ${top} · Weak: ${bot}${sendAlert ? ' · Sent to Telegram' : ''}`,
        })
        if (sendAlert) setSent(true)
      }
    } catch (e: any) {
      setScoreStatus({ ok: false, msg: e.message || 'Network error' })
    }
    setScoring(false)
  }

  // Manual scoring
  async function runManual(sendAlert = false) {
    if (!perf.trim() && !calendar.trim()) return
    setScoring(true)
    setScoreStatus(null)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual', calendar, perf, stddev, futures, sendAlert }),
      })
      const json = await res.json()
      if (!res.ok) {
        setScoreStatus({ ok: false, msg: json.error || 'Manual scoring failed' })
      } else {
        setData(prev => prev
          ? { ...prev, scores: json, hasLiveData: false, scoredAt: new Date().toISOString() }
          : { scores: json, openTrades: [], fetchedAt: new Date().toISOString(), fetchErrors: [], hasLiveData: false, scoredAt: new Date().toISOString() }
        )
        setScoreStatus({ ok: true, msg: '✓ Claude scored manual data' })
        if (sendAlert) setSent(true)
      }
    } catch (e: any) {
      setScoreStatus({ ok: false, msg: e.message || 'Error' })
    }
    setScoring(false)
  }

  // Send existing scores to Telegram
  async function sendToTelegram() {
    setSending(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto', sendAlert: true }),
      })
      if (res.ok) setSent(true)
    } catch (e) { console.error(e) }
    setSending(false)
  }

  const scores = data?.scores
  const openTrades = data?.openTrades || []
  const warnings = (scores as any)?.divergenceWarnings || []

  const now = new Date()
  const watHour = (now.getUTCHours() + 1) % 24
  const currentSession =
    watHour >= 1 && watHour < 7 ? 'Tokyo' :
    watHour >= 8 && watHour < 11 ? 'London' :
    watHour >= 13 && watHour < 14 ? 'Pre-NY' :
    watHour >= 15 && watHour < 18 ? 'New York' : null

  return (
    <div className="max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Live Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {data?.scoredAt
              ? `Last scored: ${timeAgo(data.scoredAt)} · Claude AI`
              : 'No scores yet — tap Run Analysis'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentSession && (
            <span className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-full font-medium animate-pulse">
              🕐 {currentSession}
            </span>
          )}
          <button
            onClick={() => runAnalysis(false)}
            disabled={scoring}
            className="px-5 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
          >
            {scoring ? (
              <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />Analysing…</>
            ) : (
              <><span className="text-base">⚡</span>Run Analysis</>
            )}
          </button>
          <button
            onClick={() => runAnalysis(true)}
            disabled={scoring || sent}
            className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            {sent ? '✓ Sent' : '📱 Analyse + Send'}
          </button>
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50"
            title="Refresh view"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
          </button>
        </div>
      </div>

      {/* ── Score status strip ── */}
      {scoreStatus && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-xs font-mono flex items-center justify-between ${
          scoreStatus.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <span>{scoreStatus.msg}</span>
          <button onClick={() => setScoreStatus(null)} className="ml-4 opacity-50 hover:opacity-100 text-sm">×</button>
        </div>
      )}

      {/* ── Divergence warnings ── */}
      {warnings.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <strong>⚠️ Divergence Warnings:</strong>
          {warnings.map((w: string, i: number) => <p key={i} className="mt-1">→ {w}</p>)}
        </div>
      )}

      {/* ── Fetch errors ── */}
      {data?.fetchErrors && data.fetchErrors.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <strong>Fetch warnings:</strong> {data.fetchErrors.join(' · ')}
          {!data.hasLiveData && (
            <span className="ml-2">— <button onClick={() => setShowManual(true)} className="underline">enter data manually</button></span>
          )}
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT: Open trades + Sessions ── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <p className="section-label mt-0">Open trades</p>
            <span className="text-xs text-gray-400 font-mono">{openTrades.length}</span>
          </div>

          {openTrades.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-gray-400 text-sm">No open trades</p>
              <a href="/journal" className="text-xs text-blue-600 hover:underline mt-1 block">Log a trade →</a>
            </div>
          ) : (
            openTrades.map(trade => (
              <div key={trade.id} className="card hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-mono text-sm font-semibold">{trade.pair}</p>
                    <p className={`text-xs font-medium mt-0.5 ${trade.direction === 'Short' ? 'text-red-600' : 'text-green-700'}`}>
                      {trade.direction} · Model {trade.model} · {trade.grade}
                    </p>
                  </div>
                  <AlignmentBadge status={trade.alignmentStatus} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 mb-2">
                  <div><p className="text-gray-400">Entry</p><p className="font-mono font-medium text-gray-800">{trade.entryPrice}</p></div>
                  <div><p className="text-gray-400">SL</p><p className="font-mono font-medium text-red-600">{trade.slPrice}</p></div>
                  <div><p className="text-gray-400">TP</p><p className="font-mono font-medium text-green-700">{trade.tpPrice}</p></div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <span className="text-xs font-mono text-green-700">{trade.strongCcy}</span>
                  <span className="text-xs text-gray-300">vs</span>
                  <span className="text-xs font-mono text-red-600">{trade.weakCcy}</span>
                  {trade.divScore && <span className="text-xs text-gray-400 ml-auto">div {trade.divScore.toFixed(1)}</span>}
                </div>
                {trade.alignmentStatus !== 'Green' && trade.alignmentStatus !== 'Unknown' && (
                  <p className="text-xs text-amber-700 mt-2 pt-2 border-t border-amber-100">{trade.alignmentReason}</p>
                )}
              </div>
            ))
          )}

          {/* Sessions */}
          <p className="section-label">Sessions — WAT</p>
          <div className="space-y-1.5">
            {SESSION_WINDOWS.map(s => {
              const isActive = s.name === currentSession
              return (
                <div key={s.name} className={`rounded-xl px-3 py-2.5 flex items-center justify-between text-sm border transition-all ${
                  isActive ? 'bg-green-50 border-green-200 shadow-sm' : 'bg-white border-gray-100'
                }`}>
                  <div className="flex items-center gap-2">
                    {isActive && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                    <span className={`font-medium ${isActive ? 'text-green-800' : 'text-gray-600'}`}>{s.name}</span>
                    <span className="text-xs text-gray-400">{s.time}</span>
                  </div>
                  {s.prime && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isActive ? 'bg-green-200 text-green-800' : 'bg-gray-100 text-gray-400'}`}>
                      prime
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT: Scores + Matrix ── */}
        <div className="lg:col-span-2 space-y-6">
          {!scores ? (
            <div className="card flex flex-col items-center justify-center py-20 text-center">
              {scoring ? (
                <>
                  <div className="animate-spin w-10 h-10 border-3 border-black border-t-transparent rounded-full mb-4" />
                  <p className="text-sm text-gray-600 font-medium">Claude is analysing the markets…</p>
                  <p className="text-xs text-gray-400 mt-1">Fetching data → Scoring currencies → Building matrix</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                    <span className="text-2xl">⚡</span>
                  </div>
                  <p className="text-gray-600 text-sm font-medium">No analysis yet</p>
                  <p className="text-xs text-gray-400 mt-1 mb-4">Tap Run Analysis to score today&apos;s market with Claude AI</p>
                  <button onClick={() => runAnalysis(false)} className="px-5 py-2.5 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-all">
                    ⚡ Run Analysis
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Currency power ranking */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="section-label mt-0">Currency power ranking</p>
                  <div className="flex items-center gap-2">
                    {data?.scoredAt && (
                      <span className="text-xs text-gray-400">{timeAgo(data.scoredAt)}</span>
                    )}
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> AI scored
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  {/* Top 3 */}
                  <div className="space-y-2">
                    <p className="text-xs text-green-600 font-medium mb-1">STRONGEST</p>
                    {scores.top3.map((c, i) => (
                      <div key={c.cur} className="card-strong flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-green-600 opacity-60">#{i + 1}</span>
                          <span className="font-mono font-semibold text-green-800">{c.cur}</span>
                        </div>
                        <div className="text-right">
                          <ScoreBadge score={c.score} />
                          <p className="text-xs text-green-600 mt-0.5 max-w-32 truncate">{c.tag}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Bottom 3 */}
                  <div className="space-y-2">
                    <p className="text-xs text-red-500 font-medium mb-1">WEAKEST</p>
                    {scores.bottom3.map((c, i) => (
                      <div key={c.cur} className="card-weak flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-red-500 opacity-60">#{i + 1}</span>
                          <span className="font-mono font-semibold text-red-800">{c.cur}</span>
                        </div>
                        <div className="text-right">
                          <ScoreBadge score={c.score} />
                          <p className="text-xs text-red-500 mt-0.5 max-w-32 truncate">{c.tag}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* All currencies compact row */}
                {scores.allScores && scores.allScores.length > 6 && (
                  <div className="card py-2 px-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {scores.allScores.map(c => (
                        <div key={c.cur} className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-medium text-gray-500">{c.cur}</span>
                          <ScoreBadge score={c.score} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Priority 1 setup */}
              {scores.priority1 && (
                <div>
                  <p className="section-label">Priority 1 setup</p>
                  <div className="bg-black text-white rounded-2xl p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <p className="font-mono text-2xl font-semibold tracking-tight">{scores.priority1.pair}</p>
                        <p className="text-gray-400 text-sm mt-1">
                          {scores.priority1.direction} · {scores.priority1.strong} vs {scores.priority1.weak}
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <GradeBadge grade={scores.priority1.grade} />
                          <span className="text-xs text-gray-500">{scores.priority1.session?.join(' · ')}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-4xl font-semibold text-green-400">
                          {scores.priority1.divergence.toFixed(1)}
                        </p>
                        <p className="text-gray-500 text-xs mt-1">divergence</p>
                      </div>
                    </div>
                    <p className="text-gray-500 text-xs mt-5 pt-4 border-t border-gray-800 leading-relaxed">
                      {scores.priority1.reason}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      {['Wait for H1 close', 'Declare A or B', 'Min 1:2 R:R', 'No entry 30m after open'].map(r => (
                        <span key={r} className="text-xs px-2.5 py-1 bg-gray-800 text-gray-400 rounded-full">{r}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 9-pair matrix */}
              <div>
                <p className="section-label">9-pair matrix — strong × weak</p>
                <div className="card p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left p-3 text-xs font-medium text-gray-400 uppercase">↓ Strong / Weak →</th>
                        {scores.bottom3.map(w => (
                          <th key={w.cur} className="p-3 text-xs font-mono font-semibold text-red-600">{w.cur}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scores.top3.map(s => (
                        <tr key={s.cur} className="border-b border-gray-50 last:border-0">
                          <td className="p-3 font-mono text-sm font-semibold text-green-700">{s.cur}</td>
                          {scores.bottom3.map(w => {
                            const p = scores.pairs9.find(x => x.strong === s.cur && x.weak === w.cur)
                            if (!p) return <td key={w.cur} className="p-3 text-center text-gray-300">—</td>
                            return (
                              <td key={w.cur} className="p-3 text-center">
                                <p className="font-mono text-xs font-medium text-gray-700">{p.pair}</p>
                                <GradeBadge grade={p.grade} />
                                <p className="text-xs text-gray-400 mt-0.5">{p.direction} · {p.divergence.toFixed(1)}</p>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Manual override (collapsible) ── */}
      <div className="mt-8 border-t border-gray-200 pt-6">
        <button onClick={() => setShowManual(!showManual)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors">
          <span className={`transition-transform text-xs ${showManual ? 'rotate-90' : ''}`}>▶</span>
          Manual data entry override
        </button>
        {showManual && (
          <div className="mt-4 bg-white border border-gray-200 rounded-2xl p-5">
            <p className="text-xs text-gray-400 mb-4">
              Paste data from Barchart / ForexFactory. Claude will analyse it.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Economic Calendar</label>
                <textarea className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-24 outline-none focus:border-gray-400"
                  placeholder="AUD Flash Manufacturing PMI 51.0 49.8&#10;NZD Credit Card Spending 1.1% 2.1%"
                  value={calendar} onChange={e => setCalendar(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Forex Performance Table</label>
                <textarea className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-24 outline-none focus:border-gray-400"
                  placeholder="New Zealand Dollar/U.S. Dollar -0.41%&#10;British Pound/U.S. Dollar +0.04%"
                  value={perf} onChange={e => setPerf(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Std Dev / Price Surprises</label>
                <textarea className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-20 outline-none focus:border-gray-400"
                  placeholder="New Zealand Dollar/U.S. Dollar -1.09&#10;British Pound/U.S. Dollar -0.18"
                  value={stddev} onChange={e => setStddev(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Futures (optional)</label>
                <textarea className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-20 outline-none focus:border-gray-400"
                  placeholder="New Zealand Dollar (Jun '26) -0.42%"
                  value={futures} onChange={e => setFutures(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => runManual(false)} disabled={scoring || (!perf.trim() && !calendar.trim())}
                className="px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-40 transition-all">
                {scoring ? 'Analysing…' : '⚡ Run Manual Analysis'}
              </button>
              <button onClick={() => runManual(true)} disabled={scoring || sent}
                className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-all">
                {sent ? '✓ Sent' : 'Run + Send to Telegram'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
