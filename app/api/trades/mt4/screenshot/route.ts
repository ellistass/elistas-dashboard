// app/api/trades/mt4/screenshot/route.ts — accepts a screenshot upload from the EA.
//
// EA workflow:
//   1. Detect trade open or close in MQL4
//   2. WindowScreenShot() saves PNG to MQL4/Files/
//   3. EA POSTs the file as multipart form-data here with ticket + phase ("entry" | "close")
//
// We resolve the account by bearer token, find the matching Trade, upload the PNG to Supabase
// Storage, and write the URL to screenshotUrl or closeScreenshotUrl.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const BUCKET = 'elistas-trades'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

async function authedAccount(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  return db.account.findFirst({ where: { apiKey: token, isActive: true } })
}

export async function POST(req: NextRequest) {
  const account = await authedAccount(req)
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const ticketRaw = form.get('ticket')
  const phase = (form.get('phase') as string) || 'entry' // "entry" | "close"

  if (!file || !ticketRaw) {
    return NextResponse.json({ error: 'Missing file or ticket' }, { status: 400 })
  }
  const ticket = parseInt(String(ticketRaw), 10)

  const trade = await (db.trade.findFirst as any)({
    where: { accountId: account.id, ticket },
  })
  if (!trade) return NextResponse.json({ error: 'No trade for ticket' }, { status: 404 })

  const ext = file.name.split('.').pop() || 'png'
  const path = `mt4/${account.id}/${trade.id}-${phase}.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: true })
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)

  await (db.trade.update as any)({
    where: { id: trade.id },
    data: phase === 'close'
      ? { closeScreenshotUrl: data.publicUrl }
      : { screenshotUrl: data.publicUrl },
  })

  return NextResponse.json({ ok: true, url: data.publicUrl })
}
