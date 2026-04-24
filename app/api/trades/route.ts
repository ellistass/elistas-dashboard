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
    const trade = await db.trade.create({
      data: {
        date: new Date(body.date),
        pair: body.pair,
        direction: body.direction,
        model: body.model,
        grade: body.grade,
        session: body.session,
        entryPrice: parseFloat(body.entryPrice),
        slPrice: parseFloat(body.slPrice),
        tpPrice: parseFloat(body.tpPrice),
        closePrice: body.closePrice ? parseFloat(body.closePrice) : null,
        riskPercent: parseFloat(body.riskPercent || '1'),
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
