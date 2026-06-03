// app/api/ideas/take/route.ts
// User clicks "Take" on an idea card from the dashboard. Creates one placeholder
// Trade per target account at the chosen risk %, links the IdeaOutcome to the
// first created trade, and marks the idea as taken.
//
// Body shape:
//   {
//     alertDate?: string,                       // ISO; if omitted defaults to today UTC start
//     pair: string,
//     direction: 'Long' | 'Short',
//     grade?, strong?, weak?, divergence?, session?, reason?,
//     accountId?:  string,                      // legacy single-account form
//     accountIds?: string[],                    // multi-account form — preferred
//     riskPct?: number,                         // default 1.0
//     source?: 'claude' | 'user-discretionary', // default 'claude'
//     screenshotUrl?: string,                   // optional setup screenshot — attached to every created trade
//   }
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function todayUtcStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    pair, direction, strong, weak, grade, divergence,
    session, reason, accountId, accountIds, riskPct,
    alertDate, screenshotUrl,
  } = body ?? {}
  const source = body.source ?? 'claude'

  // Normalise to an array. Legacy callers send accountId; new callers send accountIds.
  // Dedup so a UI bug can't create two trades for the same account in one click.
  const targets: string[] = Array.from(new Set(
    Array.isArray(accountIds) && accountIds.length > 0
      ? accountIds.filter((x: any) => typeof x === 'string' && x.length > 0)
      : (typeof accountId === 'string' && accountId.length > 0 ? [accountId] : [])
  ))

  if (!pair || !direction || targets.length === 0) {
    return NextResponse.json({ error: 'pair + direction + at least one accountId required' }, { status: 400 })
  }

  const alertDay = alertDate ? new Date(alertDate) : todayUtcStart()
  const riskPercent = typeof riskPct === 'number' && riskPct > 0 ? riskPct : 1.0

  // Resolve all target accounts up front. If ANY id is bad we reject the whole
  // batch — partial creates would leave the idea in a half-taken state that's
  // hard to recover from in the UI.
  const accounts = await db.account.findMany({ where: { id: { in: targets } } })
  if (accounts.length !== targets.length) {
    const found = new Set(accounts.map((a) => a.id))
    const missing = targets.filter((id) => !found.has(id))
    return NextResponse.json({ error: `account(s) not found: ${missing.join(', ')}` }, { status: 404 })
  }

  // 1. Create one Trade per account. We preserve target order so the response
  // matches what the user picked.
  const created: Array<{ tradeId: string; accountId: string; accountName: string; riskDollars: number }> = []
  for (const id of targets) {
    const account = accounts.find((a) => a.id === id)!
    const trade = await (db.trade.create as any)({
      data: {
        date: new Date(),
        pair,
        direction,
        model: '',
        grade: grade ?? '',
        session: Array.isArray(session) ? session.join(', ') : (session ?? ''),
        entryPrice: 0,
        slPrice: 0,
        tpPrice: 0,
        riskPercent,
        strongCcy: strong ?? '',
        weakCcy: weak ?? '',
        divScore: divergence ?? null,
        reason: reason ?? 'Taken from dashboard idea — fill entry/SL/TP from the chart',
        outcome: 'Open',
        accountId: id,
        source: source === 'user-discretionary' ? 'user-discretionary' : 'claude-idea',
        tags: ['from-dashboard-idea'],
        screenshotUrl: typeof screenshotUrl === 'string' && screenshotUrl.length > 0 ? screenshotUrl : undefined,
      },
    })
    created.push({
      tradeId: trade.id,
      accountId: id,
      accountName: account.name,
      riskDollars: Math.round((riskPercent / 100) * account.currentBalance),
    })
  }

  // 2. Upsert IdeaOutcome → points to the FIRST created trade. (IdeaOutcome.tradeId
  // is a single FK so we can't fan out the link; the first trade is good enough
  // as a navigation anchor, and the source-of-truth for "how many accounts took
  // it" is the set of Trade.ideaId rows.)
  const primary = created[0]
  try {
    await (db as any).ideaOutcome.upsert({
      where: {
        alertDate_pair_direction_source: {
          alertDate: alertDay, pair, direction, source,
        },
      },
      create: {
        alertDate: alertDay,
        pair, direction,
        grade: grade ?? 'C',
        strong: strong ?? '',
        weak: weak ?? '',
        divergence: divergence ?? 0,
        source,
        userAction: 'taken',
        actedAt: new Date(),
        takenByUser: true,
        tradeId: primary.tradeId,
        outcome: 'Pending',
      },
      update: {
        userAction: 'taken',
        actedAt: new Date(),
        takenByUser: true,
        tradeId: primary.tradeId,
      },
    })
  } catch (err) {
    console.error('[ideas/take] IdeaOutcome upsert failed (non-fatal):', err)
  }

  // 3. Backfill ideaId on every created trade so each one can navigate back to
  // the same idea card.
  try {
    const ideaRow = await (db as any).ideaOutcome.findFirst({
      where: { alertDate: alertDay, pair, direction, source },
    })
    if (ideaRow?.id) {
      await db.trade.updateMany({
        where: { id: { in: created.map((c) => c.tradeId) } },
        data: { ideaId: ideaRow.id },
      })
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    count: created.length,
    results: created,
    // Legacy single-account fields for any UI that still reads them.
    tradeId: primary.tradeId,
    accountName: primary.accountName,
    riskDollars: primary.riskDollars,
  })
}
