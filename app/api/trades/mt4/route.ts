// app/api/trades/mt4/route.ts — receives trade events from the MT4 Expert Advisor.
//
// Auth: Bearer token in Authorization header → matched against Account.apiKey.
//       Each MT4 terminal/account has its own apiKey — compromise of one doesn't expose the others.
//
// Three event types:
//   "open"    — order filled, create a Trade with outcome=Open
//   "close"   — order closed, update Trade with closePrice/closeTime/resultR
//   "modify"  — SL/TP updated, patch the existing Trade
//
// Idempotency: the (accountId, ticket) tuple is unique. Repeated POSTs for the same ticket
// upsert rather than duplicate — the EA can safely re-send during catchup.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  directionFromOrderType,
  normaliseSymbol,
  resultR,
  riskPercent,
  sessionFromUtcHour,
} from '@/lib/mt4'

export const dynamic = 'force-dynamic'

interface OpenEvent {
  event: 'open'
  ticket: number
  accountNumber: number
  symbol: string
  orderType: number          // 0=buy, 1=sell
  lotSize: number
  entryPrice: number
  slPrice: number
  tpPrice: number
  openTimeUtc: string        // ISO 8601
  accountBalance: number
  accountEquity: number
  pipValuePerLot: number     // broker-supplied, in account ccy per pip per 1.00 lot
  broker?: string
  comment?: string
  source?: 'realtime' | 'catchup'
}

interface CloseEvent {
  event: 'close'
  ticket: number
  accountNumber: number
  closePrice: number
  closeTimeUtc: string
  commission: number
  swap: number
  profitCcy: number
  // v2 EA sends live balance/equity on close too, so the account balance
  // updates the moment a trade settles — no manual balance edits needed.
  accountBalance?: number
  accountEquity?: number
  source?: 'realtime' | 'catchup'
}

// v2 EA heartbeat — keeps Account.currentBalance/currentEquity live even when
// no trades are opening or closing.
interface BalanceEvent {
  event: 'balance'
  accountNumber: number
  accountBalance: number
  accountEquity: number
}

interface ModifyEvent {
  event: 'modify'
  ticket: number
  accountNumber: number
  slPrice?: number
  tpPrice?: number
  // Optional but strongly recommended — the EA sends the previous value alongside
  // the new one so we can log it to TradeModification and (when initialSlPrice
  // is still null) backfill it from the first oldSlPrice we ever observe.
  oldSlPrice?: number
  oldTpPrice?: number
}

type Event = OpenEvent | CloseEvent | ModifyEvent | BalanceEvent

async function getAccountByBearer(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  return db.account.findFirst({ where: { apiKey: token, isActive: true } })
}

