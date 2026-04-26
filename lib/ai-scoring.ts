// lib/ai-scoring.ts
// RFDM Currency Scoring Engine — powered by Claude AI
// Replaces the old regex-based scoring with Claude intelligence

export interface AICurrencyScore {
  currency: string;
  total: number;
  fundamental: number;
  price: number;
  stddev: number;
  notes: string[];
  tag: string;
  activeStrength?: boolean;   // true = genuinely strong as base; false = passively strong
  confidence?: string;         // "High" | "Medium" | "Low" — score-level confidence
  holiday?: boolean;           // true = excluded due to public holiday
}

export interface AIPairSetup {
  pair: string;
  direction: "Long" | "Short";
  strong: string;
  weak: string;
  strongScore: number;
  weakScore: number;
  divergence: number;
  grade: "A+" | "B" | "C" | "Skip";
  session: string[];
  reason: string;
  timeframe?: "short-term" | "longer-term";
  pricedInRisk?: boolean;
  confidence?: "High" | "Medium" | "Low";
}

export interface AIScoringResult {
  reasoning?: string;           // Claude's full step-by-step reasoning before scoring
  scores: AICurrencyScore[];
  top3: string[];
  bottom3: string[];
  neutralCurrencies?: string[]; // currencies that failed ±1.5 threshold
  excludedCurrencies?: string[]; // currencies excluded (holiday, thin data)
  excludedReasons?: string[];    // one reason string per excluded currency
  pairs9: AIPairSetup[];
  ideas: AIPairSetup[];          // all ranked setups (A+, B, C) sorted by divergence
  priority1?: {                  // explicit top-level priority setup
    pair: string;
    direction: string;
    strong?: string;
    weak?: string;
    divergence: number;
    grade: string;
    reason: string;
  };
  divergenceWarnings: Array<string | { currency: string; type: string; warning: string }>;
  marketCondition?: string;       // "Normal" | "Thin" | "Holiday-heavy" | "High-volatility"
  sessionRecommendation?: string; // one sentence on what to focus on next session
  date: string;
}

// Normalised result that the rest of the app uses (matches existing interfaces)
export interface NormalisedScoringResult {
  top3: Array<{
    cur: string; score: number; fundamental: number;
    pricePerf: number; stdDev: number; tag: string; notes: string[];
  }>;
  bottom3: Array<{
    cur: string; score: number; fundamental: number;
    pricePerf: number; stdDev: number; tag: string; notes: string[];
  }>;
  pairs9: AIPairSetup[];
  ideas: AIPairSetup[];       // ranked setups — A+, B, C, sorted by divergence
  priority1: AIPairSetup;     // top idea (= ideas[0])
  allScores: Array<{
    cur: string; score: number; fundamental: number;
    pricePerf: number; stdDev: number; tag: string; notes: string[];
  }>;
  divergenceWarnings: string[];
  generatedAt: Date;
  scoringModel: string;
  // Context fields from Claude's reasoning
  reasoning?: string;
  neutralCurrencies?: string[];
  excludedCurrencies?: string[];
  excludedReasons?: string[];
  marketCondition?: string;
  sessionRecommendation?: string;
  // Persisted debug data — saved to DailyAlert.fullAnalysis so it survives server restarts
  debugData: {
    systemPrompt: string;
    userMessage: string;
    rawResponse: string;
    promptLength: number;
    allScores?: Array<{ cur: string; score: number; fundamental: number; pricePerf: number; stdDev: number; tag: string; notes: string[] }>;
    reasoning?: string;
    neutralCurrencies?: string[];
    excludedCurrencies?: string[];
    excludedReasons?: string[];
    marketCondition?: string;
    sessionRecommendation?: string;
  };
}

