# Wyckoff desk — full plan (v2)

Supersedes v1. Adds the page split, demo/backtest tracking, the read→trade link, and the notes log.
**Still plan only — no code written yet.**

---

## The core problem with `/wyckoff` today

One route renders five unrelated jobs stacked vertically: the benchmark, your triage, today's decisions, the resolved archive, and two drawers. Nothing is separated because nothing was ever given its own surface. That's why it reads as "everything just together" — it *is* everything, together.

**Fix: four sub-routes, one shared strip.**

```
┌─ Wyckoff ──────────────────────────────────────┐
│ you 62% · engine 41% · pass 38% · data 08-18 ⟳ │  ← sticky, on every surface
├────────────────────────────────────────────────┤
│ [Desk 3] [Watching 4] [Archive] [Score] [Practice]
└────────────────────────────────────────────────┘
```

| Route | One job | Contains |
|---|---|---|
| `/wyckoff` | **Decide today** | fresh candidates as chart cards, sorted by urgency. Nothing else. |
| `/wyckoff/watching` | **The queue** | Now/Later lanes as compact rows, alert hits floated up |
| `/wyckoff/archive` | **When did this happen** | setup timeline + resolved table + review replay |
| `/wyckoff/score` | **Am I improving** | benchmark, breakdowns by test/context/instrument, accuracy over time |
| `/wyckoff/practice` | **Am I ready** | demo progress vs go-live criteria, backtest runs |

Notes are a drawer (hotkey `n`) available on all five, with the log itself at `/wyckoff/notes`.

The desk becoming a single-purpose page is the whole point: you open it, you see only the things that need a decision today, you decide, it empties.

---

## What already exists (and should be reused, not rebuilt)

I audited the schema before designing anything. A lot of what you asked for is half-built already:

| You asked for | Already there | Gap |
|---|---|---|
| Demo tracking separate from live | `Account.type` = Prop \| Live \| Personal \| **Demo** | **Nothing filters by it.** `/api/analytics` filters by `accountId` but never by type — with no account selected it aggregates demo, prop and live into one number. Your live stats are already polluted. |
| Go-live criteria | `profitTarget`, `maxDrawdownPct`, `dailyDrawdownLimitPct`, `currentDrawdownPct`, `status` | no *readiness* criteria (min trades, min win rate, max violations) |
| "Was it followed" | `Trade.ruleViolations[]`, `Trade.behaviorFlags[]`, computed by `lib/analytics/detectors.ts`, surfaced in `RulesSplit` + `BehaviorFlags` | not connected to a Wyckoff read |
| "Did I enter on this read" | `Trade.ideaId` + `source: 'claude-idea'` — the exact pattern, already working for ideas | no equivalent for candidates |
| "When did this setup occur" | `ScannerCandidate` stores `scanDate`, `rangeStartDate`, `breakoutDate`, `outcomeAt`, `traderReadAt`, `alertHitAt` | the archive table displays **one** of them (`breakoutDate`) and can't sort by any |
| Notes | `Trade.notes`, `preTradeNotes`, `postTradeNotes`, `watchNote` | all attached to a thing — nowhere to write a standalone dated thought |

So three of your five asks are mostly wiring, not new construction.

---

## The three gaps you named

### 1 · "It doesn't show if I entered a trade based on my read, and if it was followed"

This is the most important thing in this document. Right now the Wyckoff page scores your *reading*, and the journal scores your *trading*, and they never meet — so you can't answer the question that actually matters: **do I make money on the reads I get right?**

The wiring, following the `ideaId` precedent exactly:

- `Trade.candidateId` → FK to `ScannerCandidate`, plus `source: 'wyckoff-read'`
- "Take this trade" on a locked read prefills the existing take-trade flow — instrument, direction with the 6C/6J/6S inversion already applied by `executeCall()`, entry, stop
- The read card then shows its own lifecycle: **read → taken → open → closed → result**

Then "was it followed" becomes four derived checks, three of which need no new data:

1. `ruleViolations[]` — already computed, just display it on the read
2. `behaviorFlags[]` — same
3. **entry/stop drift** — you locked `traderEntry` 1.0842, you filled at 1.0871. Drift shown in R.
4. **read contradiction** — you locked ACCUM and went short, or traded a PASS. Flagged loudly.

That fourth one is cheap to compute and, I'd guess, the most uncomfortable number on the page.

New scoreboard axis: not just "were you right", but **read right + traded it = +R** vs **read right + didn't take it = the cost of hesitation**.

### 2 · "The history is bad — no way to know when a particular setup occurred"

The archive is one flat table sorted by resolution, showing a single date column. Every "when did GBPUSD last do this" question requires scrolling.

Three changes:

