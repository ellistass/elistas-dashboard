// app/api/cron/route.ts
// Vercel Cron jobs:
//   - Session alerts: 7:30am WAT (06:30 UTC) + 2:30pm WAT (13:30 UTC) daily
//   - Hourly alignment: every hour

export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreCurrenciesFromData, formatTelegramAlert, checkTradeAlignment } from '@/lib/scoring'
import { fetchAllMarketData } from '@/lib/fetchers'
import { sendTelegramMessage } from '@/lib/telegram'

export async function GET(req: Request) {
  // Verify this is called by Vercel Cron (or our own schedule)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const jobType = searchParams.get('job') || 'session' // 'session' | 'alignment'

  if (jobType === 'alignment') {
    return runAlignmentCheck()
  }
  return runSessionAlert()
}

// ── Session alert job (7:30am + 2:30pm WAT) ─────────────────────────────────
async function runSessionAlert() {
  const hour = new Date().getUTCHours()
  const session = hour < 10 ? 'London' : 'New York'

  try {
    // Auto-fetch live market data
    const { perfMap, calEvents, errors } = await fetchAllMarketData()

    if (Object.keys(perfMap).length === 0) {
      // Fetch failed — send reminder
      await sendTelegramMessage(
        `⚠️ *Elistas — ${session} Alert*\n\n` +
        `Could not fetch market data automatically.\n` +
        `Errors: ${errors.join(', ')}\n\n` +
        `Open the dashboard to manually enter data:\n${process.env.NEXT_PUBLIC_APP_URL}`
      )
      return NextResponse.json({ ok: true, message: 'Fetch failed — reminder sent', errors })
    }

    const result = scoreCurrenciesFromData(perfMap, calEvents)

    // Save to DB
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    await db.dailyAlert.upsert({
      where: { date: today },
      create: {
        date: today,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
        sentAt: new Date(),
      },
      update: {
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
        sentAt: new Date(),
      },
    })

    // Save hourly snapshot
    await saveHourlySnapshot(result.allScores, result.top3.map(c => c.cur), result.bottom3.map(c => c.cur))

    // Format and send Telegram
    const message = formatTelegramAlert(result, session)
    const sent = await sendTelegramMessage(message)

    return NextResponse.json({
      ok: true,
      sent,
      session,
      priority: result.priority1?.pair,
      fetchErrors: errors,
    })
  } catch (err) {
    console.error('Session cron error:', err)
    return NextResponse.json({ error: 'Session cron failed' }, { status: 500 })
  }
}

// ── Hourly alignment check job ────────────────────────────────────────────────
async function runAlignmentCheck() {
  try {
    // Fetch fresh market data
    const { perfMap, calEvents, errors } = await fetchAllMarketData()
    if (Object.keys(perfMap).length === 0) {
      return NextResponse.json({ ok: true, message: 'Skipped — no market data', errors })
    }

    const currentScores = scoreCurrenciesFromData(perfMap, calEvents)

    // Save hourly snapshot
    await saveHourlySnapshot(
      currentScores.allScores,
      currentScores.top3.map(c => c.cur),
      currentScores.bottom3.map(c => c.cur)
    )

    // Get all open trades
    const openTrades = await db.trade.findMany({
      where: { outcome: 'Open' },
    })

    if (openTrades.length === 0) {
      return NextResponse.json({ ok: true, message: 'No open trades to check' })
    }

    const alerts: string[] = []

    for (const trade of openTrades) {
      const check = checkTradeAlignment(trade, currentScores)

      // Save alignment record
      await db.tradeAlignment.create({
        data: {
          tradeId: trade.id,
          status: check.status,
          strongStillTop3: currentScores.top3.some(c => c.cur === trade.strongCcy),
          weakStillBottom3: currentScores.bottom3.some(c => c.cur === trade.weakCcy),
          reason: check.reason,
        },
      })

      // Alert on Amber or Red
      if (check.status === 'Amber' || check.status === 'Red') {
        const emoji = check.status === 'Red' ? '🔴' : '🟡'
        alerts.push(
          `${emoji} *${trade.pair} ${trade.direction}*\n` +
          `${check.reason}\n` +
          `Entry: ${trade.entryPrice} · SL: ${trade.slPrice}`
        )
      }
    }

    if (alerts.length > 0) {
      const msg =
        `⚡ *Elistas — Trade Alignment Alert*\n` +
        `${new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' })} WAT\n\n` +
        alerts.join('\n\n') +
        `\n\nTop 3: ${currentScores.top3.map(c => c.cur).join(' · ')}\n` +
        `Bottom 3: ${currentScores.bottom3.map(c => c.cur).join(' · ')}`
      await sendTelegramMessage(msg)
    }

    return NextResponse.json({
      ok: true,
      openTrades: openTrades.length,
      alertsSent: alerts.length,
      fetchErrors: errors,
    })
  } catch (err) {
    console.error('Alignment cron error:', err)
    return NextResponse.json({ error: 'Alignment cron failed' }, { status: 500 })
  }
}

// ── Helper: save hourly score snapshot ────────────────────────────────────────
async function saveHourlySnapshot(
  allScores: Array<{ cur: string; score: number; pricePerf: number }>,
  top3: string[],
  bottom3: string[]
) {
  const bucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)

  const upserts = allScores.map(s =>
    db.hourlyScore.upsert({
      where: { bucket_currency: { bucket, currency: s.cur } },
      create: { bucket, currency: s.cur, score: s.score, pricePerf: s.pricePerf, top3, bottom3 },
      update: { score: s.score, pricePerf: s.pricePerf, top3, bottom3 },
    })
  )

  await Promise.all(upserts)
}