export async function POST(req: NextRequest) {
  const account = await getAccountByBearer(req)
  if (!account) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Event | { events: Event[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Allow batch posting for catchup
  const events: Event[] = Array.isArray((body as any).events)
    ? (body as any).events
    : [body as Event]

  const results: any[] = []
  // Track the freshest balance/equity seen in this batch — persisted once at the end.
  let latestBalance: number | null = null
  let latestEquity: number | null = null

  for (const e of events) {
    try {
      // Sanity: account number on the event must match the bearer-resolved account
      if ('accountNumber' in e && account.mt4AccountNumber && e.accountNumber !== account.mt4AccountNumber) {
        results.push({ ticket: (e as any).ticket, ok: false, error: 'Account mismatch' })
        continue
      }

      if (e.event === 'balance') {
        if (Number.isFinite(e.accountBalance)) latestBalance = e.accountBalance
        if (Number.isFinite(e.accountEquity)) latestEquity = e.accountEquity
        results.push({ ok: true, action: 'balance' })
      } else if (e.event === 'open') {
        const direction = directionFromOrderType(e.orderType)
        if (!direction) {
          results.push({ ticket: e.ticket, ok: false, error: `Pending order type ${e.orderType} not auto-logged` })
          continue
        }
        const { pair } = normaliseSymbol(e.symbol)
        const openDate = new Date(e.openTimeUtc)
        const risk = riskPercent({
          entryPrice: e.entryPrice,
          slPrice: e.slPrice,
          lotSize: e.lotSize,
          pipValuePerLot: e.pipValuePerLot,
          accountBalance: e.accountBalance,
          symbol: e.symbol,
        })
        if (Number.isFinite(e.accountBalance)) latestBalance = e.accountBalance
        if (Number.isFinite(e.accountEquity)) latestEquity = e.accountEquity

        // ── Placeholder auto-match ─────────────────────────────────────────
        // "Take" on the dashboard creates a placeholder row (entryPrice 0, no
        // ticket). If this open event has no row for its ticket yet, adopt the
        // newest matching placeholder — same account, same pair, same
        // direction, still ticketless, created in the last 12h — instead of
        // creating a duplicate. This is what keeps trades out of limbo.
        const alreadyByTicket = await (db.trade.findFirst as any)({
          where: { accountId: account.id, ticket: e.ticket },
          select: { id: true, entryPrice: true, riskAmount: true },
        })

        // Placeholder that already carries this ticket (typed in at take time):
        // fill in the real broker values. entryPrice===0 marks "never filled".
        if (alreadyByTicket && alreadyByTicket.entryPrice === 0) {
          const filled = await (db.trade.update as any)({
            where: { id: alreadyByTicket.id },
            data: {
              date: openDate,
              openTimeUtc: openDate,
              instrument: e.symbol,
              session: sessionFromUtcHour(openDate.getUTCHours()),
              entryPrice: e.entryPrice,
              slPrice: e.slPrice,
              initialSlPrice: e.slPrice,
              tpPrice: e.tpPrice,
              lotSize: e.lotSize,
              ...(alreadyByTicket.riskAmount == null && risk != null && { riskPercent: risk }),
            },
          })
          results.push({ ticket: e.ticket, ok: true, tradeId: filled.id, action: 'open', filledPlaceholder: true })
          continue
        }
        if (!alreadyByTicket && e.source !== 'catchup') {
          const placeholder = await (db.trade.findFirst as any)({
            where: {
              accountId: account.id,
              ticket: null,
              outcome: 'Open',
              entryPrice: 0,
              pair,
              direction,
              createdAt: { gte: new Date(Date.now() - 12 * 3600 * 1000) },
            },
            orderBy: { createdAt: 'desc' },
          })
          if (placeholder) {
            const adopted = await (db.trade.update as any)({
              where: { id: placeholder.id },
              data: {
                ticket: e.ticket,
                source: placeholder.source, // keep idea provenance
                date: openDate,
                openTimeUtc: openDate,
                instrument: e.symbol,
                session: sessionFromUtcHour(openDate.getUTCHours()),
                entryPrice: e.entryPrice,
                slPrice: e.slPrice,
                initialSlPrice: e.slPrice,
                tpPrice: e.tpPrice,
                lotSize: e.lotSize,
                // riskAmount typed at take time is authoritative — only fill
                // riskPercent from broker math when the user gave us nothing.
                ...(placeholder.riskAmount == null && risk != null && { riskPercent: risk }),
              },
            })
            results.push({ ticket: e.ticket, ok: true, tradeId: adopted.id, action: 'open', matchedPlaceholder: true })
            continue
          }
        }

        const trade = await (db.trade.upsert as any)({
          where: { accountId_ticket: { accountId: account.id, ticket: e.ticket } },
          create: {
            accountId: account.id,
            ticket: e.ticket,
            source: e.source === 'catchup' ? 'mt4-catchup' : 'mt4',
            date: openDate,
            openTimeUtc: openDate,
            pair,
            instrument: e.symbol,
            direction,
            // Empty for MT4-logged trades — user fills in via journal UI
            model: '',
            grade: '',
            strongCcy: '',
            weakCcy: '',
            session: sessionFromUtcHour(openDate.getUTCHours()),
            entryPrice: e.entryPrice,
            slPrice: e.slPrice,
            initialSlPrice: e.slPrice,    // freeze the original SL so R math survives BE moves / trails
            tpPrice: e.tpPrice,
            lotSize: e.lotSize,
            riskPercent: risk ?? 1.0,
            outcome: 'Open',
            reason: e.comment || 'Auto-logged from MT4 — add reasoning',
          },
          update: {
            // If catchup arrives after we already have the trade, don't overwrite user-added fields.
            // Crucially: do NOT touch initialSlPrice here — it must reflect the fill-time SL only.
            slPrice: e.slPrice,
            tpPrice: e.tpPrice,
            lotSize: e.lotSize,
          },
        })
        results.push({ ticket: e.ticket, ok: true, tradeId: trade.id, action: 'open' })
      } else if (e.event === 'close') {
        if (Number.isFinite(e.accountBalance as number)) latestBalance = e.accountBalance as number
        if (Number.isFinite(e.accountEquity as number)) latestEquity = e.accountEquity as number
        const existing = await (db.trade.findFirst as any)({
          where: { accountId: account.id, ticket: e.ticket },
        })
        if (!existing) {
          results.push({ ticket: e.ticket, ok: false, error: 'No open trade with this ticket' })
          continue
        }
        const closeDate = new Date(e.closeTimeUtc)
        // R must always be computed from the SL at fill, NOT the current SL.
        // If the trader moved SL to BE or trailed it, `existing.slPrice` has changed —
        // using it here would produce nonsense R values (BE-moved trades hit infinity/0).
        // Fall back to `slPrice` only for legacy rows logged before initialSlPrice existed.
        const slForR = existing.initialSlPrice ?? existing.slPrice
        const r =
          existing.entryPrice && slForR && e.closePrice && existing.direction
            ? resultR({
                entryPrice: existing.entryPrice,
                slPrice: slForR,
                closePrice: e.closePrice,
                direction: existing.direction as 'Long' | 'Short',
                symbol: existing.instrument || existing.pair,
              })
            : null
        const outcome =
          r === null ? 'Open' : r >= 0.1 ? 'Win' : r <= -0.1 ? 'Loss' : 'BE'

        await (db.trade.update as any)({
          where: { id: existing.id },
          data: {
            closePrice: e.closePrice,
            closeTimeUtc: closeDate,
            commission: e.commission,
            swap: e.swap,
            profitCcy: e.profitCcy,
            resultR: r ?? undefined,
            outcome,
          },
        })
        results.push({ ticket: e.ticket, ok: true, tradeId: existing.id, action: 'close', outcome, resultR: r })
      } else if (e.event === 'modify') {
        const existing = await (db.trade.findFirst as any)({
          where: { accountId: account.id, ticket: e.ticket },
        })
        if (!existing) {
          results.push({ ticket: e.ticket, ok: false, error: 'No trade with this ticket' })
          continue
        }

        // Build the audit-log rows for any field that actually changed.
        // We log only when both old + new are present and differ — that way
        // duplicate/no-op modify pings from the EA don't pollute the timeline.
        const auditRows: Array<{ field: string; oldValue: number; newValue: number }> = []
        if (
          e.slPrice !== undefined &&
          e.oldSlPrice !== undefined &&
          Number.isFinite(e.slPrice) && Number.isFinite(e.oldSlPrice) &&
          e.slPrice !== e.oldSlPrice
        ) {
          auditRows.push({ field: 'sl', oldValue: e.oldSlPrice, newValue: e.slPrice })
        }
        if (
          e.tpPrice !== undefined &&
          e.oldTpPrice !== undefined &&
          Number.isFinite(e.tpPrice) && Number.isFinite(e.oldTpPrice) &&
          e.tpPrice !== e.oldTpPrice
        ) {
          auditRows.push({ field: 'tp', oldValue: e.oldTpPrice, newValue: e.tpPrice })
        }

        // Backfill initialSlPrice for legacy rows. If the trade was opened
        // before the schema had this column, initialSlPrice is null — but the
        // EA's first observed `oldSlPrice` IS the prior state, which for a
        // realtime-tracked trade is the original fill-time SL. Once set, it's
        // never touched again.
        const shouldBackfillInitialSl =
          existing.initialSlPrice == null &&
          e.oldSlPrice !== undefined &&
          Number.isFinite(e.oldSlPrice)

        await (db.trade.update as any)({
          where: { id: existing.id },
          data: {
            ...(e.slPrice !== undefined && { slPrice: e.slPrice }),
            ...(e.tpPrice !== undefined && { tpPrice: e.tpPrice }),
            ...(shouldBackfillInitialSl && { initialSlPrice: e.oldSlPrice }),
            ...(auditRows.length > 0 && {
              modifications: { create: auditRows },
            }),
          },
        })
        results.push({
          ticket: e.ticket,
          ok: true,
          action: 'modify',
          recorded: auditRows.length,
          backfilledInitialSl: shouldBackfillInitialSl ? e.oldSlPrice : undefined,
        })
      }
    } catch (err: any) {
      results.push({ ticket: (e as any).ticket, ok: false, error: err.message ?? 'unknown' })
    }
  }

  // Persist the freshest balance/equity from this batch. MT4 is the source of
  // truth for balance on EA-synced accounts — this is what keeps
  // Account.currentBalance live without manual edits.
  await db.account.update({
    where: { id: account.id },
    data: {
      lastSyncedAt: new Date(),
      ...(latestBalance !== null && { currentBalance: latestBalance }),
      ...(latestEquity !== null && { currentEquity: latestEquity }),
    },
  })

  return NextResponse.json({ ok: true, results })
}

// GET — health check the EA can hit to confirm connectivity + auth
export async function GET(req: NextRequest) {
  const account = await getAccountByBearer(req)
  if (!account) return NextResponse.json({ ok: false }, { status: 401 })
  return NextResponse.json({
    ok: true,
    accountId: account.id,
    accountName: account.name,
    mt4AccountNumber: account.mt4AccountNumber,
    lastSyncedAt: account.lastSyncedAt,
  })
}
