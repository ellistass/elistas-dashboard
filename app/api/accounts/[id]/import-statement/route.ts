// app/api/accounts/[id]/import-statement/route.ts
//
// Bulk-import a broker statement CSV into an account. Used to seed the
// dashboard with the broker's authoritative history when the EA's view has
// gaps (offline periods, pre-install trades, EA-missed closes).
//
// Expected CSV format (FundedNext / cTrader-style export):
//   Ticket ID, Open Time, Open Price, Close Time, Close Price, Profit,
//   Lots, Commission, Swap, Symbol, Type, SL, TP, Pips, Volume
//
// Behavior:
//   • Upserts by (accountId, ticket). Re-import is safe — same ticket
//     becomes an update.
//   • On UPDATE we only overwrite broker-authoritative fields (prices,
//     times, P&L, commission, swap, lots, ticket-derived metadata). Any
//     user-added context (reason, notes, grade, model, tags, screenshots)
//     and EA-captured fields like initialSlPrice are preserved.
//   • On CREATE we set source='broker-statement' and also seed
//     initialSlPrice from the CSV's SL column — knowing it's the final SL
//     after any modifications, but it's the best anchor available. The
//     user can correct via the edit drawer.
//   • Returns { ok, summary: { created, updated, skipped, errors } }
//     and `errors[]` carries up to 20 row-level reasons for triage.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normaliseSymbol, resultR as computeR, sessionFromUtcHour } from '@/lib/mt4'

type Direction = 'Long' | 'Short'

interface ParsedRow {
  ticket: number
  openTimeUtc: Date
  closeTimeUtc: Date | null
  entryPrice: number
  closePrice: number | null
  profitCcy: number
  lotSize: number
  commission: number
  swap: number
  rawSymbol: string
  direction: Direction
  slPrice: number
  tpPrice: number
}

// Broker times. Two formats in the wild:
//   • FundedNext / cTrader-style: "2026.06.03 17:07:04" (dots)
//   • FTMO / MetaTrader-style:    "2026-06-01 15:15:02" (dashes, ISO-ish)
// Both stored as UTC.
function parseBrokerTime(s: string): Date | null {
  if (!s) return null
  const t = s.trim().replace(/^"|"$/g, '')   // FTMO wraps datetimes in quotes
  if (t === '' || t === 'Currently Running' || t === '0') return null

  // Try dotted format first
  let m = t.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/)
  // Fall back to dash/ISO format
  if (!m) m = t.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se))
}

