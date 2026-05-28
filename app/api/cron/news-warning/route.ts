// app/api/cron/news-warning/route.ts
// Every 15 minutes during trading hours, check open trades against the calendar.
// If a high-impact event for the trade's strong or weak currency lands in the
// next 2 hours, send a Telegram warning — once per (trade × event).
//
// Idempotency: a NewsWarning row is upserted on (tradeId, eventKey). If the row
// already exists we skip — so a 15-min cron never spams the same event twice.
//
// Auth: Bearer CRON_SECRET — same pattern as other crons.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { collisionsForTrade, loadCalendar } from '@/lib/dashboard-context'
import { sendTelegramMessage } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

function eventKey(e: { title: string; country: string; date: string }): string {
  return crypto.createHash('sha1').update(`${e.title}|${e.country}|${e.date}`).digest('hex').slice(0, 16)
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const [openTrades, calendar] = await Promise.all([
    db.trade.findMany({ where: { outcome: 'Open' } }),
    loadCalendar(),
  ])

  if (openTrades.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: 'No open trades' })
  }

  let sent = 0
  const skipped: string[] = []

  for (const trade of openTrades) {
    const collisions = collisionsForTrade(
      { pair: trade.pair, strongCcy: trade.strongCcy, weakCcy: trade.weakCcy },
      calendar,
      120, // 2-hour lookahead
    )
    for (const evt of collisions) {
      const key = eventKey(evt)
      // Skip if we've already warned about this (trade, event) pair
      const existing = await (db as any).newsWarning.findUnique({
        where: { tradeId_eventKey: { tradeId: trade.id, eventKey: key } },
      })
      if (existing) {
        skipped.push(`${trade.pair}/${evt.title}`)
        continue
      }

      const minsAway = Math.max(0, Math.floor((new Date(evt.date).getTime() - Date.now()) / 60000))
      const watTime = new Date(evt.date).toLocaleString('en-GB', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
      })

      const side = evt.currency === trade.strongCcy ? 'strong side' : 'weak side'
      const msg =
        `⚠️ *News collision*\n\n` +
        `Open trade: *${trade.pair} ${trade.direction === 'Long' ? '↑' : '↓'}*\n` +
        `Incoming: *${evt.currency} ${evt.title}* (${side})\n` +
        `When: ${watTime} WAT — in ${minsAway} min\n` +
        `Forecast: ${evt.forecast ?? '—'} | Previous: ${evt.previous ?? '—'}\n\n` +
        `Consider: tighten SL to breakeven, or close before the release.`

      try {
        await sendTelegramMessage(msg)
        await (db as any).newsWarning.create({
          data: {
            tradeId: trade.id,
            eventKey: key,
            eventAt: new Date(evt.date),
            currency: evt.currency,
            impact: evt.impact,
          },
        })
        sent++
      } catch (err) {
        console.error('[news-warning] Failed to send:', err)
      }
    }
  }

  return NextResponse.json({ ok: true, sent, skipped: skipped.length, openTrades: openTrades.length })
}
