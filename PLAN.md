# RFDM Trading App — Architecture & Deployment Plan

> **RFDM** = Risk · Fundamentals · Direction · Management
> A personal trading dashboard built around your SMC/RFDM framework —
> currency scoring, session alerts, trade journal, and analytics.

---

## Architecture Overview

```
Browser (Next.js 14 App Router)
        │
        ├── / (Session Alerts)       ← paste market data → score → 9-pair matrix
        ├── /journal                 ← log trades, upload screenshots
        └── /analytics               ← equity curve, win rate, model breakdown
              │
              ▼
        API Routes (/app/api/)
              │
        ├── /api/alerts   ← runs the scoring engine, sends Telegram
        ├── /api/trades   ← GET/POST/PATCH trade records
        ├── /api/upload   ← stores screenshots in Supabase Storage
        └── /api/cron     ← called by Vercel at 7:30am & 2:30pm WAT
              │
              ▼
        Supabase (PostgreSQL via Prisma)
        Supabase Storage (trade screenshots)
        Telegram Bot (session alert delivery)
```

---

## What Each Part Does

### 1. Session Alerts Dashboard (`/`)
The main tool you open every trading day.
- You paste in: economic calendar + forex performance table + std dev data + futures (optional)
- The **scoring engine** (`lib/scoring.ts`) processes all 4 inputs and scores 10 currencies
- It ranks **Top 3 strongest** vs **Bottom 3 weakest**
- Builds a **9-pair matrix** from all strong × weak combinations
- Grades each pair: **A+** (divergence ≥ 10) · **B** (≥ 6) · **C** (≥ 3)
- Surfaces the **Priority 1 setup** — highest divergence pair
- Shows **Session windows** in Lagos time (WAT): Tokyo · London · Pre-NY · New York
- One-click **Send to Telegram** button pushes the full alert to your phone

### 2. Currency Scoring Engine (`lib/scoring.ts`)
The brains of the app. Scores each currency (USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, NOK, SEK) across 4 pillars:

| Pillar | Weight | Source |
|---|---|---|
| Fundamental (news beats/misses) | 1.5× | Economic calendar |
| Price Performance | 1.5× | Forex performance table |
| Standard Deviation | 0.8× | Price surprise / std dev table |
| Futures | 0.5× | Futures data (optional) |

Final score = sum of all contributions. Higher = stronger currency.

### 3. Trade Journal (`/journal`)
- Log every trade with: pair, direction, model, grade, session, entry/SL/TP, strong/weak currency, divergence score, entry reason, notes
- Supports **Model A** (Wyckoff trap / spring-upthrust) and **Model B** (liquidity run / structure retest)
- Upload chart screenshots → stored in Supabase Storage
- Close trades inline → auto-calculates result in R
- Full trade history with colour-coded outcomes

### 4. Analytics (`/analytics`)
Built from your closed trade history:
- Overall win rate, total R, average R per trade
- **Equity curve** — cumulative R over time
- Win rate breakdown by **session** (London / New York / Tokyo)
- Win rate and total R by **grade** (A+ / B / C)
- **Model A vs Model B** head-to-head comparison
- RFDM checklist rules embedded at the bottom

### 5. Telegram Cron (`/api/cron`)
- Vercel runs this automatically at **7:30am WAT** (London session prep) and **2:30pm WAT** (NY session prep)
- If market data has been pasted into the dashboard that day → formats and sends the scoring result
- If no data yet → sends a reminder to open the dashboard

---

## Database Schema (Prisma → Supabase)

### `Trade`
Every trade you log. The core record.
```
id, date, pair, direction (Long/Short), model (A/B), grade (A+/B/C)
session, entryPrice, slPrice, tpPrice, closePrice
resultR, resultPips, outcome (Win/Loss/BE/Open)
reason, notes, screenshotUrl
strongCcy, weakCcy, divScore, tags[]
```

### `DailyAlert`
Stores each day's market data + scoring result.
```
date, top3, bottom3, pairs9, priority1
rawCalendar, rawPerf, rawStddev
sentAt, telegramMsgId
```

### `CurrencyScore`
Historical record of each currency's daily score.
```
date, currency, score, fundamental, pricePerf, stdDev, notes[]
```

---

## File Structure