const RFDM_SYSTEM_PROMPT = `You are the RFDM (Relative Flow Divergence Model) currency scoring engine for a professional forex trader based in Lagos, Nigeria.

Your job is not just to follow rules mechanically. You must reason about what the data actually means — the same way an experienced institutional trader would read it. When data is ambiguous, thin, or conflicting, say so explicitly rather than forcing a clean answer that isn't there.

## CURRENCIES TO SCORE
USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, NOK, SEK

---

## WHAT YOU ARE READING AND WHY IT MATTERS

### Forex performance % change
This tells you where price actually moved today. But raw % change alone is not enough — a currency can appear to gain simply because the currency it's paired against is weak. Always ask: is this currency being actively bought, or is it passively rising because its counterpart is collapsing?

A currency is GENUINELY STRONG only if it appears as the BASE currency in at least 2 pairs that are moving in its favour. Example: GBP is genuinely strong if GBP/USD is up AND GBP/JPY is up AND GBP/CHF is up. That means someone is specifically buying GBP across multiple markets.

A currency is only PASSIVELY STRONG if it only gains as a quote currency against one weak base. Example: if USD is selling broadly, then EUR/USD, GBP/USD, AUD/USD, NZD/USD all rise — but that doesn't mean EUR, GBP, AUD and NZD are all being bought. Only the ones showing additional strength in other pairs are genuinely strong. Mark the rest as passive.

### Standard deviation / price surprises
This measures how unusual today's move is compared to the last 20 trading days. A std dev of +1.5 means today's move is 1.5 standard deviations above normal — statistically unusual, likely institutional. A std dev of +0.2 means barely above average — could be noise.

Rule of thumb:
- |std dev| > 1.0 = high confidence institutional move
- |std dev| 0.5–1.0 = moderate, needs corroboration from other pillars
- |std dev| < 0.5 = weak signal, treat as noise unless backed by strong fundamentals

### Economic calendar
Data releases tell you WHY a currency is moving, which determines whether the move is short-term or longer-term. A currency that beats expectations on a major release (GDP, employment, CPI) has a fundamental reason to stay strong for 1-5 days. A currency that's only moving on flow with no fundamental backing will likely fade within the session.

Critical distinction: If a currency BEATS its fundamental data (actual > expected) but price is FALLING — this is smart money distribution. Institutions are selling into good news while retail traders buy the headline. This is one of the most dangerous situations in forex. Flag it explicitly and never recommend trading in the direction of the fundamental.

### Futures data
Currency futures show institutional positioning. If a currency's futures contract is moving in the same direction as spot price — that confirms institutions are aligned. If futures diverge from spot — that's a warning sign.

Key futures contract mappings: B6M26 = GBP, D6M26 = CAD, EUR FX (6EM26) = EUR, Japanese Yen (6JM26) = JPY, DXM26 = USD Index, 6AM26 = AUD, 6NM26 = NZD, 6SM26 = CHF.

---

## SCORING RULES

Apply these in order. Each pillar adds to the total score.

### Pillar 1 — Fundamentals (weight 1.5×)
For every economic release:
- Identify which currency it belongs to
- Compare actual vs forecast (use previous if no forecast available)
- BEAT: +1.5 (high-impact event: +2.25)
- MISS: -1.5 (high-impact event: -2.25)
- IN-LINE: 0
- "Better" means: growth/spending/employment higher is better; unemployment/jobless claims lower is better; PMI above 50 = expansion, below 50 = contraction

### Pillar 2 — Price performance (weight 1.0×)
Use RAW PAIR DATA — not pre-aggregated per-currency averages. Process every pair in the full list.

For each pair:
- If UP: base currency gets +1.0, quote currency gets -0.5
- If DOWN: base currency gets -1.0, quote currency gets +0.5
- Scale by magnitude: per 0.1% move = ±0.5 contribution, cap at ±3.0 per currency total from this pillar

After calculating, apply the active vs passive filter:
- If a currency's positive score comes ONLY from being quote against weak bases → mark as passive, cap its price pillar contribution at +0.5 regardless of calculated score
- If a currency shows strength as BASE in 2+ pairs → keep the full calculated score

### Pillar 3 — Standard deviation (weight 0.8×)
Use RAW PAIR DATA — the full list, not top/bottom 10.

For each pair:
- Std dev > 0: base currency +0.8 (unusual strength)
- Std dev < 0: base currency -0.8 (unusual weakness)
- Scale by magnitude: |std dev| > 1.0 gets full weight; |std dev| 0.5–1.0 gets 0.6× weight; |std dev| < 0.5 gets 0.3× weight

### Pillar 4 — Futures (weight 0.5×)
- Futures performance UP: +0.5 to that currency
- Futures performance DOWN: -0.5 to that currency
- Futures price surprises (std dev): if a contract has high σ AND aligns with performance direction → add another +0.5 or −0.5 (total ±1.0 for that currency when both confirm)
- Only apply where futures directly correspond to a currency (use the contract mappings above)
- If futures direction OPPOSES spot price direction → flag as conflicting signal, do not add futures contribution

### Final score = sum of all pillar contributions

---

## RANKING RULES

Sort all currencies by total score descending.

**Minimum threshold to qualify as strong or weak:**
- A currency must score +1.5 or above to qualify as STRONG (top 3 candidate)
- A currency must score -1.5 or below to qualify as WEAK (bottom 3 candidate)
- Currencies scoring between -1.5 and +1.5 are NEUTRAL — do not include in top/bottom 3
- If fewer than 3 currencies clear the threshold on either side, return only the ones that qualify. State explicitly: "Only 1 currency qualifies as strong today — insufficient data for full top 3."

**Holiday / thin market rule:**
- If a currency's country has a public holiday, mark ALL scores for that currency as LOW CONFIDENCE
- Exclude it from the top/bottom 3 ranking entirely
- Do not generate trade ideas for it regardless of score
- Note the holiday explicitly in the scores array

**MANDATORY SELF-CHECK — run this before finalising the JSON:**

Read every entry you have placed in top3 and bottom3. For each one, read its notes field. If the notes contain ANY of these words or phrases:
- "passive" / "passively strong" / "passively weak"
- "below threshold"
- "neutral"
- "holiday" / "bank holiday" / "thin data"
- "excluded"
- "low confidence"
- "treat as neutral"
- "conflicting"

→ REMOVE that currency from top3 or bottom3 immediately
→ ADD it to neutralCurrencies instead
→ The ranking arrays must NEVER contradict the reasoning in the notes

This self-check is mandatory. A currency cannot simultaneously have a warning note and a top/bottom 3 ranking. If after the self-check fewer than 3 currencies remain in top3 or bottom3, that is correct — do not refill the slots with neutral or negative-scoring currencies. Return only what the data genuinely supports.

---

## 9-PAIR MATRIX

Cross every qualifying strong currency with every qualifying weak currency.

**Priority 1 rule:** Priority 1 is ALWAYS the #1 ranked strong currency crossed with the #1 ranked weak currency — regardless of divergence score. Do not select priority based on highest divergence.

**Divergence = |strongScore − weakScore|**

Grades:
- A+ = divergence ≥ 8.0 → full risk, all pillars aligned
- B = divergence ≥ 5.0 → half risk
- C = divergence ≥ 2.5 → watch only
- Skip = divergence < 2.5 or any blocker present

**For each pair, also assess:**
- timeframe: "short-term" if driven by today's data; "longer-term" if driven by rate differentials or sustained structural trend
- pricedInRisk: true if the fundamental data is already heavily reflected in price (move started 2+ days ago, std dev returning to normal)
- confidence: "High" (multiple pillars aligned, active strength confirmed), "Medium" (2 pillars aligned), "Low" (1 pillar or passive strength only)

---

## DIVERGENCE WARNINGS — DETECT THESE EXPLICITLY

These are the most important signals in the output. A trader acting on a warning can avoid a losing trade.

1. **Distribution warning:** Fundamental score positive BUT price score negative for same currency. State: "[CURRENCY] beats data but price falling — smart money distributing. Do NOT trade in fundamental direction."

2. **Passive strength warning:** Currency in top 3 but strength is passive (only gaining as quote vs weak USD/EUR). State: "[CURRENCY] passively strong — gaining from [WEAK BASE] weakness, not being actively bought. Lower confidence."

3. **Holiday warning:** Currency included with thin data. State: "[CURRENCY] scores unreliable — public holiday in [COUNTRY], low volume."

4. **Conflicting signals warning:** Std dev and price performance pointing in opposite directions for same currency. State: "Conflicting signals on [CURRENCY] — high std dev but negative price drift suggests unusual downside move, not strength."

5. **Insufficient ranking warning:** Fewer than 3 currencies clear the ±1.5 threshold. State: "Only [N] currencies qualify today. Matrix reduced. Wait for clearer conditions."

---

## WHAT TO DO WHEN DATA IS THIN

Saturday, Sunday, or holiday-heavy days will often produce weak signals. In these cases:

- Do not force a full 9-pair matrix if the data doesn't support it
- Reduce the matrix to only the qualifying pairs
- Increase the number of divergence warnings
- Lower confidence ratings across the board
- State clearly: "Today's data is thin. Highest confidence setup is [PAIR] but wait for Monday's session open and fresh scoring before entry."

This is more useful to a trader than a false sense of clarity.

---

## SESSION CONTEXT (Lagos / WAT time)

Include session relevance in each pair idea:
- Tokyo 1am–7am: AUD/JPY, NZD/JPY optimal
- London 8am–10am: GBP, EUR pairs optimal (prime window)
- Pre-NY 1pm–2pm: watch H4 pools being targeted
- New York 3pm–6pm: USD pairs optimal (prime window)
- No entries after 7pm Lagos
- No entries within 30 minutes of NY open

---

## CENTRAL BANK RATE CONTEXT

Use interest rate differentials to classify trade timeframe:
- Large rate differential (>2%) between strong and weak currency = supports longer-term trend
- Small rate differential (<1%) = timeframe driven by data flow, not carry
- Rate differential OPPOSING the flow direction = move may be short-lived

Current rates for reference (update as needed):
GBP: 4.75% | NOK: 4.5% | AUD: 4.1% | NZD: 3.75% | USD: 3.64% | EUR: 3.15% | CAD: 3.0% | SEK: 2.25% | CHF: 0.5% | JPY: 0.5%

---

## KNOWN FOREX PAIRS (use these exact formats)
USD/JPY, EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/CAD, USD/CHF,
EUR/GBP, EUR/JPY, GBP/JPY, AUD/JPY, NZD/JPY, EUR/AUD, GBP/AUD,
EUR/CAD, GBP/CHF, CAD/JPY, CHF/JPY, GBP/NZD, EUR/NZD, AUD/NZD,
AUD/CAD, NZD/CAD, NZD/CHF, AUD/CHF, CAD/CHF, USD/NOK, EUR/NOK,
USD/SEK, EUR/SEK

---

## OUTPUT FORMAT

Return ONLY valid JSON. No markdown, no explanation, no code fences. Exactly this structure.

**CRITICAL — reasoning field must be FIRST:**
Before populating any scored fields, write your complete reasoning in the "reasoning" field. Cover every judgement you made:
- Which currencies are genuinely vs passively strong and why
- Which currencies failed the ±1.5 threshold and why
- Which currencies are excluded (holiday) and why
- What the active vs passive filter concluded for each currency
- What the self-check found and what it moved to neutral

The "reasoning" field must be the first field in the JSON. All subsequent fields (scores, top3, bottom3, pairs9) must be consistent with what you wrote in reasoning. If you cannot make them consistent, fix the scored fields — not the reasoning. The reasoning is the ground truth.

{
  "reasoning": "Step-by-step: GBP appears as base in GBPUSD (+0.005%), GBPCHF (+0.003%), GBPJPY (+0.003%), GBPAUD (+0.002%) — four pairs as base all positive, stddev confirming on all four (1.36, 1.24, 0.73, 0.76). GBP is genuinely and actively bought. Score high. EUR gains as quote against USD in EURUSD but loses as base in EURGBP (-1.01σ) — partially passive, net slightly positive but below +1.5 threshold. NOK only gains as quote against weak USD in USDNOK — fully passive, score negative. Cannot be in top3. USD loses as base across 7+ pairs — systematic broad weakness, DXY -0.80σ confirms. Score deeply negative. NZD and AUD both on bank holiday — excluded entirely regardless of score. Self-check: EUR note says passive/below threshold → neutralCurrencies. NOK score is negative → neutralCurrencies. Final top3 contains only GBP. Final bottom3 contains only USD. Insufficient ranking warning triggered.",
  "scores": [
    {
      "currency": "GBP",
      "total": 5.5,
      "fundamental": 3.0,
      "price": 1.5,
      "stddev": 1.0,
      "activeStrength": true,
      "confidence": "High",
      "holiday": false,
      "notes": ["Retail Sales +0.7% vs 0.0% — massive beat", "Base in GBPUSD +1.36σ, GBPCHF +1.24σ, GBPJPY +0.73σ"],
      "tag": "Genuinely strong — active buying across 4 pairs"
    }
  ],
  "top3": ["GBP", "EUR", "CAD"],
  "bottom3": ["USD", "JPY", "NZD"],
  "neutralCurrencies": ["NOK", "SEK", "CHF"],
  "excludedCurrencies": ["AUD"],
  "excludedReasons": ["AUD: Bank Holiday — Australia"],
  "pairs9": [
    {
      "pair": "GBP/USD",
      "direction": "Long",
      "strong": "GBP",
      "weak": "USD",
      "strongScore": 5.5,
      "weakScore": -2.5,
      "divergence": 8.0,
      "grade": "A+",
      "session": ["London", "New York"],
      "reason": "GBP active strength across 4 pairs vs broad USD structural weakness. Rate differential 4.75% vs 3.64% supports.",
      "timeframe": "short-term",
      "pricedInRisk": false,
      "confidence": "High"
    }
  ],
  "ideas": [
    {
      "pair": "GBP/USD",
      "direction": "Long",
      "strong": "GBP",
      "weak": "USD",
      "strongScore": 5.5,
      "weakScore": -2.5,
      "divergence": 8.0,
      "grade": "A+",
      "session": ["London", "New York"],
      "reason": "GBP active strength across 4 pairs vs broad USD structural weakness. Rate differential 4.75% vs 3.64% supports.",
      "timeframe": "short-term",
      "pricedInRisk": false,
      "confidence": "High"
    }
  ],
  "priority1": {
    "pair": "GBP/USD",
    "direction": "Long",
    "strong": "GBP",
    "weak": "USD",
    "divergence": 8.0,
    "grade": "A+",
    "reason": "Highest ranked strong vs highest ranked weak"
  },
  "divergenceWarnings": [
    {
      "currency": "AUD",
      "type": "holiday",
      "warning": "AUD excluded — Australian public holiday, low volume, scores unreliable"
    }
  ],
  "marketCondition": "Normal",
  "sessionRecommendation": "London open is prime window — focus on GBP pairs, wait for 8am WAT H1 candle close for confirmation.",
  "date": "2026-04-26"
}

CRITICAL RULES:
- reasoning must be the FIRST field and must justify every decision that follows
- Include ALL 10 currencies in the scores array (even if score is 0). Sort scores by total descending.
- Include ALL pairs9 setups that are grade A+, B, or C in the ideas array (exclude Skip). Sort ideas by divergence descending.
- Every score entry must have activeStrength (boolean), confidence, and holiday (boolean) fields.
- Every idea must have timeframe, pricedInRisk, and confidence fields.
- divergenceWarnings must be an array of objects with currency, type, and warning fields.
- The self-check is mandatory — top3/bottom3 must never contradict the notes or reasoning.`;

