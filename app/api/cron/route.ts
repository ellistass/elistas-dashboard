// app/api/cron/route.ts
// Called by Vercel Cron at 07:30 WAT and 14:30 WAT daily
// WAT = UTC+1, so cron runs at 06:30 UTC and 13:30 UTC

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreCurrencies, formatTelegramAlert } from '@/lib/scoring'
import { sendTelegramMessage } from '@/lib/telegram'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request) {
  // Verify this is called by Vercel Cron
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hour = new Date().getUTCHours()
  const session = hour < 10 ? 'London' : 'New York'

  try {
    // Get today's stored alert data if already fetched
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const existing = await db.dailyAlert.findUnique({
      where: { date: today }
    })

    if (!existing?.rawCalendar) {
      // No data yet — send reminder to paste data
      await sendTelegramMessage(
        `⚠️ *RFDM — ${session} Alert*\n\nNo market data found for today.\n\n` +
        `Open the dashboard and paste today's data:\n${process.env.NEXT_PUBLIC_APP_URL}/alerts`
      )
      return NextResponse.json({ ok: true, message: 'No data — reminder sent' })
    }

    // Score currencies from stored data
    const result = scoreCurrencies(
      existing.rawCalendar || '',
      existing.rawPerf || '',
      existing.rawStddev || '',
    )

    // Format and send Telegram alert
    const message = formatTelegramAlert(result, session)
    const sent = await sendTelegramMessage(message)

    // Update alert record
    await db.dailyAlert.update({
      where: { date: today },
      data: {
        sentAt: new Date(),
        priority1: result.priority1 as any,
        pairs9: result.pairs9 as any,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
      }
    })

    return NextResponse.json({ ok: true, sent, session, priority: result.priority1.pair })
  } catch (err) {
    console.error('Cron error:', err)
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