```
rfdm-trading-app/
├── app/
│   ├── page.tsx              ← Session Alerts dashboard (main page)
│   ├── journal/page.tsx      ← Trade journal
│   ├── analytics/page.tsx    ← Analytics & charts
│   ├── layout.tsx            ← Nav, global styles
│   ├── globals.css           ← Tailwind base styles
│   └── api/
│       ├── alerts/route.ts   ← POST: run scoring engine
│       ├── trades/route.ts   ← GET/POST/PATCH trades
│       ├── upload/route.ts   ← POST: screenshot upload
│       └── cron/route.ts     ← GET: Vercel cron job
├── lib/
│   ├── scoring.ts            ← Currency scoring engine
│   ├── db.ts                 ← Prisma client singleton
│   ├── supabase.ts           ← Supabase client + file upload
│   └── telegram.ts           ← Telegram bot message sender
├── prisma/
│   └── schema.prisma         ← Database schema
├── vercel.json               ← Cron schedule (7:30am + 2:30pm WAT)
├── .env.local                ← Your secrets (never committed)
└── .env.example              ← Template for env vars
```

---

## Deployment Checklist

### Phase 1 — Supabase Setup
- [x] Create Supabase project (`rfdm-trading`, East US)
- [x] Get project URL and API keys
- [x] Set database password
- [x] Create storage bucket → **Storage → New bucket → `rfdm-trades` → Public**
- [x] Run `npx prisma db push` → creates Trade, DailyAlert, CurrencyScore tables

### Phase 2 — Telegram Bot
- [ ] Message @BotFather on Telegram → `/newbot`
- [ ] Save `TELEGRAM_BOT_TOKEN`
- [ ] Message your bot once, then visit `https://api.telegram.org/botYOUR_TOKEN/getUpdates`
- [ ] Save `TELEGRAM_CHAT_ID` from the response

### Phase 3 — Environment Variables
- [x] `DATABASE_URL` — Supabase PostgreSQL (with pgbouncer)
- [x] `DIRECT_URL` — Supabase PostgreSQL (direct)
- [x] `NEXT_PUBLIC_SUPABASE_URL`
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [x] `SUPABASE_SERVICE_KEY`
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `TELEGRAM_CHAT_ID`
- [ ] `CRON_SECRET` — run `openssl rand -hex 32` in Terminal
- [ ] `NEXT_PUBLIC_APP_URL` — your Vercel URL (after first deploy)

### Phase 4 — GitHub
- [ ] Create repo at github.com/new → `rfdm-trading-app` (Private)
- [ ] `git remote add origin https://github.com/YOUR_USERNAME/rfdm-trading-app.git`
- [ ] `git push -u origin main`

### Phase 5 — Vercel Deploy
- [ ] `npx vercel` in the project folder
- [ ] Add all env vars in Vercel dashboard → Settings → Environment Variables
- [ ] Redeploy after adding env vars
- [ ] Add `NEXT_PUBLIC_APP_URL` = your live Vercel URL, then redeploy once more

### Phase 6 — Verify
- [ ] Visit live URL → Session Alerts page loads
- [ ] Paste sample market data → Run Analysis → results appear
- [ ] Send to Telegram → message arrives on phone
- [ ] Log a test trade in Journal
- [ ] Check Analytics page shows the trade
- [ ] Confirm Vercel cron is listed under Project → Settings → Cron Jobs

---

## Your Daily Workflow (Once Live)

```
Morning (before London open ~8am WAT)
  1. Open the app dashboard
  2. Paste economic calendar (from Forex Factory / Trading Economics)
  3. Paste forex performance table (from Finviz / TradingView)
  4. Paste std dev table (from your usual source)
  5. Click "Run Analysis" → review Top 3 vs Bottom 3 + Priority setup
  6. Click "Send to Telegram" → alert hits your phone

During London / NY session
  → Use the Telegram alert as your watchlist
  → Confirm with HTF chart structure + H1 trap confirmation
  → Log every trade in /journal (even misses)

End of day
  → Close trades in journal → result auto-calculated in R
  → Check /analytics weekly to see Model A vs B, session performance
```

---

## Key Trading Rules Embedded in the App

| Rule | Where enforced |
|---|---|
| A+ = divergence ≥ 10, B = ≥ 6, C = ≥ 3 | `lib/scoring.ts` gradeSetup() |
| JPY pairs → Tokyo/London sessions | `lib/scoring.ts` getBestSession() |
| EUR/GBP pairs → London/NY sessions | `lib/scoring.ts` getBestSession() |
| Minimum R:R 1:2 reminder | Analytics checklist |
| No entries 30min after session open | Telegram alert + Analytics checklist |
| Wait for full H1 candle close | Telegram alert + Session card |
| Declare Model A or B before entry | Journal form — required field |
| Max daily loss 2R | Analytics checklist |
