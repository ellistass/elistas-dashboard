# MT4 auto-logging — setup guide

This EA logs every trade on the MT4 account to the Elistas dashboard. One EA per terminal — it watches the whole account, not just the chart it's attached to.

## What you need before installing

1. The MT4 terminal must be running on a machine with internet access.
2. You need the **API key** for the account from the dashboard (Accounts page → click the account → "Generate MT4 API key"). Each MT4 account gets its own key.
3. You need to know the **MT4 account number** (login number) — set it on the Account row before generating the API key, or the endpoint will reject events.

## Install steps (per terminal)

1. Open the MT4 data folder: **File → Open Data Folder**.
2. Copy `ElistasJournal.mq4` into `MQL4/Experts/`.
3. Back in MT4: **Navigator panel → Expert Advisors → right-click → Refresh**.
4. Allow the dashboard URL:
   - **Tools → Options → Expert Advisors**
   - Tick **Allow WebRequest for listed URL**
   - Add: `https://elistas-dashboard.vercel.app`
5. Drag the EA onto any chart (it doesn't matter which one — it watches every symbol).
6. In the EA settings dialog:
   - **ApiKey**: paste the per-account key from the dashboard
   - **SendScreenshots**: leave on (entry + close)
   - **CatchupHistoryDays**: how far back to sweep when the terminal starts up after being offline (default 14)
7. **Common tab → tick "Allow live trading"** → OK.
8. Check the smiley face is happy in the top-right corner of the chart.

## Verify it's working

- Open Experts tab at bottom of MT4 — you should see `[ElistasJournal] Starting for MT4 account ...`
- Open the dashboard `/journal` page — any open positions should appear within ~2 seconds.
- If you see `WebRequest error 4060` — the URL isn't in the allowed list (step 4).
- If you see `401 Unauthorized` in the logs — wrong API key, or the account isn't linked in the dashboard.

## Shadow terminal for phone-traded accounts

The EA can't run on MT4 mobile. For the FTMO account you trade from your phone, log into the **same account** from a second desktop MT4 terminal using the **investor password** (read-only). Attach the EA there with that account's API key. It sees every trade your phone places — without disturbing your trading.

Brokers like FTMO give you both passwords in the account email; if you've lost the investor password, you can reset it from the broker's client area.

## What gets auto-filled vs what you fill in yourself

**Auto-filled by the EA:**
- Pair, direction, lot size
- Entry price, SL, TP, close price
- Open/close times (broker server time)
- Account balance/equity at entry, lot size, risk %, commission, swap, P&L
- Entry and close chart screenshots
- Session (computed from open time in WAT)

**You still fill in (via the journal UI):**
- Strong currency / weak currency at entry
- Model A vs B (Wyckoff vs liquidity run)
- Setup grade (A+, B, C)
- Entry reason (one sentence)
- Pre- and post-trade notes
- Divergence score

Trades pending these fields show a yellow "complete this trade" badge in the journal.
