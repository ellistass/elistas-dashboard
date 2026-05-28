// app/api/ideas/take/route.ts
// User clicks "Take" on an idea card from the dashboard. Creates a placeholder
// Trade for the chosen account at the chosen risk %, links it to the IdeaOutcome,
// and marks the idea as taken.
//
// Body shape:
//   {
//     alertDate?: string,         // ISO; if omitted defaults to today UTC start
//     pair: string,
//     direction: 'Long' | 'Short',
//     grade?, strong?, weak?, divergence?, session?, reason?,
//     accountId: string,          // required — which account to route the trade to
//     riskPct?: number,           // default 1.0
//     source?: 'claude' | 'user-discretionary',  // default 'claude'
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
    session, reason, accountId, riskPct,
    alertDate,
  } = body ?? {}
  const source = body.source ?? 'claude'

  if (!pair || !direction || !accountId) {
    return NextResponse.json({ error: 'pair + direction + accountId required' }, { status: 400 })
  }

  const alertDay = alertDate ? new Date(alertDate) : todayUtcStart()
  const riskPercent = typeof riskPct === 'number' && riskPct > 0 ? riskPct : 1.0

  // Resolve account for the per-account risk → $ math (also validates accountId exists)
  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) return NextResponse.json({ error: 'account not found' }, { status: 404 })

  // 1. Create the Trade row (placeholder — user fills in entry/SL/TP from the chart later)
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
      accountId,
      source: source === 'user-discretionary' ? 'user-discretionary' : 'claude-idea',
      tags: ['from-dashboard-idea'],
    },
  })

  // 2. Update (or create-if-missing) the IdeaOutcome row → links to the trade
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
        tradeId: trade.id,
        outcome: 'Pending',
      },
      update: {
        userAction: 'taken',
        actedAt: new Date(),
        takenByUser: true,
        tradeId: trade.id,
      },
    })
  } catch (err) {
    console.error('[ideas/take] IdeaOutcome upsert failed (non-fatal):', err)
  }

  // 3. Update Trade.ideaId so the trade page can navigate back to the idea
  try {
    const ideaRow = await (db as any).ideaOutcome.findFirst({
      where: { alertDate: alertDay, pair, direction, source },
    })
    if (ideaRow?.id) {
      await (db.trade.update as any)({ where: { id: trade.id }, data: { ideaId: ideaRow.id } })
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    tradeId: trade.id,
    accountName: account.name,
    riskDollars: Math.round((riskPercent / 100) * account.currentBalance),
  })
}
