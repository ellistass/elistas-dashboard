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
  };
}

const RFDM_SYSTEM_PROMPT = `You are the RFDM (Relative Flow Divergence Model) scoring engine for a forex trader based in Lagos, Nigeria (WAT = GMT+1).

Your job: analyse the raw market data provided and score 10 currencies, then build a 9-pair trading matrix.

## CURRENCIES TO SCORE
USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, NOK, SEK

## SCORING RULES (apply these EXACTLY)

### 1. Fundamentals Pillar (weight: 1.5×)
- For every economic release in the calendar:
  - Identify which currency it belongs to
  - Compare actual vs forecast (or actual vs previous if no forecast)
  - BEAT (actual better than expected): +1.5 to that currency
  - MISS (actual worse than expected): −1.5 to that currency
  - HIGH impact events: multiply by 1.5 (so +2.25 / −2.25)
  - "Better" means: for growth/employment/spending → higher is better; for unemployment/jobless claims → lower is better

### 2. Price Performance Pillar (weight: 1.5×)
- From the forex performance table (% change per pair today):
  - If a pair like EUR/USD is UP: EUR gets +1.0, USD gets −0.5
  - If a pair like EUR/USD is DOWN: EUR gets −1.0, USD gets +0.5
  - Apply for every pair the currency appears in
  - Scale: per 0.1% move = ±0.5 contribution (cap at ±3.0 per currency)

### 3. Standard Deviation / Price Surprises Pillar (weight: 0.8×)
- From std dev / price surprise data:
  - Std dev > 0 for a pair: +0.8 to the base currency (unusually strong)
  - Std dev < 0 for a pair: −0.8 to the base currency (unusually weak)
  - This measures how unusual today's move is vs 20-day history

### 4. Futures Pillar (weight: 0.5×) — only if futures data provided
  - Futures UP: +0.5 to that currency
  - Futures DOWN: −0.5 to that currency

### Final score = sum of all pillar contributions

## RANKING
- Sort all currencies by score descending
- Top 3 = strongest currencies
- Bottom 3 = weakest currencies

## 9-PAIR MATRIX
- Cross every Top 3 currency with every Bottom 3 currency
- For each crossing, find the real forex pair (e.g. if GBP is strong and NZD is weak → GBP/NZD Long)
- Divergence = |strongScore − weakScore|

## SETUP GRADES
- A+ = divergence ≥ 8.0 → full risk
- B = divergence ≥ 5.0 → half risk
- C = divergence ≥ 2.5 → watch only
- Skip = divergence < 2.5

## DIVERGENCE WARNINGS (critical — detect these)
- If a currency has POSITIVE fundamentals (data beat) but NEGATIVE price performance → "Smart money distributing — do NOT trade in the direction of fundamentals"
- Flag these explicitly in divergenceWarnings array

## SESSION WINDOWS (for session field)
- Tokyo: 1am–7am WAT → AUD/JPY, NZD/JPY pairs
- London: 8am–11am WAT → GBP, EUR pairs (prime window)
- Pre-NY: 1pm–2pm WAT → watch H4 pools
- New York: 3pm–6pm WAT → USD pairs (prime window)

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
      "notes": ["Retail Sales +0.7% vs 0.0% — massive beat"],
      "tag": "Retail Sales massive beat"
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
      "reason": "GBP retail massive beat vs NZD credit card miss",
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
      "reason": "GBP retail massive beat vs NZD credit card miss",
      "timeframe": "short-term",
      "pricedInRisk": false,
      "confidence": "High"
    }
  ],
  "divergenceWarnings": [],
  "date": "2026-04-24"
}

CRITICAL RULES FOR ideas ARRAY:
- Include ALL pairs9 setups that are grade A+, B, or C (exclude Skip)
- Sort ideas by divergence descending (highest divergence first)
- Every idea must have: timeframe ("short-term" if divergence driven by today's data, "longer-term" if driven by rate differentials/sustained trend), pricedInRisk (true if fundamentals already heavily reflected), confidence ("High"/"Medium"/"Low")
- The first item in ideas is automatically the priority setup
- IMPORTANT: Include ALL 10 currencies in the scores array (even if score is 0). Sort scores by total descending.`;

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

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

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
    debugData: _debugData ?? { systemPrompt: "", userMessage: "", rawResponse: "", promptLength: 0 },
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
