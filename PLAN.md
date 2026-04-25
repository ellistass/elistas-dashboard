# Elistas Dashboard — Product Plan

> Last updated: April 2026  
> Stack: Next.js · Prisma · Supabase · Claude AI · Telegram  
> Sync: GitHub Actions (barchart-sync) → Supabase → Dashboard

---

## What is already production-ready

| Component | Status | Notes |
|---|---|---|
| Barchart sync (GitHub Actions) | ✅ Live | Runs Mon–Fri hourly + Sun 10pm–midnight WAT |
| Economic calendar sync | ✅ Live | ForexFactory weekly calendar via barchart-sync |
| Central bank rates sync | ✅ Live | USD live (Alpha Vantage) + others static config |
| RFDM scoring engine | ✅ Live | Claude AI, saves to DailyAlert |
| Telegram alerts | ✅ Live | Session alerts + trade alignment checks |
| Trade model + CRUD API | ✅ Live | Create / update / close trades |
| Trade alignment check | ✅ Live | Hourly check, Telegram warning on Amber/Red |
| Dashboard API | ✅ Live | Returns scores + open trades with alignment |
| Trades API + analytics | ✅ Live | Win rate, total R, by model/session/grade |

---

## What needs to be built

### Phase 1 — Foundation (build first, everything depends on this)
- [ ] Account model + migration
- [ ] Add `accountId` and `assetClass` to Trade model
- [ ] Accounts API (CRUD)
- [ ] Data freshness gate in cron (check BarchartSnapshot.fetchedAt before scoring)
- [ ] SyncHealth model + logging per cron run
- [ ] Telegram resend endpoint (no Claude call — DB read only)

### Phase 2 — Analysis upgrade
- [ ] Extend RFDM prompt to output multiple trade ideas (not just priority1)
- [ ] Add `fullAnalysis` and `ideas` Json fields to DailyAlert for the 10-section output
- [ ] Update scoring engine types and normalisation for multi-idea output
- [ ] Update cron and alerts routes to save extended output

### Phase 3 — UI
- [ ] Dashboard page (`/`) — daily briefing, sync status, scores, open trades, resend button
- [ ] Accounts page (`/accounts`) — account cards, drawdown bars, aggregate stats
- [ ] Journal page (`/journal`) — trade cards, Open/Closed tabs, filters, add/edit slide-out
- [ ] Analysis page (`/analysis`) — run analysis, 10-section output, pair matrix, send to Telegram
- [ ] Settings page (`/settings`) — Telegram config, sync health log, account management