- **Setup timeline** — the archive's default view. Horizontal time axis, one lane per instrument, each range drawn as a bar spanning `rangeStartDate → breakoutDate`, coloured by outcome, with a marker where you locked your read. Twelve months on one screen. "When did this setup last occur on 6E" becomes a glance.
- **Every date sortable and shown** — range start, breakout, your read, resolution. All four are already in the database and none are displayed except breakout.
- **Instrument view** — click a lane, get every range that instrument has ever formed, in sequence, with your hit rate on it.

### 3 · "Backtest progress must be separate from live trading"

Agreed, and it should never be a `Trade` row — mixing simulated fills into the table that computes your live P&L is how a journal becomes untrustworthy.

Two new models, fully isolated:

- **`PracticeRun`** — one locked run: kind (`trainer` \| `replay` \| `demo-period`), start/end, case count, and the resulting W/L, net R, PF, expectancy, max drawdown
- **`PracticeCase`** — one case within a run: instrument, your call, actual outcome, R, plus the trainer's context fields (`bars_stepped`, `springs_at_entry`, `upthrusts_at_entry`, `stopping_action`, `vol_ratio_at_entry`, `engine`, `aids`)

Import path: the trainer already exports exactly these columns to CSV. Drop the file on `/wyckoff/practice`, it parses and stores. Your 317-case ledger stops living in one browser's localStorage.

Because `PracticeCase` carries the same shape as a read, **the same breakdowns work on both** — "springs 7/8 in practice, 2/5 live" is one query.

---

## Demo progress

Two things, both leaning on what exists:

**Go-live criteria.** You set the bar per account; the page shows progress on each:

```
Demo · FTMO practice          ready in 3 of 6
─────────────────────────────────────────────
trades          38 / 50       ████████░░  76%
win rate        47% / 45%     ██████████  ✓
max drawdown    2.1R / 3R     ██████░░░░  ✓
rule violations 4 / ≤3        ███████░░░  ✗
read adherence  81% / 85%     ████████░░  ✗
profit          +12R / +20R   ██████░░░░  60%
```

Stored as a small JSON on `Account` — no new table.

**Demo equity + R curve**, drawn from the same `Trade` rows already synced by the EA, filtered to `type === 'Demo'`. The `EquityCurveCard` component in `/analytics` already renders this shape — it just needs the account-class filter.

**And the fix this exposes:** an account-class selector (All / Live / Prop / Demo) on `/analytics`, defaulting to **excluding Demo**. Your current numbers include demo trades in your live stats.

---

## Notes log

New `Note` model: `body`, `createdAt`, `tags[]`, optional `instrument`, optional `candidateId`, optional `tradeId`.

Written from a drawer on any surface (`n`), so a thought never requires navigating away. Filterable by instrument, tag, or date. When a note is tagged to a candidate it appears on that read; when tagged to an instrument it appears on every range that instrument forms afterwards — so "6E keeps absorbing at the lows" is in front of you the next time 6E prints a range.

---

## Build order

| Phase | Ships | You do | DB |
|---|---|---|---|
| **0** | MT4 close fix — outcome fallback, `??`→`\|\|`, EA remove-on-success, reverse reconciliation | recompile EA, deploy | — |
| **1** | `lib/chart/volume.ts` → both charts. Suspect instruments flat gray. Dots toggle + `aids`. | deploy | 1 col |
| **2** | **The split** — 5 routes, sticky strip, desk reduced to decisions only, compact watch rows | deploy | — |
| **3** | Chart thumbnails on cards · urgency sort · "why it's here" · freshness chip | `db:push`, deploy | 1 col |
| **4** | Archive rebuild — setup timeline, all four dates, instrument view | deploy | — |
| **5** | **Read → trade** — `candidateId`, take-trade prefill, adherence + drift + contradiction flags | `db:push`, deploy | 1 col |
| **6** | Score page — breakdowns, accuracy over time, read-vs-traded axis | deploy | — |
| **7** | Practice — `PracticeRun`/`PracticeCase`, trainer CSV import, go-live criteria, account-class filter on `/analytics` | `db:push`, deploy | 2 models |
| **8** | Notes — model, drawer, log | `db:push`, deploy | 1 model |
| **9** | Phase/event/confidence on the lock form · R preview · keyboard flow · mobile | `db:push`, deploy | 3 cols |

Phase 2 moved up. Splitting the page before adding anything to it means every later phase lands on a surface that already has room — otherwise I'd be adding timelines and criteria panels to a page you already find crowded.

---

## Open questions

1. **Go-live bar** — what are your actual numbers? Trades, win rate, max drawdown, adherence. I'll use the placeholders above until you say otherwise.
2. **Practice run scope** — should demo *trading* periods count as practice runs too, or is practice only trainer/replay work with demo living purely in the account view?
3. **Read contradiction** — do you want traded-against-your-own-read to be a hard warning at take time, or a silent flag you only meet in review?
