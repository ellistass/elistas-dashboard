// lib/normalize-ranking.ts
//
// Normalize a top3/bottom3 array from a scoring payload into the
// { cur, score, tag, ... } object shape the dashboard renders.
//
// Why this exists: the model returns top3/bottom3 as currency-code strings
// per the responseShape contract. The page render code (and matrix headers,
// and alignment checks) expect score objects. The legacy /api/alerts path
// went through lib/ai-scoring.ts which did this conversion; the routine/MCP
// save path skipped it, so saved rows rendered with empty currency columns.
//
// Used by:
//   • app/api/scoring/save/route.ts   (on write — persist structured shape)
//   • app/api/dashboard/route.ts      (on read — handles legacy string rows)
//
// Idempotent: passing an already-normalized array of objects returns the
// same objects. Passing strings looks up scores by currency code.

export type RankingItem = {
  cur: string
  score: number
  tag?: string
  confidence?: string
  notes?: string[]
  activeStrength?: boolean
  holiday?: boolean
}

/* Extract just the currency codes from a ranking array. Handles both
   shapes — plain strings (routine save before normalization) and score
   objects (legacy /api/alerts save, post-normalization rows). Used by
   list endpoints and the analysis history page where we only want codes,
   not the full score objects.
   Returns [] for any non-array input. */
export function extractCurrencies(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item: any) =>
      typeof item === 'string'
        ? item
        : (item?.cur ?? item?.currency ?? ''),
    )
    .filter((cur): cur is string => Boolean(cur))
}

export function normalizeRanking(input: unknown, scores: unknown): RankingItem[] {
  if (!Array.isArray(input)) return []
  const scoresArr: any[] = Array.isArray(scores) ? scores : []
  const lookup = (cur: string) =>
    scoresArr.find((s) => s?.currency === cur || s?.cur === cur)
  return input.map((item: any): RankingItem => {
    if (item && typeof item === 'object') {
      const cur = item.cur ?? item.currency ?? ''
      const score =
        typeof item.score === 'number' ? item.score
        : typeof item.total === 'number' ? item.total
        : (lookup(cur)?.total ?? lookup(cur)?.score ?? 0)
      return {
        cur,
        score,
        tag: item.tag ?? lookup(cur)?.tag,
        confidence: item.confidence ?? lookup(cur)?.confidence,
        notes: item.notes ?? lookup(cur)?.notes,
        activeStrength: item.activeStrength ?? lookup(cur)?.activeStrength,
        holiday: item.holiday ?? lookup(cur)?.holiday,
      }
    }
    if (typeof item === 'string') {
      const s = lookup(item)
      return {
        cur: item,
        score: s?.total ?? s?.score ?? 0,
        tag: s?.tag,
        confidence: s?.confidence,
        notes: s?.notes,
        activeStrength: s?.activeStrength,
        holiday: s?.holiday,
      }
    }
    return { cur: String(item ?? ''), score: 0 }
  })
}
