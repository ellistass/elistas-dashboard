# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Is

**Elistas Dashboard** — RFDM (Relative Flow Divergence Model) trading dashboard for a forex trader based in Lagos, Nigeria (WAT = UTC+1). It scores 10 currencies using Claude AI, sends Telegram session alerts before London and New York sessions, and provides a trade journal + analytics.

Deployed at: `https://elistas-dashboard.vercel.app`

---

## Commands

```bash
npm run dev          # start local dev server on :3000
npm run build        # prisma generate + next build
npm run lint         # eslint check
npm run db:push      # push schema changes to Supabase (use after editing prisma/schema.prisma)
npm run db:studio    # open Prisma Studio GUI on :5555
```

**After any `prisma/schema.prisma` change**, always run `npm run db:push` — the Prisma client types won't reflect new fields until then. Until regenerated, use `(db.model.method as any)(...)` casts to bypass stale type errors.

---

## Architecture

### Data pipeline (read this first)

```
GitHub Actions (barchart-sync repo)
  └─ runs hourly Mon–Fri + Sun 10pm–midnight WAT
  └─ Playwright scrapes Barchart.com → writes to Supabase tables:
       barchart_snapshots   (forex + futures performance & std dev)
       economic_snapshots   (ForexFactory weekly calendar)
       rates_snapshots      (central bank interest rates)

Vercel Dashboard (this repo)
  └─ lib/fetchers.ts  → reads latest snapshot from each table via Prisma
  └─ lib/ai-scoring.ts → builds Claude prompt from raw data, calls API, normalises result
  └─ app/api/alerts/route.ts → triggers scoring, saves DailyAlert to DB
  └─ app/api/cron/route.ts  → Vercel cron fires at 06:30 UTC + 13:30 UTC (Mon–Fri)
```

The dashboard **never scrapes Barchart directly** — it only reads from the DB. The barchart-sync repo is a completely separate service.

### Key files

| File | Purpose |
|---|---|
| `lib/ai-scoring.ts` | Everything Claude-related: builds prompt, calls API, parses JSON response, normalises result. **The RFDM system prompt lives here.** |
| `lib/fetchers.ts` | Reads Supabase snapshots via Prisma, builds `perfMap`/`stddevMap` legacy maps (kept for reference), returns full `BarchartMarketData` for direct use |
| `lib/db.ts` | Prisma client singleton |
| `lib/telegram.ts` | `sendTelegramMessage(text)` — single export |
| `prisma/schema.prisma` | Full DB schema — source of truth for all models |
| `app/api/alerts/route.ts` | POST → run RFDM scoring + save DailyAlert + optional Telegram send |
| `app/api/alerts/resend/route.ts` | POST → resend last saved alert to Telegram (no Claude call) |
| `app/api/cron/route.ts` | Vercel cron handler — session alert + hourly alignment check |
| `app/api/market-data/raw/route.ts` | GET → inspect raw data exactly as Claude receives it |
| `app/api/debug/route.ts` | GET → last scoring run's prompt + raw Claude response (in-memory, wiped on restart) |
| `vercel.json` | Cron schedule config |

### Scoring engine (`lib/ai-scoring.ts`)

**Critical design decisions:**

1. **Raw pairs, not pre-aggregated**: Claude receives the full pair list (`GBPUSD: +0.22%`) — NOT per-currency averages. Pre-aggregation loses base/quote directional context (e.g. USD/CAD falling means CAD strong, not USD strong).

2. **No slicing**: All three tables (forex performance, forex surprises/std dev, futures) are sent in full — no `.slice(0, 10)`. Mid-table pairs carry critical signals.

3. **max_tokens: 8192**: The full RFDM response for 10 currencies + 9 pairs + ideas array easily exceeds 4096 tokens. Keep at 8192+.

4. **JSON parsing**: Claude sometimes wraps responses in ` ```json ``` ` fences. The parser strips fences, then falls back to first-brace/last-brace extraction. If JSON is truncated (incomplete response), it will always fail — increase `max_tokens`, not the parser.

5. **priority1 selection**: The RFDM framework defines the best setup as rank #1 strong × rank #1 weak currency. NOT highest divergence. Code finds that specific crossing in `ideas[]`, falls back to highest-divergence only if that crossing is absent.

6. **debugData persistence**: `debugLog` is an in-memory module variable — it's wiped on Vercel serverless restarts between requests. The full prompt + raw response is saved to `DailyAlert.fullAnalysis` (a `Json?` column) on every run, making it accessible in the analysis history even after server restarts.