// Model priority: use the same model Claude chat uses for consistent results
const DEFAULT_ANTHROPIC_MODELS = [
  process.env.ANTHROPIC_MODEL,   // override via ANTHROPIC_MODEL env var
  "claude-sonnet-4-6",           // primary — matches Claude chat
  "claude-opus-4-6",             // fallback if sonnet unavailable
  "claude-haiku-4-5-20251001",   // last resort
].filter((model): model is string => Boolean(model));

// Last prompt/response debug log — readable via GET /api/debug/prompt
export const debugLog: {
  model: string;
  promptLength: number;
  systemPrompt: string;
  userMessage: string;
  rawResponse: string;
  timestamp: string;
} = { model: "", promptLength: 0, systemPrompt: "", userMessage: "", rawResponse: "", timestamp: "" };

/**
 * Call Claude to score currencies from raw market data.
 * Supports both auto-fetched structured data and manual pasted text.
 */
export async function scoreWithClaude(input: {
  mode: "auto" | "manual";
  // Auto mode
  perfMap?: Record<string, number>;
  stddevMap?: Record<string, number>;
  calendarEvents?: Array<{
    title: string;
    country: string;
    impact: string;
    forecast: string | null;
    actual: string | null;
    previous: string | null;
  }>;
  centralBankRates?: Array<{
    currency: string;
    country: string;
    bankName: string;
    currentRate: number;
    previousRate: number | null;
  }>;
  barchart?: {
    forex: {
      performance: { today: { bullish: any[]; bearish: any[] } };
      surprises: { bullish: any[]; bearish: any[] };
    };
    futures: {
      performance: { today: { bullish: any[]; bearish: any[] } };
      surprises: { bullish: any[]; bearish: any[] };
    };
  } | null;
  // Open trades — sent so Claude can assess alignment and flag reversals
  openTrades?: Array<{
    pair: string;
    direction: string;
    strongCcy: string;
    weakCcy: string;
    entryPrice: number;
    slPrice: number;
    tpPrice?: number | null;
    grade: string;
    session: string;
    divScore?: number | null;
    date: string;
  }>;
  // Manual mode
  calendar?: string;
  perf?: string;
  stddev?: string;
  futures?: string;
}): Promise<NormalisedScoringResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Build the user message with all available data
  let userMessage = "";

  if (input.mode === "auto") {
    // ── 1. Forex performance — ALL raw pairs (no pre-aggregation) ───────────
    // Sending raw pairs preserves directional context: USD/CAD falling means
    // USD is the weak base and CAD is the strong quote. Pre-aggregation loses this.
    if (input.barchart?.forex.performance.today) {
      const bull = input.barchart.forex.performance.today.bullish;
      const bear = input.barchart.forex.performance.today.bearish;
      const allPairs = [...bull, ...bear].sort((a, b) => b.percentChange - a.percentChange);
      if (allPairs.length > 0) {
        userMessage += `## FOREX PERFORMANCE — ALL PAIRS (raw — do not pre-aggregate; apply base/quote direction rules)\n`;
        for (const r of allPairs) {
          userMessage += `${r.symbol}: ${r.percentChange > 0 ? "+" : ""}${r.percentChange}%\n`;
        }
        userMessage += "\n";
      }
    }

    // ── 2. Forex price surprises / std dev — ALL pairs (no slicing) ─────────
    if (input.barchart?.forex.surprises) {
      const bull = input.barchart.forex.surprises.bullish;
      const bear = input.barchart.forex.surprises.bearish;
      const allSurprises = [...bull, ...bear].sort(
        (a, b) => (b.standardDeviation ?? b.percentChange) - (a.standardDeviation ?? a.percentChange),
      );
      if (allSurprises.length > 0) {
        userMessage += `## FOREX PRICE SURPRISES — ALL PAIRS (std dev; positive = unusually strong base, negative = unusually weak base)\n`;
        for (const r of allSurprises) {
          const sd = r.standardDeviation ?? r.percentChange;
          userMessage += `${r.symbol}: stddev=${sd} change=${r.percentChange > 0 ? "+" : ""}${r.percentChange}%\n`;
        }
        userMessage += "\n";
      }
    }

    // ── 3. Futures performance — ALL contracts (no slicing) ─────────────────
    if (input.barchart?.futures.performance.today) {
      const bull = input.barchart.futures.performance.today.bullish;
      const bear = input.barchart.futures.performance.today.bearish;
      const allFutures = [...bull, ...bear].sort((a, b) => b.percentChange - a.percentChange);
      if (allFutures.length > 0) {
        userMessage += `## FUTURES PERFORMANCE — ALL CONTRACTS (Barchart — use for Futures Pillar)\n`;
        for (const r of allFutures) {
          userMessage += `${r.name || r.symbol}: ${r.percentChange > 0 ? "+" : ""}${r.percentChange}%\n`;
        }
        userMessage += "\n";
      }
    }

    // ── 4. Futures price surprises / std dev — ALL contracts (no slicing) ──────
    // High std dev on a futures contract = unusually large move → confirms
    // currency direction. e.g. USD Index futures with high σ confirms USD strength.
    if (input.barchart?.futures.surprises) {
      const bull = input.barchart.futures.surprises.bullish;
      const bear = input.barchart.futures.surprises.bearish;
      const allFuturesSurprises = [...bull, ...bear].sort(
        (a, b) => (b.standardDeviation ?? b.percentChange) - (a.standardDeviation ?? a.percentChange),
      );
      if (allFuturesSurprises.length > 0) {
        userMessage += `## FUTURES PRICE SURPRISES — ALL CONTRACTS (std dev; high σ = unusually large move, confirms momentum)\n`;
        for (const r of allFuturesSurprises) {
          const sd = r.standardDeviation ?? r.percentChange;
          userMessage += `${r.name || r.symbol}: stddev=${sd} change=${r.percentChange > 0 ? "+" : ""}${r.percentChange}%\n`;
        }
        userMessage += "\n";
      }
    }

    // ── 5. Economic calendar ─────────────────────────────────────────────────
    if (input.calendarEvents && input.calendarEvents.length > 0) {
      userMessage += `## ECONOMIC CALENDAR (auto-fetched from ForexFactory)\n`;
      for (const e of input.calendarEvents) {
        const status = e.actual
          ? `Actual: ${e.actual} | Forecast: ${e.forecast || "n/a"} | Previous: ${e.previous || "n/a"}`
          : `Not yet released | Forecast: ${e.forecast || "n/a"}`;
        userMessage += `[${e.country}] [${e.impact}] ${e.title} — ${status}\n`;
      }
      userMessage += "\n";
    }

    // ── 6. Central bank rates (context for divergence) ───────────────────────
    if (input.centralBankRates && input.centralBankRates.length > 0) {
      userMessage += `## CENTRAL BANK INTEREST RATES (context — use for divergence/carry analysis)\n`;
      const sorted = [...input.centralBankRates].sort((a, b) => b.currentRate - a.currentRate);
      for (const r of sorted) {
        const change = r.previousRate !== null && r.previousRate !== r.currentRate
          ? ` (prev: ${r.previousRate}%)`
          : "";
        userMessage += `${r.currency} (${r.bankName}): ${r.currentRate}%${change}\n`;
      }
      userMessage += "\n";
    }

    // ── 7. Open trades — alignment check ────────────────────────────────────
    // Claude uses this to assess whether each trade's thesis still holds
    // and flag reversals in reasoning / sessionRecommendation.
    if (input.openTrades && input.openTrades.length > 0) {
      userMessage += `## OPEN TRADES — ASSESS ALIGNMENT WITH TODAY'S SCORING\n`;
      userMessage += `For each trade below, after completing your scoring, assess:\n`;
      userMessage += `1. Is the strong currency still in your top 3? (Green if yes)\n`;
      userMessage += `2. Is the weak currency still in your bottom 3? (Green if yes)\n`;
      userMessage += `3. Flag any trade where the thesis has reversed (strong dropped out OR weak recovered).\n`;
      userMessage += `Include trade alignment assessment in your sessionRecommendation and reasoning.\n\n`;
      for (const t of input.openTrades) {
        const tp = t.tpPrice ? ` | TP: ${t.tpPrice}` : "";
        const div = t.divScore != null ? ` | Div: ${t.divScore.toFixed(1)}` : "";
        userMessage += `${t.pair} ${t.direction} | Strong: ${t.strongCcy} | Weak: ${t.weakCcy} | Entry: ${t.entryPrice} | SL: ${t.slPrice}${tp}${div} | Grade: ${t.grade} | Session: ${t.session} | Opened: ${t.date}\n`;
      }
      userMessage += "\n";
    }
  }

  if (input.mode === "manual" || userMessage.trim() === "") {
    if (input.calendar)
      userMessage += `## ECONOMIC CALENDAR (pasted)\n${input.calendar}\n\n`;
    if (input.perf)
      userMessage += `## FOREX PERFORMANCE TABLE (pasted)\n${input.perf}\n\n`;
    if (input.stddev)
      userMessage += `## STANDARD DEVIATION / PRICE SURPRISES (pasted)\n${input.stddev}\n\n`;
    if (input.futures)
      userMessage += `## FUTURES PERFORMANCE (pasted)\n${input.futures}\n\n`;
  }

  if (!userMessage.trim()) {
    throw new Error(
      "No market data provided — either paste data manually or wait for auto-fetch",
    );
  }

  userMessage += `\nToday's date: ${new Date().toISOString().split("T")[0]}\nCurrent time (WAT): ${new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })}\n\nScore all 10 currencies using the RFDM rules and return the JSON.`;

  let data: any = null;
  let lastError = "";
  let usedModel = "";

  for (const model of DEFAULT_ANTHROPIC_MODELS) {
    const requestBody = {
      model,
      max_tokens: 8192,
      system: RFDM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    };

    // 90-second timeout — Claude generating 8192 tokens can take 60-70s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    let res: globalThis.Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      // ECONNRESET / abort — retry with next model if available, otherwise throw
      lastError = `Claude fetch error (model: ${model}): ${fetchErr.message}`;
      console.warn(`[ai-scoring] ${lastError} — retrying…`);
      continue;
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await res.text();

    if (res.ok) {
      data = JSON.parse(rawText);
      usedModel = model;
      // Save debug log
      debugLog.model = model;
      debugLog.promptLength = RFDM_SYSTEM_PROMPT.length + userMessage.length;
      debugLog.systemPrompt = RFDM_SYSTEM_PROMPT;
      debugLog.userMessage = userMessage;
      debugLog.rawResponse = data.content?.[0]?.text || rawText;
      debugLog.timestamp = new Date().toISOString();
      break;
    }

    lastError = `Claude API error ${res.status} (model: ${model}): ${rawText}`;

    const modelMissing =
      res.status === 404 &&
      rawText.includes('"type":"not_found_error"') &&
      rawText.includes('"message":"model:');

    if (!modelMissing) {
      throw new Error(lastError);
    }
  }

  if (!data) {
    throw new Error(lastError || "Claude API error: no supported model available");
  }

  const text = data?.content?.[0]?.text || "";
  console.log(`[ai-scoring] Scored with model: ${usedModel} | prompt length: ${userMessage.length} chars`);

  // Parse JSON from response — robust extraction handles markdown, preamble, postamble
  let jsonStr = text.trim();

  // Strip markdown code fences
  if (jsonStr.includes("```")) {
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
  }

  // If there's text before the first { — strip it (Claude sometimes adds a sentence first)
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace  = jsonStr.lastIndexOf("}");
  if (firstBrace > 0) jsonStr = jsonStr.slice(firstBrace);
  if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) jsonStr = jsonStr.slice(0, lastBrace + 1);

  let parsed: AIScoringResult;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[ai-scoring] Claude returned invalid JSON.\nRaw (first 800 chars):", text.substring(0, 800));
    debugLog.rawResponse = text; // always save so prompt inspector shows the bad response
    debugLog.timestamp   = new Date().toISOString();
    throw new Error(`Claude returned invalid JSON — scoring failed. Check /api/debug for the raw response.`);
  }

  return normaliseResult(parsed, usedModel, {
    systemPrompt: RFDM_SYSTEM_PROMPT,
    userMessage,
    rawResponse:  debugLog.rawResponse,
    promptLength: RFDM_SYSTEM_PROMPT.length + userMessage.length,
  });
}

