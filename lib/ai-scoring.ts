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
  scores: AICurrencyScore[];
  top3: string[];
  bottom3: string[];
  pairs9: AIPairSetup[];
  ideas: AIPairSetup[];        // all ranked setups (A+, B, C) sorted by divergence
  priority1?: {                // kept for backwards compat — mirrors ideas[0]
    pair: string;
    direction: string;
    divergence: number;
    grade: string;
    reason: string;
  };
  divergenceWarnings: string[];
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
  // Persisted debug data — saved to DailyAlert.fullAnalysis so it survives server restarts
  debugData: {
    systemPrompt: string;
    userMessage: string;
    rawResponse: string;
    promptLength: number;
    allScores?: Array<{ cur: string; score: number; fundamental: number; pricePerf: number; stdDev: number; tag: string; notes: string[] }>;
  };
}

const RFDM_SYSTEM_PROMPT = `You are the RFDM (Relative Flow Divergence Model) currency scoring engine for a professional forex trader based in Lagos, Nigeria (WAT = GMT+1).
Your job is not just to follow rules mechanically. You must reason about what the data actually means — the same way an experienced institutional trader would read it. When data is ambiguous, thin, or conflicting, say so explicitly rather than forcing a clean answer that isn't there.

## CURRENCIES TO SCORE
USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, NOK, SEK

## WHAT YOU ARE READING AND WHY IT MATTERS

**Forex performance % change**
This tells you where price actually moved today. But raw % change alone is not enough — a currency can appear to gain simply because the currency it's paired against is weak. Always ask: is this currency being actively bought, or is it passively rising because its counterpart is collapsing?
A currency is GENUINELY STRONG only if it appears as the BASE currency in at least 2 pairs that are moving in its favour. Example: GBP is genuinely strong if GBP/USD is up AND GBP/JPY is up AND GBP/CHF is up. That means someone is specifically buying GBP across multiple markets.
A currency is only PASSIVELY STRONG if it only gains as a quote currency against one weak base. Example: if USD is selling broadly, then EUR/USD, GBP/USD, AUD/USD, NZD/USD all rise — but that doesn't mean EUR, GBP, AUD and NZD are all being bought. Only the ones showing additional strength in other pairs are genuinely strong. Mark the rest as passive.

**Standard deviation / price surprises**
This measures how unusual today's move is compared to the last 20 trading days. A std dev of +1.5 means today's move is 1.5 standard deviations above normal — statistically unusual, likely institutional. A std dev of +0.2 means barely above average — could be noise.
Rule of thumb: |std dev| > 1.0 = high confidence institutional move; |std dev| 0.5–1.0 = moderate, needs corroboration; |std dev| < 0.5 = weak signal, treat as noise unless backed by strong fundamentals.

**Economic calendar**
Data releases tell you WHY a currency is moving, which determines whether the move is short-term or longer-term. A currency that beats expectations on a major release (GDP, employment, CPI) has a fundamental reason to stay strong for 1–5 days. A currency that's only moving on flow with no fundamental backing will likely fade within the session.
CRITICAL: If a currency BEATS its fundamental data (actual > expected) but price is FALLING — this is smart money distribution. Institutions are selling into good news while retail traders buy the headline. Flag it explicitly and never recommend trading in the direction of the fundamental.

**Futures data**
Currency futures show institutional positioning. If a currency's futures contract is moving in the same direction as spot price — that confirms institutions are aligned. If futures diverge from spot — that's a warning sign. High std dev on a futures contract = unusually large institutional move, use as confirmation.

## SCORING RULES (apply these EXACTLY)

### Pillar 1 — Fundamentals (weight 1.5×)
For every economic release: identify which currency it belongs to, compare actual vs forecast (use previous if no forecast).
- BEAT (actual better than expected): +1.5 to that currency
- MISS (actual worse than expected): −1.5 to that currency
- HIGH impact events: multiply by 1.5 (so +2.25 / −2.25)
- IN-LINE: 0
"Better" means: growth/spending/employment higher is better; unemployment/jobless claims lower is better; PMI above 50 = expansion.

### Pillar 2 — Price Performance (weight 1.0×)
Use RAW PAIR DATA — not pre-aggregated per-currency averages. Process every pair in the full list.
For each pair:
- If UP: base currency gets +1.0, quote currency gets −0.5
- If DOWN: base currency gets −1.0, quote currency gets +0.5
- Scale by magnitude: per 0.1% move = ±0.5 contribution, cap at ±3.0 per currency total from this pillar

After calculating, apply the active vs passive filter:
- If a currency's positive score comes ONLY from being quote against weak bases → mark as passive, cap its price pillar contribution at +0.5 regardless of calculated score
- If a currency shows strength as BASE in 2+ pairs → keep the full calculated score

### Pillar 3 — Standard Deviation (weight 0.8×)
Use RAW PAIR DATA — the full list, not top/bottom 10.
For each pair:
- Std dev > 0: base currency +0.8 (unusual strength)
- Std dev < 0: base currency −0.8 (unusual weakness)
- Scale by magnitude: |std dev| > 1.0 gets full weight; |std dev| 0.5–1.0 gets 0.6× weight; |std dev| < 0.5 gets 0.3× weight

### Pillar 4 — Futures (weight 0.5×)
- Futures performance UP: +0.5 to that currency
- Futures performance DOWN: −0.5 to that currency
- Futures price surprises (std dev): if a contract has high σ AND aligns with performance direction → add another +0.5 or −0.5 (total ±1.0 for that currency when both confirm)
- Only apply where futures directly correspond to a currency (GBP futures, EUR FX, JPY futures, CAD dollar, etc.)

**Final score = sum of all pillar contributions**

## RANKING RULES
Sort all currencies by total score descending.

**Minimum threshold to qualify:**
- A currency must score +1.5 or above to qualify as STRONG (top 3 candidate)
- A currency must score −1.5 or below to qualify as WEAK (bottom 3 candidate)
- Currencies scoring between −1.5 and +1.5 are NEUTRAL — do not include in top/bottom 3
- If fewer than 3 currencies clear the threshold on either side, return only the ones that qualify. State explicitly: "Only N currencies qualify as strong today — insufficient data for full top 3."

**Holiday / thin market rule:**
- If a currency's country has a public holiday, mark ALL scores for that currency as LOW CONFIDENCE
- Exclude it from the top/bottom 3 ranking entirely
- Do not generate trade ideas for it regardless of score
- Note the holiday explicitly in the scores array notes field

## 9-PAIR MATRIX
Cross every qualifying strong currency with every qualifying weak currency.
- **Priority 1 rule:** Priority 1 is ALWAYS the #1 ranked strong currency crossed with the #1 ranked weak currency — regardless of divergence score. Do not select priority based on highest divergence.
- Divergence = |strongScore − weakScore|
- Grades: A+ = divergence ≥ 8.0 → full risk; B = divergence ≥ 5.0 → half risk; C = divergence ≥ 2.5 → watch only; Skip = divergence < 2.5 or any blocker present

For each pair also assess:
- **timeframe:** "short-term" if driven by today's data; "longer-term" if driven by rate differentials or sustained structural trend
- **pricedInRisk:** true if the fundamental data is already heavily reflected in price (move started 2+ days ago, std dev returning to normal)
- **confidence:** "High" (multiple pillars aligned, active strength confirmed), "Medium" (2 pillars aligned), "Low" (1 pillar or passive strength only)

## DIVERGENCE WARNINGS — DETECT THESE EXPLICITLY
These are the most important signals in the output. A trader acting on a warning can avoid a losing trade.

1. **Distribution warning:** Fundamental score positive BUT price score negative for same currency. State: "[CURRENCY] beats data but price falling — smart money distributing. Do NOT trade in fundamental direction."
2. **Passive strength warning:** Currency in top 3 but strength is passive (only gaining as quote vs weak USD/EUR). State: "[CURRENCY] passively strong — gaining from [WEAK BASE] weakness, not being actively bought. Lower confidence."
3. **Holiday warning:** Currency included with thin data. State: "[CURRENCY] scores unreliable — public holiday in [COUNTRY], low volume."
4. **Conflicting signals warning:** Std dev and price performance pointing in opposite directions. State: "Conflicting signals on [CURRENCY] — high std dev but negative price drift suggests unusual downside move, not strength."
5. **Insufficient ranking warning:** Fewer than 3 currencies clear the ±1.5 threshold. State: "Only [N] currencies qualify today. Matrix reduced. Wait for clearer conditions."

## WHAT TO DO WHEN DATA IS THIN
Saturday, Sunday, or holiday-heavy days will often produce weak signals. In these cases:
- Do not force a full 9-pair matrix if the data doesn't support it
- Reduce the matrix to only the qualifying pairs
- Increase the number of divergence warnings
- Lower confidence ratings across the board
- State clearly: "Today's data is thin. Highest confidence setup is [PAIR] but wait for Monday's session open and fresh scoring before entry."

## SESSION CONTEXT (Lagos / WAT time)
Include session relevance in each pair idea:
- Tokyo 1am–7am: AUD/JPY, NZD/JPY optimal
- London 8am–10am: GBP, EUR pairs optimal (prime window)
- Pre-NY 1pm–2pm: watch H4 pools being targeted
- New York 3pm–6pm: USD pairs optimal (prime window)
- No entries after 7pm Lagos
- No entries within 30 minutes of NY open

## CENTRAL BANK RATE CONTEXT
Use interest rate differentials to classify trade timeframe:
- Large rate differential (>2%) between strong and weak currency = supports longer-term trend
- Small rate differential (<1%) = timeframe driven by data flow, not carry
- Rate differential OPPOSING the flow direction = move may be short-lived

## KNOWN FOREX PAIRS (use these exact formats)
USD/JPY, EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/CAD, USD/CHF,
EUR/GBP, EUR/JPY, GBP/JPY, AUD/JPY, NZD/JPY, EUR/AUD, GBP/AUD,
EUR/CAD, GBP/CHF, CAD/JPY, CHF/JPY, GBP/NZD, EUR/NZD, AUD/NZD,
AUD/CAD, NZD/CAD, NZD/CHF, AUD/CHF, CAD/CHF, USD/NOK, EUR/NOK,
USD/SEK, EUR/SEK

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no explanation, no code fences). Use this exact structure:
{
  "scores": [
    {
      "currency": "GBP",
      "total": 5.5,
      "fundamental": 3.0,
      "price": 1.5,
      "stddev": 1.0,
      "notes": ["Retail Sales +0.7% vs 0.0% — massive beat", "Active strength: base in GBP/USD, GBP/JPY, GBP/CHF all up"],
      "tag": "Retail Sales massive beat — active buyer"
    }
  ],
  "top3": ["GBP", "JPY", "EUR"],
  "bottom3": ["NZD", "CAD", "USD"],
  "pairs9": [
    {
      "pair": "GBP/NZD",
      "direction": "Long",
      "strong": "GBP",
      "weak": "NZD",
      "strongScore": 5.5,
      "weakScore": -3.0,
      "divergence": 8.5,
      "grade": "A+",
      "session": ["London", "New York"],
      "reason": "GBP retail massive beat + active strength across 3 pairs vs NZD credit card miss + passive weakness",
      "timeframe": "short-term",
      "pricedInRisk": false,
      "confidence": "High"
    }
  ],
  "ideas": [
    {
      "pair": "GBP/NZD",
      "direction": "Long",
      "strong": "GBP",
      "weak": "NZD",
      "strongScore": 5.5,
      "weakScore": -3.0,
      "divergence": 8.5,
      "grade": "A+",
      "session": ["London", "New York"],
      "reason": "GBP retail massive beat + active strength across 3 pairs vs NZD credit card miss + passive weakness",
      "timeframe": "short-term",
      "pricedInRisk": false,
      "confidence": "High"
    }
  ],
  "divergenceWarnings": [],
  "date": "2026-04-24"
}

CRITICAL RULES:
- Include ALL 10 currencies in the scores array (even if score is 0). Sort scores by total descending.
- Include ALL pairs9 setups that are grade A+, B, or C in the ideas array (exclude Skip). Sort ideas by divergence descending.
- Every idea must have timeframe, pricedInRisk, and confidence fields.
- The notes field for each currency must explain the active vs passive judgement made.
- divergenceWarnings must include ALL detected warnings — distribution, passive strength, holiday, conflicting signals, insufficient ranking.`;

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

  const top3 = allScores.filter((s) => ai.top3.includes(s.cur)).slice(0, 3);
  const bottom3 = allScores.filter((s) => ai.bottom3.includes(s.cur)).slice(0, 3);

  // Ensure top3 and bottom3 have 3 items each (fallback to allScores order)
  while (top3.length < 3 && allScores.length > top3.length) {
    const next = allScores.find(
      (s) => !top3.some((t) => t.cur === s.cur) && !bottom3.some((b) => b.cur === s.cur),
    );
    if (next) top3.push(next); else break;
  }
  while (bottom3.length < 3 && allScores.length > bottom3.length) {
    const next = [...allScores].reverse().find(
      (s) => !top3.some((t) => t.cur === s.cur) && !bottom3.some((b) => b.cur === s.cur),
    );
    if (next) bottom3.push(next); else break;
  }

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

  return {
    top3,
    bottom3,
    pairs9: ai.pairs9,
    ideas,
    priority1: priority1Setup,
    allScores,
    divergenceWarnings: ai.divergenceWarnings || [],
    generatedAt: new Date(),
    scoringModel: _usedModel,
    debugData: _debugData
      ? { ..._debugData, allScores }
      : { systemPrompt: "", userMessage: "", rawResponse: "", promptLength: 0, allScores },
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