### Prompt data shape (what Claude receives)

```
## FOREX PERFORMANCE — ALL PAIRS (raw — do not pre-aggregate; apply base/quote direction rules)
GBPUSD: +0.22%
EURUSD: +0.29%
USDCAD: -0.31%   ← USD weak (base), CAD strong (quote)
... all 35-40 pairs

## FOREX PRICE SURPRISES — ALL PAIRS (std dev; positive = unusually strong base)
GBPUSD: stddev=1.36 change=+0%
USDCAD: stddev=-1.05 change=-0%
... all 35-40 pairs

## FUTURES PERFORMANCE — ALL CONTRACTS
... all 50+ contracts

## ECONOMIC CALENDAR
[USD] [High] NFP — Actual: 177K | Forecast: 138K | Previous: 185K

## CENTRAL BANK INTEREST RATES
GBP (Bank of England): 4.75% (prev: 5%)
...
```

### Prisma / TypeScript gotcha

When new fields are added to `schema.prisma` and `db:push` hasn't been run in the current environment, TypeScript will reject calls to new fields. Pattern used throughout:

```typescript
await (db.dailyAlert.upsert as any)({
  where: { date: today },
  create: { ..., scoringModel: result.scoringModel, fullAnalysis: result.debugData as any },
  update: { ..., scoringModel: result.scoringModel },
})
```

### React fragments in tables

When rendering expandable rows inside `<tbody>`, use `<React.Fragment key={id}>` — anonymous `<>` fragments don't accept keys and cause React crashes in table contexts.

---

## Database models (summary)

| Model | Key columns |
|---|---|
| `DailyAlert` | `date` (unique), `top3/bottom3/pairs9` (Json), `ideas` (Json?), `fullAnalysis` (Json? — stores `{systemPrompt, userMessage, rawResponse, promptLength}`), `scoringModel`, `dataAge` |
| `Trade` | `pair`, `direction`, `outcome`, `strongCcy`, `weakCcy`, `accountId?`, `assetClass` |
| `Account` | `status` (Phase1/Phase2/Funded/Breached), `maxDrawdownPct`, `currentDrawdownPct`, `currentBalance` |
| `BarchartSnapshot` | `data` (Json — full `BarchartMarketData`), `errors`, `fetchedAt` |
| `EconomicSnapshot` | `events` (Json — `CalendarEvent[]`), `fetchedAt` |
| `RatesSnapshot` | `rates` (Json — `CentralBankRate[]`), `fetchedAt` |
| `HourlyScore` | `bucket` (rounded hour), `currency`, `score`, `top3/bottom3` — for alignment history |
| `SyncHealth` | `status` (Fresh/Stale/Missing), `action` (Scored/Skipped/Warning), `errors[]` |
| `TradeAlignment` | Per-check result for open trades (Green/Amber/Red) |

---

## Cron schedule

```
06:30 UTC (07:30 WAT) → London session alert — /api/cron?job=session
13:30 UTC (14:30 WAT) → New York session alert — /api/cron?job=session
```

Secured by `Authorization: Bearer CRON_SECRET` header.

Data freshness gate: if `BarchartSnapshot.fetchedAt` is > 90 minutes old, cron skips scoring and sends a warning Telegram message instead.

---

## Environment variables

```
DATABASE_URL                   Supabase pooled connection (pgbouncer)
DIRECT_URL                     Supabase direct connection (for migrations)
NEXT_PUBLIC_SUPABASE_URL       https://hjlnhkwxsicwpaetaiul.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  Supabase anon/public key
SUPABASE_SERVICE_KEY           Service role key (for uploads)
ANTHROPIC_API_KEY              Claude API key (sk-ant-...)
TELEGRAM_BOT_TOKEN             From @BotFather
TELEGRAM_CHAT_ID               Numeric chat ID
NEXT_PUBLIC_APP_URL            https://elistas-dashboard.vercel.app (or http://localhost:3000 locally)
CRON_SECRET                    Random string securing /api/cron
ALPHA_VANTAGE_API_KEY          IOYLDCU5X7SNXGCL
```

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — scores, open trades, account summary strip, sync status |
| `/analysis` | Paginated scoring history — click row to inspect prompt + Claude response in 4 tabs |
| `/accounts` | Account CRUD with drawdown bars, phase breakdown, aggregate equity |
| `/journal` | Trade log — free-text pair input, account selector, dark theme |
| `/data` | Paginated Barchart snapshot history — click row → `/data/[id]` for full detail |
| `/analytics` | Win rate by model/session/grade, equity curve |