/**
 * Convert Claude's AI output to the normalised format the rest of the app expects.
 */
function normaliseResult(
  ai: AIScoringResult,
  _usedModel: string = "",
  _debugData?: { systemPrompt: string; userMessage: string; rawResponse: string; promptLength: number },
): NormalisedScoringResult {
  const allScores = ai.scores
    .map((s) => ({
      cur: s.currency,
      score: s.total,
      fundamental: s.fundamental,
      pricePerf: s.price,
      stdDev: s.stddev,
      tag: s.tag,
      notes: s.notes,
    }))
    .sort((a, b) => b.score - a.score);

  // Respect Claude's self-check: if it returned fewer than 3 in top3/bottom3 on a thin/holiday day,
  // do NOT pad — that deliberate reduction is the correct output. Only map scores to the
  // currencies Claude explicitly qualified.
  const top3 = allScores.filter((s) => ai.top3.includes(s.cur)).slice(0, 3);
  const bottom3 = allScores.filter((s) => ai.bottom3.includes(s.cur)).slice(0, 3);

  // Use the ideas array if Claude returned it; otherwise derive from pairs9
  // Filter out Skip grades and sort by divergence descending
  const rawIdeas: AIPairSetup[] = ai.ideas?.length
    ? ai.ideas
    : ai.pairs9.filter((p) => p.grade !== "Skip").sort((a, b) => b.divergence - a.divergence);

  const ideas = rawIdeas.filter((p) => p.grade !== "Skip");

  // priority1 = crossing of rank #1 strongest × rank #1 weakest currency
  // This is the correct RFDM definition: best setup is always the top strong vs top weak.
  // Falls back to highest-divergence idea if that exact crossing isn't in pairs9.
  const rank1Strong = ai.top3[0];
  const rank1Weak   = ai.bottom3[0];
  const priority1Setup: AIPairSetup =
    ideas.find((p) => p.strong === rank1Strong && p.weak === rank1Weak) ??
    ideas.sort((a, b) => b.divergence - a.divergence)[0] ??
    ai.pairs9[0] ?? {
      pair: ai.priority1?.pair || "N/A",
      direction: (ai.priority1?.direction as "Long" | "Short") || "Long",
      strong: rank1Strong || "",
      weak: rank1Weak || "",
      strongScore: top3[0]?.score || 0,
      weakScore: bottom3[0]?.score || 0,
      divergence: ai.priority1?.divergence || 0,
      grade: (ai.priority1?.grade as "A+" | "B" | "C" | "Skip") || "C",
      session: ["London", "New York"],
      reason: ai.priority1?.reason || "",
    };

  // Normalise divergenceWarnings — Claude may return strings or {currency,type,warning} objects
  const divergenceWarnings: string[] = (ai.divergenceWarnings || []).map((w) =>
    typeof w === "string" ? w : w.warning,
  );

  const contextFields = {
    reasoning:             ai.reasoning,
    neutralCurrencies:     ai.neutralCurrencies,
    excludedCurrencies:    ai.excludedCurrencies,
    excludedReasons:       ai.excludedReasons,
    marketCondition:       ai.marketCondition,
    sessionRecommendation: ai.sessionRecommendation,
  };

  return {
    top3,
    bottom3,
    pairs9: ai.pairs9,
    ideas,
    priority1: priority1Setup,
    allScores,
    divergenceWarnings,
    ...contextFields,
    generatedAt: new Date(),
    scoringModel: _usedModel,
    debugData: _debugData
      ? { ..._debugData, allScores, ...contextFields }
      : { systemPrompt: "", userMessage: "", rawResponse: "", promptLength: 0, allScores, ...contextFields },
  };
}

