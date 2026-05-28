// app/api/scoring/request/route.ts
// Dashboard endpoint — user clicks "Trigger routine" → POST here enqueues a
// ScoringRequest. The routine picks it up on its next poll via
// /api/scoring/prompt-data?onlyIfRequested=true.
//
// Auth: NextAuth session (you must be signed in to request).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const reason = body?.reason ?? 'manual'

  // Don't queue if there's already a pending request — would just spam the routine.
  const existing = await (db as any).scoringRequest.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    return NextResponse.json({
      ok: true,
      enqueued: false,
      message: 'A request is already pending — the routine will pick it up on its next fire.',
      pendingId: existing.id,
      since: existing.createdAt,
    })
  }

  const row = await (db as any).scoringRequest.create({
    data: {
      reason,
      requestedBy: (session.user as any).id ?? 'user',
    },
  })
  return NextResponse.json({ ok: true, enqueued: true, id: row.id })
}

// GET — let the dashboard show "pending request waiting" badge
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pending = await (db as any).scoringRequest.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
  })
  const recent = await (db as any).scoringRequest.findFirst({
    where: { status: 'completed' },
    orderBy: { completedAt: 'desc' },
  })
  return NextResponse.json({ pending, lastCompleted: recent })
}
