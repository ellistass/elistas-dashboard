// app/api/accounts/[id]/api-key/route.ts
//
// Manage the MT4 Expert Advisor bearer token for a specific account.
//
//   GET   → reveal the current apiKey + mt4AccountNumber. Session-gated by
//           NextAuth middleware (the user must be logged into the dashboard).
//   POST  → rotate the key. Body may include mt4AccountNumber to set/update
//           the broker-assigned login number at the same time. Returns the
//           new key — once written into the EA's input parameter, the next
//           POST from the OLD key gets 401 (because the apiKey unique index
//           now points to a different account).
//
// Auth model recap:
//   • Each Account row has its own apiKey (unique). The EA endpoint
//     `/api/trades/mt4` matches the incoming Bearer header against any
//     account row.
//   • No global override key. If the apiKey field is null on an account,
//     no EA can post events for it. Generating one here is what activates
//     the MT4 integration for that account.
//   • mt4AccountNumber is a sanity check: when set, events from the EA
//     must report the same broker login number, otherwise the endpoint
//     rejects with "Account mismatch". Stops a misconfigured EA on one
//     account from polluting another.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user ? session : null
}

function newKey(): string {
  // 32 bytes → 64 hex chars. Roughly equivalent entropy to a 256-bit token.
  return randomBytes(32).toString('hex')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const acc = await db.account.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, broker: true,
      apiKey: true, mt4AccountNumber: true,
    },
  })
  if (!acc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(acc)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const mt4AccountNumber = body?.mt4AccountNumber

  const exists = await db.account.findUnique({ where: { id: params.id } })
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Guard against accidentally stealing another account's broker login.
  if (
    typeof mt4AccountNumber === 'number' &&
    Number.isFinite(mt4AccountNumber) &&
    mt4AccountNumber !== exists.mt4AccountNumber
  ) {
    const taken = await db.account.findFirst({
      where: { mt4AccountNumber, id: { not: params.id } },
      select: { id: true, name: true },
    })
    if (taken) {
      return NextResponse.json(
        { error: `MT4 account number ${mt4AccountNumber} already linked to ${taken.name}` },
        { status: 409 },
      )
    }
  }

  const apiKey = newKey()
  const updated = await db.account.update({
    where: { id: params.id },
    data: {
      apiKey,
      ...(typeof mt4AccountNumber === 'number' && Number.isFinite(mt4AccountNumber)
        ? { mt4AccountNumber }
        : {}),
    },
    select: {
      id: true, name: true, apiKey: true, mt4AccountNumber: true,
    },
  })

  return NextResponse.json({
    ...updated,
    note: 'Paste apiKey into the ApiKey input on the ElistasJournal EA. The previous key has been invalidated.',
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  // Revoke: clears apiKey. The EA will start getting 401s until a new key
  // is generated and pasted in. Used when an EA terminal is lost or the
  // key is suspected leaked.
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const updated = await db.account.update({
    where: { id: params.id },
    data: { apiKey: null },
    select: { id: true, name: true, apiKey: true },
  })
  return NextResponse.json(updated)
}
