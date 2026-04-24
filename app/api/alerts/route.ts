// app/api/alerts/route.ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreCurrencies, scoreCurrenciesFromData, formatTelegramAlert } from '@/lib/scoring'
import { fetchAllMarketData } from '@/lib/fetchers'
import { sendTelegramMessage } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      mode = 'auto',          // 'auto' | 'manual'
      calendar, perf, stddev, futures,  // manual mode inputs
      sendAlert = false,
    } = body

    let result
    let fetchErrors: string[] = []

    if (mode === 'auto') {
      // ── Auto mode: fetch live from Barchart + ForexFactory ──────────────────
      const { perfMap, calEvents, errors } = await fetchAllMarketData()
      fetchErrors = errors

      if (Object.keys(perfMap).length === 0 && errors.length > 0) {
        // Both fetches failed — fall back to manual if data was provided
        if (perf || calendar) {
          result = scoreCurrencies(calendar || '', perf || '', stddev || '', futures || '')
          fetchErrors.push('Fell back to manual data due to fetch errors')
        } else {
          return NextResponse.json(
            { error: 'Auto-fetch failed and no manual data provided', details: errors },
            { status: 503 }
          )
        }
      } else {
        result = scoreCurrenciesFromData(perfMap, calEvents)
      }
    } else {
      // ── Manual mode: score from pasted text ─────────────────────────────────
      result = scoreCurrencies(calendar || '', perf || '', stddev || '', futures || '')
    }

    // ── Save to DB ─────────────────────────────────────────────────────────────
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    await db.dailyAlert.upsert({
      where: { date: today },
      create: {
        date: today,
        rawCalendar: mode === 'manual' ? calendar : null,
        rawPerf: mode === 'manual' ? perf : null,
        rawStddev: mode === 'manual' ? stddev : null,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
      },
      update: {
        rawCalendar: mode === 'manual' ? calendar : undefined,
        rawPerf: mode === 'manual' ? perf : undefined,
        rawStddev: mode === 'manual' ? stddev : undefined,
        top3: result.top3 as any,
        bottom3: result.bottom3 as any,
        pairs9: result.pairs9 as any,
        priority1: result.priority1 as any,
      },
    })

    // ── Optionally send Telegram ───────────────────────────────────────────────
    if (sendAlert && result.priority1) {
      const hour = new Date().getUTCHours()
      const session = hour < 10 ? 'London' : 'New York'
      const message = formatTelegramAlert(result, session)
      await sendTelegramMessage(message)
    }

    return NextResponse.json({ ...result, fetchErrors })
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
