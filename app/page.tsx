'use client'
// app/page.tsx — Session Alerts Dashboard
import { useState } from 'react'

interface CurrencyScore {
  cur: string; score: number; tag: string; fundamental: number; pricePerf: number; stdDev: number
}
interface PairSetup {
  pair: string; direction: string; strong: string; weak: string; divergence: number; grade: string; session: string[]; reason: string; strongScore: number; weakScore: number
}
interface ScoringResult {
  top3: CurrencyScore[]; bottom3: CurrencyScore[]; pairs9: PairSetup[]; priority1: PairSetup; allScores: CurrencyScore[]
}

const SESSION_WINDOWS = [
  { name: 'Tokyo', time: '1am – 7am WAT', pairs: ['AUD/JPY', 'NZD/JPY'] },
  { name: 'London open', time: '8am – 10am WAT', prime: true },
  { name: 'Pre-NY', time: '1pm – 2pm WAT', note: 'Watch H4 pools' },
  { name: 'New York', time: '3pm – 6pm WAT', prime: true },
]

export default function AlertsPage() {
  const [calendar, setCalendar] = useState('')
  const [perf, setPerf] = useState('')
  const [stddev, setStddev] = useState('')
  const [futures, setFutures] = useState('')
  const [result, setResult] = useState<ScoringResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function runAnalysis(sendAlert = false) {
    if (!perf.trim() && !calendar.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendar, perf, stddev, futures, sendAlert }),
      })
      const data = await res.json()
      setResult(data)
      if (sendAlert) setSent(true)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function sendToTelegram() {
    setSending(true)
    await runAnalysis(true)
    setSending(false)
  }

  const gradeColor = (g: string) =>
    g === 'A+' ? 'bg-green-50 text-green-800 border-green-200' :
    g === 'B' ? 'bg-amber-50 text-amber-800 border-amber-200' :
    'bg-gray-100 text-gray-500 border-gray-200'

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Session Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Paste today's data → get top 3 vs bottom 3 → 9-pair matrix → session alerts
          </p>
        </div>
        <span className="font-mono text-xs text-gray-400">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {/* Data input */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <p className="section-label mt-0">Paste today's market data</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Economic Calendar</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-28 outline-none focus:border-gray-400"
              placeholder="Paste calendar events&#10;AUD Flash Manufacturing PMI 51.0 49.8&#10;NZD Credit Card Spending 1.1% 2.1%&#10;..."
              value={calendar} onChange={e => setCalendar(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Forex Performance Table</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-28 outline-none focus:border-gray-400"
              placeholder="Paste performance table&#10;New Zealand Dollar/U.S. Dollar -0.41%&#10;British Pound/U.S. Dollar +0.04%&#10;..."
              value={perf} onChange={e => setPerf(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Price Surprises / Std Dev</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-24 outline-none focus:border-gray-400"
              placeholder="Paste std dev table&#10;New Zealand Dollar/U.S. Dollar -1.09&#10;British Pound/U.S. Dollar -0.18&#10;..."
              value={stddev} onChange={e => setStddev(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Futures Data (optional)</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-xs min-h-24 outline-none focus:border-gray-400"
              placeholder="Paste futures performance&#10;New Zealand Dollar (Jun '26) -0.42%&#10;Canadian Dollar (Jun '26) -0.03%&#10;..."
              value={futures} onChange={e => setFutures(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => runAnalysis(false)}
            disabled={loading}
            className="flex-1 py-2.5 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {loading ? 'Scoring...' : 'Run Analysis'}
          </button>
          {result && (
            <button
              onClick={sendToTelegram}
              disabled={sending || sent}
              className="px-4 py-2.5 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {sent ? '✓ Sent' : sending ? 'Sending...' : '📱 Send to Telegram'}
            </button>
          )}
        </div>
      </div>

      {result && (
        <>
          {/* Currency ranking */}
          <p className="section-label">Currency power ranking</p>
          <div className="grid grid-cols-6 gap-3 mb-6">
            {result.top3.map((c, i) => (
              <div key={c.cur} className="col-span-2 bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="font-mono text-xs text-green-600 font-medium mb-1">#{i + 1} strongest</p>
                <p className="text-xl font-semibold text-green-800">{c.cur}</p>
                <p className="font-mono text-xs text-green-600 mt-1">+{c.score.toFixed(1)}</p>
                <p className="text-xs text-green-700 mt-1 leading-tight">{c.tag}</p>
              </div>
            ))}
            {result.bottom3.map((c, i) => (
              <div key={c.cur} className="col-span-2 bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="font-mono text-xs text-red-600 font-medium mb-1">#{i + 1} weakest</p>
                <p className="text-xl font-semibold text-red-800">{c.cur}</p>
                <p className="font-mono text-xs text-red-600 mt-1">{c.score.toFixed(1)}</p>
                <p className="text-xs text-red-700 mt-1 leading-tight">{c.tag}</p>
              </div>
            ))}
          </div>

          {/* Priority setup */}
          {result.priority1 && (
            <>
              <p className="section-label">Priority 1 — highest divergence</p>
              <div className="bg-black text-white rounded-2xl p-6 mb-6">
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <p className="font-mono text-2xl font-semibold">{result.priority1.pair}</p>
                    <p className="text-gray-400 text-sm mt-1">
                      {result.priority1.direction} — {result.priority1.strong} strength vs {result.priority1.weak} weakness
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-3xl font-semibold text-green-400">{result.priority1.divergence.toFixed(1)}</p>
                    <p className="text-gray-500 text-xs">divergence score</p>
                  </div>
                </div>
                <p className="text-gray-400 text-xs mt-4 border-t border-gray-800 pt-4">{result.priority1.reason}</p>
                <div className="flex gap-2 mt-4 flex-wrap">
                  {['Fundamentals ✓', 'Price flow ✓', 'HTF chart — verify', 'H1 trap — verify'].map((tag, i) => (
                    <span key={tag} className={`text-xs px-3 py-1 rounded-full ${i < 2 ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 9-pair matrix */}
          <p className="section-label">9-pair matrix — strongest × weakest</p>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left p-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Strong ↓ / Weak →</th>
                  {result.bottom3.map(w => (
                    <th key={w.cur} className="p-4 text-xs font-medium text-red-600 font-mono">{w.cur}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.top3.map(s => (
                  <tr key={s.cur} className="border-b border-gray-50 last:border-0">
                    <td className="p-4 font-mono text-sm font-semibold text-green-700">{s.cur}</td>
                    {result.bottom3.map(w => {
                      const p = result.pairs9.find(x => x.strong === s.cur && x.weak === w.cur)
                      return (
                        <td key={w.cur} className="p-4 text-center">
                          {p && (
                            <>
                              <p className="font-mono text-xs font-medium">{p.pair}</p>
                              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border mt-1 ${gradeColor(p.grade)}`}>
                                {p.grade}
                              </span>
                              <p className="text-xs text-gray-400 mt-0.5">{p.direction} · {p.divergence.toFixed(1)}</p>
                            </>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Session alerts */}
          <p className="section-label">Session alerts — Lagos time (WAT)</p>
          <div className="grid grid-cols-2 gap-4 mb-8">
            {SESSION_WINDOWS.map(s => {
              const topPair = result.pairs9.find(p => p.grade === 'A+') || result.priority1
              return (
                <div key={s.name} className={`bg-white rounded-xl p-4 ${s.prime ? 'border-2 border-green-300' : 'border border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-mono text-xs font-medium text-gray-500 uppercase tracking-wide">{s.name}</p>
                      <p className="font-mono text-xs text-gray-400">{s.time}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.prime ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.prime ? 'prime' : 'watch'}
                    </span>
                  </div>
                  {s.prime && topPair ? (
                    <>
                      <p className="font-mono text-base font-semibold">{topPair.pair}</p>
                      <p className={`text-xs font-medium mt-0.5 ${topPair.direction === 'Short' ? 'text-red-600' : 'text-green-600'}`}>
                        {topPair.direction} {topPair.weak}
                      </p>
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-gray-500">→ Wait for full H1 candle close</p>
                        <p className="text-xs text-gray-500">→ Declare Model A or B before entry</p>
                        <p className="text-xs text-gray-500">→ Minimum R:R 1:2</p>
                      </div>
                      <span className="inline-block mt-3 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full">Model A preferred</span>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500 mt-2">{s.note || (s.pairs ? s.pairs.join(' · ') : 'Monitor only')}</p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
