// app/api/accounts/[id]/sync-mode/route.ts
//
// Toggle what the EA does for a given account. The EA reads this on its next
// OnInit via /api/trades/mt4/state, so the user has to reload the chart for
// the change to take effect (cheap to do — Right-click chart → Expert
// Advisors → Properties → OK retriggers OnInit).
//
// Body: { syncMode: 'full' | 'realtime-only' | 'off' }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const ALLOWED = new Set(['full', 'realtime-only', 'off'])

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const mode = String(body?.syncMode ?? '')
    if (!ALLOWED.has(mode)) {
      return NextResponse.json({
        error: `Invalid syncMode "${mode}". Allowed: ${[...ALLOWED].join(', ')}`,
      }, { status: 400 })
    }
    const updated = await (db.account.update as any)({
      where: { id: params.id },
      data:  { eaSyncMode: mode },
      select: { id: true, name: true, eaSyncMode: true },
    })
    return NextResponse.json({ ok: true, account: updated })
  } catch (err: any) {
    console.error('sync-mode PATCH error:', err)
    return NextResponse.json({
      error: err?.message ?? 'Failed to update sync mode',
    }, { status: 500 })
  }
}
