// NEW FILE app/api/macro/chart/route.ts — daily candles for any of the 28 pairs (Yahoo, e.g. GBPCAD=X), ~1 year.
import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const pair = new URL(req.url).searchParams.get('pair') ?? ''
  if (!/^[A-Z]{6}$/.test(pair)) return NextResponse.json({ error: 'pair like GBPCAD' }, { status: 400 })
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X?interval=1d&range=1y`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' })
  if (!r.ok) return NextResponse.json({ error: `Yahoo ${r.status}` }, { status: 502 })
  const res = (await r.json())?.chart?.result?.[0]
  const q = res?.indicators?.quote?.[0]
  if (!res || !q) return NextResponse.json({ error: 'no data' }, { status: 502 })
  const bars = (res.timestamp as number[]).map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i],
  })).filter(b => [b.o, b.h, b.l, b.c].every(v => typeof v === 'number'))
  return NextResponse.json({ pair, bars })
}
