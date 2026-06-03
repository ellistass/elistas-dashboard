// app/api/trades/merge/route.ts
//
// Merge one Trade into another, then delete the source.
//
// Use case: you logged a trade manually in /journal (writing your reason,
// notes, screenshots before the trade fired) and the EA later captured the
// same fill as a separate row with the broker prices + ticket. This endpoint
// folds your journal context into the EA-captured row so you end up with one
// clean record — broker prices on the outside, your reasoning on the inside.
//
// Direction is caller-decided: pass whichever row you want to KEEP as
// `targetId`, and the row to fold into it as `sourceId`. By default we copy
// every non-empty "context" field that the target doesn't already have set;
// pass `overwrite: true` to let the source clobber the target's existing
// values instead.
//
// Body:
//   {
//     sourceId: string,
//     targetId: string,
//     overwrite?: boolean,   // default false — only fill blanks on the target
//   }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Fields we consider "user context" — the journal-quality data that
// typically lives on a manual row and benefits the EA-captured one.
// Numerical and broker-stamped fields (prices, profit, ticket, lots) are
// intentionally NOT here — those should always come from the EA side.
const CONTEXT_FIELDS = [
  'reason',
  'notes',
  'preTradeNotes',
  'postTradeNotes',
  'model',
  'grade',
  'tags',
  'screenshotUrl',
  'closeScreenshotUrl',
  'session',
  'strongCcy',
  'weakCcy',
  'divScore',
] as const

function isEmpty(v: any): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sourceId, targetId } = body ?? {}
    const overwrite = body?.overwrite === true

    if (!sourceId || !targetId || sourceId === targetId) {
      return NextResponse.json({ error: 'sourceId and targetId required and must differ' }, { status: 400 })
    }

    const [source, target] = await Promise.all([
      db.trade.findUnique({ where: { id: sourceId } }),
      db.trade.findUnique({ where: { id: targetId } }),
    ])
    if (!source || !target) {
      return NextResponse.json({ error: 'sourceId or targetId not found' }, { status: 404 })
    }

    // Build the patch: copy each context field from source if (a) the source
    // has a non-empty value AND (b) the target's value is empty (or we're
    // in overwrite mode).
    const patch: Record<string, any> = {}
    for (const f of CONTEXT_FIELDS) {
      const srcVal = (source as any)[f]
      const tgtVal = (target as any)[f]
      if (isEmpty(srcVal)) continue
      if (overwrite || isEmpty(tgtVal)) {
        // Tags get unioned regardless of overwrite — merging journal context
        // shouldn't drop tags that were already there.
        if (f === 'tags' && Array.isArray(srcVal) && Array.isArray(tgtVal)) {
          patch.tags = Array.from(new Set([...(tgtVal as string[]), ...(srcVal as string[])]))
        } else {
          patch[f] = srcVal
        }
      } else if (f === 'tags' && Array.isArray(srcVal) && Array.isArray(tgtVal)) {
        // Union even in the non-overwrite path.
        patch.tags = Array.from(new Set([...(tgtVal as string[]), ...(srcVal as string[])]))
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Apply context merge to the target.
      const updated = await tx.trade.update({ where: { id: targetId }, data: patch })

      // Orphan IdeaOutcome rows pointing at the source so they don't get
      // orphan-deleted. Re-point them at the target instead — preserves the
      // "this idea was taken" link.
      await (tx as any).ideaOutcome.updateMany({
        where: { tradeId: sourceId },
        data: { tradeId: targetId },
      })

      // Wipe news warnings on the source — they were generated from the
      // source's open state and are no longer meaningful.
      await (tx as any).newsWarning.deleteMany({ where: { tradeId: sourceId } })

      // Delete the source. TradeModification + TradeAlignment cascade.
      await tx.trade.delete({ where: { id: sourceId } })

      return updated
    })

    return NextResponse.json({ ok: true, mergedFields: Object.keys(patch), trade: result })
  } catch (err: any) {
    console.error('Trade merge error:', err)
    return NextResponse.json({
      error: err?.message ?? 'Failed to merge trades',
      code: err?.code,
    }, { status: 500 })
  }
}
