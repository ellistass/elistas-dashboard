# RFDM Trading System

**Relative Flow Divergence Model** — Currency scoring, session alerts, trade journal, strategy analytics.

## What This Does

1. **Session Alerts** — Paste daily market data (economic calendar + forex performance + std dev table). System scores all currencies, finds top 3 strongest vs bottom 3 weakest, builds a 9-pair matrix with divergence scores, and outputs session-by-session alerts for Lagos time (WAT).

2. **Trade Journal** — Log every trade with pair, direction, Model A or B, grade, entry/SL/TP, entry reason, and screenshot. Close trades with outcome and auto-calculate result in R.

3. **Strategy Analytics** — Win rate by model, session, and grade. Equity curve. Model A vs B comparison. Auto-tracks which parts of the framework work.

4. **Telegram Alerts** — Cron fires at 7:30am and 2:30pm Lagos time (Mon-Fri), sends scored watchlist to your Telegram before each session.

---

## Deploy in 4 Steps

### Step 1 — Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/rfdm-trading.git
cd rfdm-trading
npm install
```

### Step 2 — Set up Supabase

1. Go to [supabase.com](https://supabase.com) → New project
2. Go to Settings → Database → copy the connection strings
3. Go to Storage → New bucket → name it `rfdm-trades` → set to Public
4. Go to Settings → API → copy the `anon` key and `service_role` key

### Step 3 — Set up Telegram Bot

1. Open Telegram → search `@BotFather`
2. Send `/newbot` → name it `RFDM Alerts` → username e.g. `rfdm_alerts_bot`
3. Copy the token it gives you
4. Start a chat with your bot, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Send any message to your bot, refresh the URL — copy the `chat.id` number

### Step 4 — Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy (follow prompts)
vercel

# Add environment variables
vercel env add DATABASE_URL
vercel env add DIRECT_URL
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_KEY
vercel env add TELEGRAM_BOT_TOKEN
vercel env add TELEGRAM_CHAT_ID
vercel env add CRON_SECRET
vercel env add NEXT_PUBLIC_APP_URL

# Push database schema
npx prisma db push

# Deploy to production
vercel --prod
```

Your app is live. Vercel will automatically run the cron jobs at:
- **06:30 UTC** (07:30 WAT Lagos) → London session alert
- **13:30 UTC** (14:30 WAT Lagos) → New York session alert

---

## Daily Workflow

**Morning (7am Lagos):**
1. Check Telegram — session alert already sent
2. Open app dashboard for full detail
3. Paste updated data if needed → hit Run Analysis

**Before each trade:**
1. Check the 9-pair matrix for your setup grade
2. Confirm A+ or B on the chart (HTF structure + H1 trap)
3. Declare Model A or B out loud before entry

**After each trade:**
1. Open /journal → Log Trade
2. Fill in pair, direction, model, grade, entry reason (one sentence), screenshot
3. Come back to close it with outcome when it hits TP/SL

**Weekly:**
1. Open /analytics
2. Check Model A vs B win rates
3. Check session performance
4. If one model is dragging — review those journal entries

---

## Framework Rules (built into the system)

- **Minimum R:R**: 1:2 before any entry
- **Max daily loss**: 2R — stop trading for the day
- **Grades**: A+ = full risk · B = half risk · C = watch only
- **Timing**: No entries 30min after session open
- **Candles**: Wait for full H1 candle close — always
- **Declaration**: Declare Model A or B before touching entry
- **Invalidation**: Price reclaims 50% of displacement candle = exit
- **Cutoff**: No new entries after 7pm Lagos time

---

## Tech Stack

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Database**: PostgreSQL via Supabase (Prisma ORM)
- **Storage**: Supabase Storage (trade screenshots)
- **Notifications**: Telegram Bot API
- **Deployment**: Vercel (auto-deploy on git push)
- **Scheduling**: Vercel Cron (fires before London + NY sessions)
- **Charts**: Recharts

---

## Environment Variables

See `.env.example` for all required variables.

```
DATABASE_URL          — Supabase pooled connection string
DIRECT_URL            — Supabase direct connection string  
NEXT_PUBLIC_SUPABASE_URL     — Your Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anon/public key
SUPABASE_SERVICE_KEY  — Supabase service role key (for uploads)
TELEGRAM_BOT_TOKEN    — From @BotFather
TELEGRAM_CHAT_ID      — Your Telegram chat ID
NEXT_PUBLIC_APP_URL   — Your Vercel app URL
CRON_SECRET           — Random string to secure cron endpoint
```