function parseNum(s: string): number {
  const n = parseFloat(String(s ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

// Each supported broker format gets a column index map. We can't use a flat
// header→index lookup because FTMO has two columns literally named "Price"
// (one open, one close) — we need positional disambiguation.
interface ColumnMap {
  format:      'fundednext' | 'ftmo'
  ticket:      number
  openTime:    number
  closeTime:   number
  openPrice:   number
  closePrice:  number
  profit:      number
  lots:        number
  commission:  number
  swap:        number
  symbol:      number
  type:        number
  sl:          number
  tp:          number
}

// Inspect headers and figure out which broker emitted this CSV.
// Returns null if neither layout fits — the endpoint surfaces a clear error.
function detectColumns(headerCols: string[]): ColumnMap | null {
  const idx = (name: string) => headerCols.indexOf(name)
  const idxAll = (name: string) => {
    const out: number[] = []
    headerCols.forEach((h, i) => { if (h === name) out.push(i) })
    return out
  }

  // FundedNext: has a "Ticket ID" column and unique "Open Price"/"Close Price"
  if (idx('Ticket ID') >= 0 && idx('Open Price') >= 0 && idx('Close Price') >= 0) {
    return {
      format:     'fundednext',
      ticket:     idx('Ticket ID'),
      openTime:   idx('Open Time'),
      closeTime:  idx('Close Time'),
      openPrice:  idx('Open Price'),
      closePrice: idx('Close Price'),
      profit:     idx('Profit'),
      lots:       idx('Lots'),
      commission: idx('Commission'),
      swap:       idx('Swap'),
      symbol:     idx('Symbol'),
      type:       idx('Type'),
      sl:         idx('SL'),
      tp:         idx('TP'),
    }
  }

  // FTMO / MetaTrader: plain "Ticket", uses "Open" / "Close" for times, and
  // has TWO "Price" columns (first = open price, second = close price).
  const priceCols = idxAll('Price')
  if (idx('Ticket') >= 0 && priceCols.length >= 2 && idx('Open') >= 0 && idx('Close') >= 0) {
    return {
      format:     'ftmo',
      ticket:     idx('Ticket'),
      openTime:   idx('Open'),
      closeTime:  idx('Close'),
      openPrice:  priceCols[0],
      closePrice: priceCols[1],
      profit:     idx('Profit'),
      lots:       idx('Volume'),         // FTMO Volume = lots
      commission: idx('Commissions'),    // plural
      swap:       idx('Swap'),
      symbol:     idx('Symbol'),
      type:       idx('Type'),
      sl:         idx('SL'),
      tp:         idx('TP'),
    }
  }

  return null
}

// CSV row → typed shape, or null if essentials are missing.
function parseRow(cols: string[], cm: ColumnMap): ParsedRow | null {
  const get = (i: number) => (i >= 0 && i < cols.length) ? cols[i] : ''
  const ticket = parseInt(get(cm.ticket), 10)
  if (!Number.isFinite(ticket) || ticket <= 0) return null

  const openTime  = parseBrokerTime(get(cm.openTime))
  const closeTime = parseBrokerTime(get(cm.closeTime))
  if (!openTime) return null

  const typeRaw = (get(cm.type) || '').toLowerCase()
  const direction: Direction | null =
    typeRaw === 'buy' ? 'Long' : typeRaw === 'sell' ? 'Short' : null
  if (!direction) return null

  return {
    ticket,
    openTimeUtc:  openTime,
    closeTimeUtc: closeTime,
    entryPrice:   parseNum(get(cm.openPrice)),
    closePrice:   closeTime ? parseNum(get(cm.closePrice)) : null,
    profitCcy:    parseNum(get(cm.profit)),
    lotSize:      parseNum(get(cm.lots)),
    commission:   parseNum(get(cm.commission)),
    swap:         parseNum(get(cm.swap)),
    rawSymbol:    get(cm.symbol).trim(),
    direction,
    slPrice:      parseNum(get(cm.sl)),
    tpPrice:      parseNum(get(cm.tp)),
  }
}

// Very small CSV splitter — handles quoted fields with internal commas. The
// broker's export uses bare commas with no quoting (we checked), so this is
// mostly defensive.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let buf = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQuotes = !inQuotes; continue }
    if (c === ',' && !inQuotes) { out.push(buf); buf = ''; continue }
    buf += c
  }
  out.push(buf)
  return out
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const account = await db.account.findUnique({ where: { id: params.id } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

    // Strategy cutoff — the broker statement is the full account lifetime
    // but the user usually only cares about trades taken under their current
    // strategy. Anything BEFORE this date is treated according to preStrategyMode.
    //   • "skip"   — don't import at all (default — keeps stats clean)
    //   • "tag"    — import but tag with 'pre-strategy' so analytics can filter
    //   • "import" — bring everything in untagged (full history)
    const strategyStartRaw = (formData.get('strategyStartDate') as string) ?? ''
    const preStrategyMode = (formData.get('preStrategyMode') as string) || 'skip'
    const strategyStart = strategyStartRaw
      ? new Date(strategyStartRaw + 'T00:00:00Z')
      : null

    const text = await file.text()
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) return NextResponse.json({ error: 'Empty CSV' }, { status: 400 })

    // Header parsing: strip outer quotes and whitespace. FTMO double-quotes
    // a few of its headers (the "Trade duration in seconds" one); we don't
    // use that column so it's fine.
    const headerCols = splitCsvLine(lines[0]).map((s) => s.trim().replace(/^"|"$/g, ''))
    const cm = detectColumns(headerCols)
    if (!cm) {
      return NextResponse.json({
        error: `Unrecognized CSV layout. Expected a FundedNext or FTMO export. Got columns: ${headerCols.join(', ')}`,
      }, { status: 400 })
    }

    let created = 0, updated = 0, skipped = 0, preStrategySkipped = 0
    const errors: Array<{ ticket?: number; line: number; reason: string }> = []

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]).map((s) => s.replace(/^"|"$/g, ''))
      const row = parseRow(cols, cm)
      if (!row) { skipped++; continue }

      // Apply the pre-strategy cutoff. "skip" mode is the default — the user
      // doesn't want pre-strategy noise polluting analytics.
      const isPreStrategy = strategyStart != null && row.openTimeUtc < strategyStart
      if (isPreStrategy && preStrategyMode === 'skip') {
        preStrategySkipped++
        continue
      }

      try {
        const { pair } = normaliseSymbol(row.rawSymbol)

        // Compute R from the broker's prices. Note: SL here is the FINAL SL
        // (after any modifications), so R will be wrong for trades where you
        // moved SL. Dollar P&L is always correct. The user can recompute via
        // the drawer's "Recompute R from $" button for legacy rows.
        const r = (row.closePrice != null && row.entryPrice > 0 && row.slPrice > 0
                   && row.entryPrice !== row.slPrice)
          ? computeR({
              entryPrice: row.entryPrice,
              slPrice:    row.slPrice,
              closePrice: row.closePrice,
              direction:  row.direction,
              symbol:     row.rawSymbol,
            })
          : null

        // Outcome from realized P&L (more reliable than R given the SL caveat).
        const outcome = row.closeTimeUtc == null
          ? 'Open'
          : Math.abs(row.profitCcy) < 0.5
            ? 'BE'
            : row.profitCcy > 0 ? 'Win' : 'Loss'

        // ── Upsert by (accountId, ticket) ──
        // CREATE branch carries every field we know.
        // UPDATE branch is intentionally minimal — broker-authoritative
        // numbers only. Anything you've journaled stays.
        const existing = await (db.trade.findFirst as any)({
          where: { accountId: account.id, ticket: row.ticket },
          select: { id: true, initialSlPrice: true, source: true },
        })

        if (existing) {
          await (db.trade.update as any)({
            where: { id: existing.id },
            data: {
              date:         row.openTimeUtc,
              openTimeUtc:  row.openTimeUtc,
              closeTimeUtc: row.closeTimeUtc,
              entryPrice:   row.entryPrice,
              slPrice:      row.slPrice,
              tpPrice:      row.tpPrice,
              closePrice:   row.closePrice,
              lotSize:      row.lotSize,
              commission:   row.commission,
              swap:         row.swap,
              profitCcy:    row.profitCcy,
              outcome,
              ...(r != null && { resultR: r }),
              // Only seed initialSlPrice if it was null — never overwrite an
              // EA-frozen value or a user-corrected one.
              ...(existing.initialSlPrice == null && row.slPrice > 0 && {
                initialSlPrice: row.slPrice,
              }),
            },
          })
          updated++
        } else {
          await (db.trade.create as any)({
            data: {
              accountId:    account.id,
              ticket:       row.ticket,
              source:       'broker-statement',
              date:         row.openTimeUtc,
              openTimeUtc:  row.openTimeUtc,
              closeTimeUtc: row.closeTimeUtc,
              pair,
              instrument:   row.rawSymbol,
              direction:    row.direction,
              model:        '',
              grade:        '',
              session:      sessionFromUtcHour(row.openTimeUtc.getUTCHours()),
              strongCcy:    '',
              weakCcy:      '',
              entryPrice:   row.entryPrice,
              slPrice:      row.slPrice,
              initialSlPrice: row.slPrice > 0 ? row.slPrice : null,
              tpPrice:      row.tpPrice,
              closePrice:   row.closePrice,
              lotSize:      row.lotSize,
              commission:   row.commission,
              swap:         row.swap,
              profitCcy:    row.profitCcy,
              outcome,
              riskPercent:  1.0,                  // unknown from CSV — user can correct
              ...(r != null && { resultR: r }),
              reason:       'Imported from broker statement',
              tags:         isPreStrategy && preStrategyMode === 'tag'
                              ? ['broker-import', 'pre-strategy']
                              : ['broker-import'],
            },
          })
          created++
        }
      } catch (rowErr: any) {
        if (errors.length < 20) {
          errors.push({ ticket: row.ticket, line: i + 1, reason: rowErr?.message ?? 'unknown' })
        }
        skipped++
      }
    }

    return NextResponse.json({
      ok: true,
      summary: {
        format: cm.format,
        totalRows: lines.length - 1,
        created,
        updated,
        skipped,
        preStrategySkipped,
        errorCount: errors.length,
        strategyStart: strategyStart?.toISOString() ?? null,
        preStrategyMode,
      },
      errors,
    })
  } catch (err: any) {
    console.error('Statement import error:', err)
    return NextResponse.json({ error: err?.message ?? 'Import failed' }, { status: 500 })
  }
}
