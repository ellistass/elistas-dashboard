// app/api/trades/route.ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const pair = searchParams.get('pair')
  const model = searchParams.get('model')
  const outcome = searchParams.get('outcome')

  const trades = await db.trade.findMany({
    where: {
      ...(pair && { pair }),
      ...(model && { model }),
      ...(outcome && { outcome }),
    },
    orderBy: { date: 'desc' },
    take: limit,
    skip: offset,
  })

  const total = await db.trade.count()

  // Analytics
  const allTrades = await db.trade.findMany({ where: { outcome: { not: 'Open' } } })
  const wins = allTrades.filter(t => t.outcome === 'Win')
  const losses = allTrades.filter(t => t.outcome === 'Loss')
  const totalR = allTrades.reduce((sum, t) => sum + (t.resultR || 0), 0)
  const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0

  // By model
  const modelA = allTrades.filter(t => t.model === 'A')
  const modelB = allTrades.filter(t => t.model === 'B')
  const modelAWins = modelA.filter(t => t.outcome === 'Win')
  const modelBWins = modelB.filter(t => t.outcome === 'Win')

  // By session
  const bySessions = ['London', 'New York', 'Tokyo'].map(s => {
    const st = allTrades.filter(t => t.session === s)
    const sw = st.filter(t => t.outcome === 'Win')
    return { session: s, trades: st.length, winRate: st.length > 0 ? (sw.length / st.length) * 100 : 0 }
  })

  // By grade
  const byGrade = ['A+', 'B', 'C'].map(g => {
    const gt = allTrades.filter(t => t.grade === g)
    const gw = gt.filter(t => t.outcome === 'Win')
    const gr = gt.reduce((sum, t) => sum + (t.resultR || 0), 0)
    return { grade: g, trades: gt.length, winRate: gt.length > 0 ? (gw.length / gt.length) * 100 : 0, totalR: gr }
  })

  return NextResponse.json({
    trades,
    total,
    analytics: {
      totalTrades: allTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 10) / 10,
      totalR: Math.round(totalR * 100) / 100,
      avgR: allTrades.length > 0 ? Math.round((totalR / allTrades.length) * 100) / 100 : 0,
      modelA: {
        trades: modelA.length,
        winRate: modelA.length > 0 ? Math.round((modelAWins.length / modelA.length) * 1000) / 10 : 0,
      },
      modelB: {
        trades: modelB.length,
        winRate: modelB.length > 0 ? Math.round((modelBWins.length / modelB.length) * 1000) / 10 : 0,
      },
      bySession: bySessions,
      byGrade,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Per-account $ risk: when riskAmount + accountId are given, derive
    // riskPercent from the account's live balance so R math stays consistent.
    const accountId: string | null = typeof body.accountId === 'string' && body.accountId.length > 0 ? body.accountId : null
    const riskAmount: number | null = body.riskAmount != null && parseFloat(body.riskAmount) > 0 ? parseFloat(body.riskAmount) : null
    let riskPercent = parseFloat(body.riskPercent || '1')
    if (riskAmount !== null && accountId) {
      const acc = await db.account.findUnique({ where: { id: accountId } })
      const balance = acc ? (acc.currentBalance > 0 ? acc.currentBalance : acc.startingBalance) : 0
      if (balance > 0) riskPercent = Math.round((riskAmount / balance) * 10000) / 100
    }
    // MT4 order number typed at entry — lets the EA's open/close events land
    // on this row (accountId+ticket) instead of creating a limbo duplicate.
    const ticket: number | null = body.ticket != null && parseInt(body.ticket) > 0 ? parseInt(body.ticket) : null

    const trade = await (db.trade.create as any)({
      data: {
        date: new Date(body.date),
        pair: body.pair,
        direction: body.direction,
        model: body.model,
        grade: body.grade,
        session: body.session,
        entryPrice: parseFloat(body.entryPrice),
        slPrice: parseFloat(body.slPrice),
        initialSlPrice: parseFloat(body.initialSlPrice ?? body.slPrice),
        tpPrice: parseFloat(body.tpPrice),
        closePrice: body.closePrice ? parseFloat(body.closePrice) : null,
        riskPercent,
        ...(riskAmount !== null && { riskAmount }),
        ...(accountId && { accountId }),
        ...(ticket !== null && { ticket }),
        resultR: body.resultR ? parseFloat(body.resultR) : null,
        resultPips: body.resultPips ? parseFloat(body.resultPips) : null,
        outcome: body.outcome || 'Open',
        reason: body.reason,
        notes: body.notes || null,
        screenshotUrl: body.screenshotUrl || null,
        strongCcy: body.strongCcy,
        weakCcy: body.weakCcy,
        divScore: body.divScore ? parseFloat(body.divScore) : null,
        tags: body.tags || [],
      },
    })
    return NextResponse.json(trade)
  } catch (err) {
    console.error('Trade create error:', err)
    return NextResponse.json({ error: 'Failed to create trade' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    const trade = await db.trade.update({
      where: { id },
      data: {
        ...updates,
        ...(updates.closePrice && { closePrice: parseFloat(updates.closePrice) }),
        ...(updates.resultR && { resultR: parseFloat(updates.resultR) }),
      },
    })
    return NextResponse.json(trade)
  } catch (err) {
    console.error('Trade update error:', err)
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 })
  }
}

// DELETE — accepts either `?id=<one>` query or `{ ids: string[] }` body for
// batch deletes. Used by the journal's multi-select toolbar and the account
// page's per-row Delete button.
//
// IdeaOutcome.tradeId and NewsWarning.tradeId reference Trade.id but were
// declared WITHOUT `@relation`, so Prisma doesn't auto-cascade. We have to
// orphan / wipe them by hand before deleting the parent, otherwise the user
// sees a generic "Failed to delete" with no clue what blocked it.
//
// Wrapped in a transaction so partial failures don't leave dangling pointers.
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const single = url.searchParams.get('id')
    let ids: string[] = []
    if (single) {
      ids = [single]
    } else {
      const body = await req.json().catch(() => ({}))
      if (Array.isArray(body?.ids)) ids = body.ids.filter((x: any) => typeof x === 'string')
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Provide id query or ids[] body' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      // Null out any IdeaOutcome rows that point at these trades so the idea
      // history stays — we just lose the "taken trade" link, which is the
      // right behavior when the trade itself was a phantom / cleanup.
      await (tx as any).ideaOutcome.updateMany({
        where: { tradeId: { in: ids } },
        data: { tradeId: null },
      })
      // NewsWarnings are scoped to the trade — if the trade is gone, the
      // warning row is meaningless, so cascade by hand.
      await (tx as any).newsWarning.deleteMany({
        where: { tradeId: { in: ids } },
      })
      // Now the actual trade rows — TradeModification + TradeAlignment cascade
      // automatically thanks to their `@relation onDelete: Cascade` clauses.
      return tx.trade.deleteMany({ where: { id: { in: ids } } })
    })

    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (err: any) {
    // Surface the actual Prisma error so future failures aren't a black box.
    console.error('Trade delete error:', err)
    return NextResponse.json({
      error: err?.message ?? 'Failed to delete trade(s)',
      code: err?.code,
    }, { status: 500 })
  }
}
