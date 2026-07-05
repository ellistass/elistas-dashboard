// lib/dashboard-context.ts
// Pure helpers used by the /api/dashboard route. Kept separate so the analytics
// route and Telegram news cron can re-use them.

import { db } from './db'

// ─── Data freshness ────────────────────────────────────────────────────────────

export interface FreshnessTile {
  source: 'barchart' | 'calendar' | 'rates' | 'mt4'
  label: string
  fetchedAt: Date | null
  ageMinutes: number | null
  status: 'fresh' | 'stale' | 'missing'
}

const FRESHNESS_THRESHOLDS: Record<FreshnessTile['source'], { stale: number }> = {
  barchart: { stale: 90 },   // matches the existing cron freshness gate
  calendar: { stale: 24 * 60 },
  rates:    { stale: 24 * 60 },
  mt4:      { stale: 60 },
}

export async function buildFreshness(): Promise<FreshnessTile[]> {
  const [bc, ec, rates] = await Promise.all([
    db.barchartSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
    db.economicSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
    db.ratesSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
  ])
  // MT4: most-recent lastSyncedAt across active accounts
  const mt4 = await db.account.findFirst({
    where: { isActive: true, lastSyncedAt: { not: null } },
    orderBy: { lastSyncedAt: 'desc' },
    select: { lastSyncedAt: true },
  })

  const make = (
    source: FreshnessTile['source'],
    label: string,
    fetchedAt: Date | null,
  ): FreshnessTile => {
    const age = fetchedAt ? Math.floor((Date.now() - fetchedAt.getTime()) / 60000) : null
    const t = FRESHNESS_THRESHOLDS[source]
    return {
      source,
      label,
      fetchedAt,
      ageMinutes: age,
      status: age == null ? 'missing' : age > t.stale ? 'stale' : 'fresh',
    }
  }

  return [
    make('barchart', 'Barchart',           bc?.fetchedAt ?? null),
    make('calendar', 'Calendar',           ec?.fetchedAt ?? null),
    make('rates',    'Rates',              rates?.fetchedAt ?? null),
    make('mt4',      'MT4 EA',             mt4?.lastSyncedAt ?? null),
  ]
}

// ─── Today's realized R + 2R cutoff ────────────────────────────────────────────

export interface DailyRStatus {
  todayR: number
  cutoffR: number       // your strategy doc: -2R
  pctOfCutoff: number   // 0..1, clamped
  state: 'safe' | 'caution' | 'stop'
  closedToday: number
}

export async function buildDailyR(): Promise<DailyRStatus> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const trades = await db.trade.findMany({
    where: { date: { gte: start }, outcome: { in: ['Win', 'Loss', 'BE'] } },
    select: { resultR: true },
  })
  const todayR = trades.reduce((s, t) => s + (t.resultR ?? 0), 0)
  const cutoffR = -2
  const pct = Math.max(0, Math.min(1, todayR <= 0 ? Math.abs(todayR) / Math.abs(cutoffR) : 0))
  const state: DailyRStatus['state'] =
    todayR <= cutoffR ? 'stop' : todayR <= cutoffR * 0.75 ? 'caution' : 'safe'
  return { todayR: Number(todayR.toFixed(2)), cutoffR, pctOfCutoff: pct, state, closedToday: trades.length }
}

// ─── Next high-impact calendar event + per-trade collisions ────────────────────

export interface CalendarEventLite {
  title: string
  country: string
  currency: string         // mapped from country
  date: string             // ISO
  impact: 'High' | 'Medium' | 'Low' | 'Holiday'
  forecast: string | null
  previous: string | null
  actual: string | null
}

const COUNTRY_TO_CCY: Record<string, string> = {
  'United States':  'USD',
  'Euro Area':      'EUR',
  'Eurozone':       'EUR',
  'United Kingdom': 'GBP',
  'Japan':          'JPY',
  'Canada':         'CAD',
  'Australia':      'AUD',
  'New Zealand':    'NZD',
  'Switzerland':    'CHF',
  'Norway':         'NOK',
  'Sweden':         'SEK',
}

// Many calendar feeds put a 3-letter code in country. Accept both shapes.
export function eventCurrency(country: string): string {
  if (!country) return ''
  if (country.length === 3 && country === country.toUpperCase()) return country
  return COUNTRY_TO_CCY[country] ?? ''
}

export async function loadCalendar(): Promise<CalendarEventLite[]> {
  const snap = await db.economicSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } })
  if (!snap?.events) return []
  const events = snap.events as unknown as Array<any>
  return events.map((e) => ({
    title: e.title,
    country: e.country,
    currency: e.currency ?? eventCurrency(e.country),
    date: e.date,
    impact: e.impact,
    forecast: e.forecast ?? null,
    previous: e.previous ?? null,
    actual: e.actual ?? null,
  }))
}