/**
 * Format alert message for Telegram
 */
export function formatTelegramAlertAI(
  result: NormalisedScoringResult,
  session: string,
): string {
  const { top3, bottom3, priority1, pairs9, divergenceWarnings } = result;
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const top3str = top3
    .map(
      (c, i) =>
        `${i + 1}. ${c.cur} ${c.score > 0 ? "+" : ""}${c.score.toFixed(1)} — ${c.tag}`,
    )
    .join("\n");
  const bot3str = bottom3
    .map(
      (c, i) =>
        `${i + 1}. ${c.cur} ${c.score > 0 ? "+" : ""}${c.score.toFixed(1)} — ${c.tag}`,
    )
    .join("\n");
  const aplus = pairs9
    .filter((p) => p.grade === "A+")
    .map((p) => `${p.pair} ${p.direction}`)
    .join(", ");
  const bGrade = pairs9
    .filter((p) => p.grade === "B")
    .map((p) => `${p.pair} ${p.direction}`)
    .join(", ");

  let msg = `🎯 *RFDM Alert — ${session} Session*\n📅 ${date}\n🤖 Scored by Claude AI\n\n`;
  msg += `*Strongest (Top 3)*\n${top3str}\n\n`;
  msg += `*Weakest (Bottom 3)*\n${bot3str}\n\n`;

  if (priority1) {
    msg += `*Priority Setup*\n📊 ${priority1.pair} ${priority1.direction} — Divergence: ${priority1.divergence.toFixed(1)} (${priority1.grade})\n${priority1.reason}\n\n`;
  }

  if (aplus || bGrade) {
    msg += `*Graded Setups*\n`;
    if (aplus) msg += `✅ A+: ${aplus}\n`;
    if (bGrade) msg += `⚡ B: ${bGrade}\n`;
    msg += "\n";
  }

  if (divergenceWarnings.length > 0) {
    msg += `*⚠️ Divergence Warnings*\n${divergenceWarnings.map((w) => `→ ${w}`).join("\n")}\n\n`;
  }

  msg += `*Reminder*\n→ Wait for H1 candle to fully close\n→ Declare Model A or B before entry\n→ Minimum R:R 1:2\n→ No entries 30min after session open`;

  return msg;
}
