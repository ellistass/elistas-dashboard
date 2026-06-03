// app/api/trades/mt4/state/route.ts
//
// EA hits this on every OnInit to find out what the server already knows.
// Makes the server the single source of truth for "what tickets have been
// catchup'd" — so when the dashboard wipes data the EA automatically detects
// the new highestTicket=0 and re-posts everything. No more stale local
// GlobalVariable watermarks blocking resync.
//
// Auth: same bearer-token flow the rest of /api/trades/mt4 uses.
//
// Response:
//   {
//     ok: true,
//     accountId, accountName, mt4AccountNumber,
//     highestTicket: number,            // max(ticket) across all trades for this account, or 0 if none
//     openTickets: number[]             // tickets currently marked outcome=Open (lets EA reconcile)
//   }
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

async function getAccountByBearer(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  return db.account.findFirst({ where: { apiKey: token, isActive: true } })
}

export async function GET(req: NextRequest) {
  const account = await getAccountByBearer(req)
  if (!account) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  // Highest ticket overall — the watermark the EA uses to skip already-POSTed
  // history rows. aggregate.max returns null when the account has no trades,
  // which is precisely the "wipe and resync" state we need to broadcast.
  const agg = await db.trade.aggregate({
    where: { accountId: account.id, ticket: { not: null } },
    _max: { ticket: true },
  })
  const highestTicket = agg._max.ticket ?? 0

  // Currently open tickets — lets the EA detect "opened while EA was off"
  // trades and post their open event proactively.
  const opens = await db.trade.findMany({
    where: { accountId: account.id, outcome: 'Open', ticket: { not: null } },
    select: { ticket: true },
  })
  const openTickets = opens.map((o) => o.ticket).filter((t): t is number => t != null)

  return NextResponse.json({
    ok: true,
    accountId: account.id,
    accountName: account.name,
    mt4AccountNumber: account.mt4AccountNumber,
    syncMode: (account as any).eaSyncMode ?? 'full',  // EA reads this and gates catchup/polling
    highestTicket,
    openTickets,
  })
}