### Phase 4 — Hardening (do after UI is stable)
- [ ] Fail hard on Supabase insert errors in barchart-sync (don't silently swallow)
- [ ] Reject empty snapshots before saving (min row count check)
- [ ] Add fetch timeouts + retry on economic.ts and rates.ts
- [ ] Update stale non-USD central bank rates in rates.ts
- [ ] Remove TWELVE_DATA_API_KEY from .env.example (replaced by Alpha Vantage)
- [ ] Parser test suite for Barchart response handling

---

## Data models

### Account (new)
```
id                      String   @id @default(cuid())
createdAt               DateTime @default(now())
name                    String                        // "FTMO #1", "My Funded Trader"
broker                  String                        // "FTMO", "MFF", "Pepperstone"
type                    String                        // "Prop" | "Live" | "Personal" | "Demo"
market                  String   @default("forex")    // "forex" | "futures" | "stocks" | "crypto"
status                  String                        // "Phase1" | "Phase2" | "Funded" | "Live" | "Passed" | "Failed" | "Breached" | "Archived"
currency                String   @default("USD")
startingBalance         Float
currentBalance          Float
profitTarget            Float?
maxDrawdownPct          Float                         // e.g. 10.0 for 10%
dailyDrawdownLimitPct   Float                         // e.g. 5.0 for 5%
currentDrawdownPct      Float    @default(0)
currentDailyDrawdownPct Float    @default(0)
payoutStatus            String   @default("None")     // "None" | "Requested" | "Paid"
notes                   String?
isActive                Boolean  @default(true)
trades                  Trade[]
```

### Trade (additions to existing model)
```
accountId           String?   // foreign key to Account (nullable for existing trades)
account             Account?  @relation(...)
assetClass          String    @default("forex")   // "forex" | "futures" | "stocks" | "crypto"
instrument          String?   // for non-forex: "ES", "AAPL", "BTC/USD" — mirrors pair for forex
preTradeNotes       String?   // written before entry
postTradeNotes      String?   // written after close
closeScreenshotUrl  String?   // second screenshot for post-trade review
```

> `pair` stays as the primary display field for forex.
> For other asset classes, `instrument` holds the ticker and `pair` can mirror it.
> `notes` stays for general use; `preTradeNotes` and `postTradeNotes` are structured review fields.

### DailyAlert (additions to existing model)
```
fullAnalysis  Json?   // full 10-section structured output from Claude
dataAge       Int?    // age of Barchart snapshot in minutes when analysis ran
ideas         Json?   // TradeIdea[] — multiple ranked setups, replaces single priority1
```

### SyncHealth (new)
```
id                   String   @id @default(cuid())
checkedAt            DateTime @default(now())
barchartAgeMinutes   Int?
economicAgeMinutes   Int?
ratesAgeMinutes      Int?
status               String   // "Fresh" | "Stale" | "Missing"
action               String   // "Scored" | "Skipped" | "Warning"
errors               String[]
```

---

## Analysis output — multi-idea format

The scoring engine returns multiple ranked trade ideas. `priority1` on DailyAlert
becomes the top item from the `ideas` array rather than a separate concept.

Each idea:
```typescript
interface TradeIdea {
  pair: string
  direction: "Long" | "Short"
  strong: string
  weak: string
  divergence: number
  grade: "A+" | "B" | "C" | "Skip"
  timeframe: "short-term" | "longer-term"
  session: string[]
  reason: string
  pricedInRisk: boolean      // true if fundamentals may already be reflected in price
  volumeWarning: boolean     // true if volume context warns of exhaustion
  confidence: "High" | "Medium" | "Low"
}
```

Full 10-section output Claude produces (stored in `fullAnalysis`):
```
1.  Market summary            — one paragraph, overall bias
2.  Strongest currencies      — top 3 with score, tag, and reason
3.  Weakest currencies        — bottom 3 with score, tag, and reason
4.  Best long ideas           — ranked list of long setups with grade
5.  Best short ideas          — ranked list of short setups with grade
6.  Short-term opportunities  — setups valid this session only
7.  Longer-term opportunities — setups valid across multiple sessions
8.  Open trade alignment      — each open trade: Green / Amber / Red + commentary
9.  Risks / priced-in warnings — currencies where the fundamental move may be exhausted
10. Clear action summary      — 3–5 bullet points, decision-oriented
```

---

## Extensibility — other asset classes

The system is designed to extend beyond forex without rebuilding.

**How it works:**
- `Account.market` and `Trade.assetClass` carry the asset class tag
- The scoring engine prompt is swappable per asset class
- Barchart sync already collects futures data — it's in the snapshot, unused for now
- Journal, accounts, and dashboard all filter by `assetClass`
- New asset class = new scoring prompt + new fetcher section, no structural changes needed

**Planned asset classes:**

| Class | Data source | Status |
|---|---|---|
| `forex` | Barchart (live) | ✅ Live |
| `futures` | Barchart (already collected) | 🔜 Scoring prompt needed |
| `stocks` | TBD (screener data source) | 🔜 Data source needed |
| `crypto` | TBD | 🔜 Data source needed |

**Extension pattern (one asset class = four steps):**
1. Add data source to barchart-sync (or a new sync service)
2. Add fetcher section in `lib/fetchers.ts`
3. Write an asset-class-specific scoring prompt
4. Wire into cron and alerts routes with `assetClass` param
5. UI renders identically — just different instruments

---

## Data freshness gate (cron protection)

Before any cron analysis run:

1. Query `BarchartSnapshot` for the latest row, read `fetchedAt`
2. Compute age: `Math.floor((Date.now() - fetchedAt.getTime()) / 60000)`
3. **If age > 90 minutes:**
   - Log to `SyncHealth`: status "Stale", action "Skipped"
   - Send Telegram: "⚠️ Barchart data is Xmin old — scoring skipped. Check GitHub Actions."
   - Return early — do NOT call Claude
4. **If age ≤ 90 minutes:**
   - Proceed with scoring
   - Save `dataAge` on the `DailyAlert` row
   - Log to `SyncHealth`: status "Fresh", action "Scored"

The 90-minute threshold covers one missed GitHub Actions run (which runs hourly).
This closes the silent failure window: green Action + stale data + confident Telegram alert.

---

## Telegram resend flow

Endpoint: `POST /api/alerts/resend`

1. Read latest `DailyAlert` where `sentAt` is not null
2. Determine session from current WAT time automatically (don't ask the user)
3. Format using `formatTelegramAlertAI(result, session)`
4. Send to Telegram
5. Update `sentAt` to `new Date()` on the DailyAlert row
6. Return `{ ok: true, pair: ideas[0].pair, session }`

**No Claude call. No market data fetch. Must be instant and free.**

Dashboard "Resend" button calls this endpoint and shows a success toast.
If no alert has been sent today, button is disabled with "No alert to resend."

---

## Daily workflow

**Morning (pre-London, ~7:30am WAT)**
- Open dashboard
- Check sync status indicator — is Barchart data fresh?
- Read overnight RFDM scores — any ranking shifts?
- Check open trade alignment badges — any Red or Amber?
- Review top trade ideas for the London session
- Hit "Resend" if scores look right → London alert goes to Telegram

**Pre-NY (~2:30pm WAT)**
- Cron re-runs automatically
- Dashboard shows updated scores
- Telegram alert already sent by cron

**Adding a trade**
- Journal → Add Trade → select account → fill details → write pre-trade reasoning → upload screenshot → submit
- Trade appears in Open Trades immediately with live alignment badge

**Closing a trade**
- Open Trades → Edit → fill close price, result R, outcome → write post-trade review → upload close screenshot → save
- Trade moves to Closed, account P&L updates

---

## Page structure

```
/                   Dashboard — daily briefing, sync status, scores, open trades
/accounts           All accounts, drawdown bars, aggregate equity + PnL
/accounts/[id]      Single account detail + trade history
/journal            Trade cards, Open/Closed tabs, full filter bar
/analysis           Run analysis, 10-section output, full pair matrix, Telegram send
/settings           Telegram config, sync health log, account management
```

---

## Build order

```
Step 1    Account model + accountId/assetClass on Trade (Prisma migration + db push)
Step 2    Accounts API (CRUD)
Step 3    Data freshness gate in cron + SyncHealth model + logging
Step 4    Telegram resend endpoint (/api/alerts/resend)
Step 5    Extend RFDM prompt — multi-idea output + 10-section fullAnalysis
Step 6    Update DailyAlert schema (fullAnalysis, ideas, dataAge)
Step 7    Dashboard UI
Step 8    Accounts UI
Step 9    Journal UI
Step 10   Analysis UI
Step 11   Settings UI
Step 12   Phase 4 hardening (barchart-sync robustness)
```

---

## Open decisions

**currentBalance on Account:** manually entered (broker-reported equity) vs computed from trades.
→ Recommendation: manually entered, but display computed P&L from trades alongside it so discrepancies are visible.

**Screenshot storage:** Supabase Storage bucket already referenced in the upload route.
Confirm bucket name and public URL pattern before building the journal UI.

**Multiple accounts per trade:** one trade = one account. A hedge across accounts = two trade entries. Keep it simple.

**Futures scoring:** RFDM rules don't apply directly to futures (no base/quote currency relationship). A separate scoring prompt is needed. The `assetClass` field is the switch that routes to the right prompt.

**Session detection for resend:** derive from current WAT time automatically.
London = 7am–2pm WAT, New York = 2pm–10pm WAT, Off-hours = anything else.
Don't ask the user — they shouldn't have to think about it.
