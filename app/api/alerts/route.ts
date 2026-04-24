// app/api/alerts/route.ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreCurrencies } from '@/lib/scoring'
import { sendTelegramMessage, } from '@/lib/telegram'
import { formatTelegramAlert } from '@/lib/scoring'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { calendar, perf, stddev, futures, sendAlert } = body

    // Score currencies
    const result = scoreCurrencies(calendar || '', perf || '', stddev || '', futures || '')

    // Save to DB
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    await db.dailyAlert.upsert({
      where: { date: today },
      create: {
        date: today,
        rawCalendar: calendar,
        rawPerf: perf,
        rawStddev: stddev,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
      },
      update: {
        rawCalendar: calendar,
        rawPerf: perf,
        rawStddev: stddev,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
      },
    })

    // Optionally send Telegram
    if (sendAlert) {
      const hour = new Date().getUTCHours()
      const session = hour < 10 ? 'London' : 'New York'
      const message = formatTelegramAlert(result, session)
      await sendTelegramMessage(message)
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('Alert error:', err)
    return NextResponse.json({ error: 'Failed to score' }, { status: 500 })
  }
}

export async function GET() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const alert = await db.dailyAlert.findUnique({ where: { date: today } })
  return NextResponse.json(alert || null)
}