export function nextHighImpactEvent(events: CalendarEventLite[]): CalendarEventLite | null {
  const now = Date.now()
  const upcoming = events
    .filter((e) => e.impact === 'High' && new Date(e.date).getTime() > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return upcoming[0] ?? null
}

// Find calendar events that collide with an open trade's strong/weak currency
// inside the next `windowMinutes`. Used by both the dashboard badge and the
// Telegram cron.
export function collisionsForTrade(
  trade: { strongCcy: string; weakCcy: string; pair: string },
  events: CalendarEventLite[],
  windowMinutes = 120,
): CalendarEventLite[] {
  const now = Date.now()
  const cutoff = now + windowMinutes * 60_000
  // Pull currencies from pair as a backup if strong/weak aren't set (MT4 auto-logged trades)
  const pairCcys = trade.pair.replace('/', '').toUpperCase().match(/.{1,3}/g) ?? []
  const watchedSet = new Set([trade.strongCcy, trade.weakCcy, ...pairCcys].filter(Boolean))
  return events.filter((e) => {
    const t = new Date(e.date).getTime()
    if (t < now || t > cutoff) return false
    if (e.impact !== 'High') return false
    return watchedSet.has(e.currency)
  })
}

// ─── DXY + VIX from the futures snapshot ───────────────────────────────────────

export interface MacroTile { symbol: string; name: string; latest: number; percentChange: number }

export function pickDxyVix(barchartData: any): MacroTile[] {
  if (!barchartData?.futures?.performance?.today) return []
  const all = [
    ...(barchartData.futures.performance.today.bullish ?? []),
    ...(barchartData.futures.performance.today.bearish ?? []),
  ]
  // Common futures symbols (Barchart codes): DXY = ICE U.S. Dollar Index (DX*), VIX = ^VIX
  // Roll codes change quarterly (Jun = M, Sep = U, Dec = Z, Mar = H + 2-digit year).
  const dxyMatch = all.find((r: any) => /^DX[Y]?[A-Z]?\d{1,2}$/.test(r.symbol) || /^\^?DXY$/.test(r.symbol) || /^DXY/.test(r.symbol))
  const vixMatch = all.find((r: any) => /^\^?VIX$/.test(r.symbol) || /^VI[A-Z]\d{1,2}$/.test(r.symbol))
  const tiles: MacroTile[] = []
  // Sanity bounds: roll-code regexes occasionally grab the wrong futures row.
  // DXY trades ~80–130; VIX ~8–100. A "DXY" of 17.50 is a mismatched contract —
  // better to show nothing than a wrong number. Also refuse the same row twice.
  const dxyOk = dxyMatch && dxyMatch.latest >= 70 && dxyMatch.latest <= 140 && dxyMatch !== vixMatch
  const vixOk = vixMatch && vixMatch.latest >= 5 && vixMatch.latest <= 150
  if (dxyOk) tiles.push({ symbol: 'DXY', name: 'US Dollar Index', latest: dxyMatch.latest, percentChange: dxyMatch.percentChange })
  if (vixOk) tiles.push({ symbol: 'VIX', name: 'CBOE Volatility',  latest: vixMatch.latest, percentChange: vixMatch.percentChange })
  return tiles
}

// ─── Recent Telegram alerts log ────────────────────────────────────────────────

export interface RecentAlert {
  id: string
  date: string
  sentAt: string | null
  pair: string | null
  direction: string | null
  grade: string | null
}

export async function buildRecentAlerts(limit = 5): Promise<RecentAlert[]> {
  const alerts = await db.dailyAlert.findMany({
    where: { sentAt: { not: null } },
    orderBy: { sentAt: 'desc' },
    take: limit,
  })
  return alerts.map((a) => {
    const idea = ((a as any).ideas?.[0] ?? (a.priority1 as any)) || null
    return {
      id: a.id,
      date: a.date.toISOString(),
      sentAt: a.sentAt?.toISOString() ?? null,
      pair: idea?.pair ?? null,
      direction: idea?.direction ?? null,
      grade: idea?.grade ?? null,
    }
  })
}

// ─── Today's ideas (from the latest alert + user-discretionary logs) ─────────

export async function loadTodaysIdeas(): Promise<any[]> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // 1. Claude's ideas — from the latest DailyAlert
  const alert = await db.dailyAlert.findUnique({ where: { date: today } })
  const claudeIdeas: any[] = []
  if (alert) {
    const ideas = (alert as any).ideas
    if (Array.isArray(ideas) && ideas.length > 0) {
      claudeIdeas.push(...ideas.map((i) => ({ ...i, source: 'claude' })))
    } else if (alert.priority1) {
      claudeIdeas.push({ ...(alert.priority1 as any), source: 'claude' })
    }
  }

  // 2. User-discretionary ideas — stored directly in IdeaOutcome (no DailyAlert involved)
  const userRows = await (db as any).ideaOutcome.findMany({
    where: { alertDate: today, source: 'user-discretionary' },
    orderBy: { createdAt: 'asc' },
  })
  const userIdeas = userRows.map((r: any) => ({
    pair: r.pair,
    direction: r.direction,
    grade: r.grade,
    strong: r.strong,
    weak: r.weak,
    divergence: r.divergence,
    session: r.userSession ? [r.userSession] : [],
    reason: r.userReason ?? undefined,
    userModel: r.userModel ?? undefined,
    source: 'user-discretionary',
  }))

  return [...claudeIdeas, ...userIdeas]
}

// ─── Today's IdeaOutcome rows (so the dashboard knows what's taken/watched/skipped) ─

export interface IdeaActionMap {
  [key: string]: {
    userAction: string
    invalidationReason: string | null
    tradeId: string | null
    outcomeId: string
  }
}

// Key format: "pair|direction|source" so a Claude GBP/USD long and a discretionary
// GBP/USD long don't collide.
export async function loadTodaysIdeaActions(): Promise<IdeaActionMap> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const rows = await (db as any).ideaOutcome.findMany({
    where: { alertDate: today },
  })
  const map: IdeaActionMap = {}
  for (const r of rows) {
    map[`${r.pair}|${r.direction}|${r.source}`] = {
      userAction: r.userAction,
      invalidationReason: r.invalidationReason,
      tradeId: r.tradeId,
      outcomeId: r.id,
    }
  }
  return map
}
