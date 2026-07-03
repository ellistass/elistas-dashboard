// app/analysis/_components/types.ts
// Shared types + helpers for the Analysis history screen.
// Interfaces are reused VERBATIM from the previous app/analysis/page.tsx —
// they mirror /api/alerts/history and /api/alerts/[id] response shapes.

export interface HistoryItem {
  id: string;
  date: string;
  createdAt: string;
  sentAt: string | null;
  scoringModel: string | null;
  dataAge: number | null;
  priorityPair: string | null;
  priorityGrade: string | null;
  divergence: number | null;
  top3: string[];
  bottom3: string[];
  ideasCount: number;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface TradeIdea {
  pair: string;
  direction: string;
  strong: string;
  weak: string;
  divergence: number;
  grade: string;
  session: string[];
  reason: string;
  timeframe?: string;
  pricedInRisk?: boolean;
  confidence?: string;
  strongScore: number;
  weakScore: number;
}

export interface AlertDetail {
  id: string;
  date: string;
  createdAt: string;
  scoringModel: string | null;
  dataAge: number | null;
  top3: any[];
  bottom3: any[];
  priority1: any;
  ideas: TradeIdea[] | null;
  pairs9: any[];
  fullAnalysis: {
    systemPrompt: string;
    userMessage: string;
    rawResponse: string;
    promptLength: number;
  } | null;
  // Macro snapshot captured at score time (saved into fullAnalysis) or the
  // current snapshot used as fallback for legacy rows that pre-date that.
  sectors?: Array<{ sector: string; symbol?: string; percentChange: number }>;
  macros?: Array<{ symbol: string; name: string; latest: number; percentChange: number }>;
  macroSource?: "saved" | "current-fallback" | "none";
  barchartFetchedAt?: string | null;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Bucket a raw scoringModel id into the display / filter name.
export function modelShort(model: string | null): "Sonnet" | "Haiku" | "Rules" {
  const m = (model ?? "").toLowerCase();
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return "Rules";
}

// Grade pill styling (A+ green · B amber · C gray · Skip red)
export function gradeMeta(g: string | null) {
  const map: Record<string, { c: string; bg: string; b: string }> = {
    "A+": { c: "var(--green)", bg: "var(--green-dim)", b: "var(--green-border)" },
    B: { c: "var(--amber)", bg: "var(--amber-dim)", b: "var(--amber-border)" },
    C: { c: "var(--text-label)", bg: "var(--bg-elevated)", b: "var(--border-strong)" },
    Skip: { c: "var(--red)", bg: "var(--red-dim)", b: "var(--red-border)" },
  };
  return map[g ?? "C"] ?? map.C;
}

// The history list payload has no priority direction field (and the API
// contract is frozen), so infer it RFDM-style: base currency strong = Long.
export function inferDirection(item: HistoryItem): "Long" | "Short" | null {
  if (!item.priorityPair || !item.priorityPair.includes("/")) return null;
  const [base, quote] = item.priorityPair.split("/");
  if (item.top3.includes(base) || item.bottom3.includes(quote)) return "Long";
  if (item.bottom3.includes(base) || item.top3.includes(quote)) return "Short";
  return null;
}

// Detail top3/bottom3 arrive as normalized ranking items ({cur, score, …})
// but are typed any[] — coerce defensively (legacy rows may be plain strings).
export function toRanked(arr: any[] | undefined | null): { cur: string; score: number }[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x: any) =>
      typeof x === "string"
        ? { cur: x, score: 0 }
        : { cur: x?.cur ?? x?.currency ?? "", score: Number(x?.score ?? 0) },
    )
    .filter((x) => x.cur);
}
