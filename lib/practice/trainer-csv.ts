// lib/practice/trainer-csv.ts — import the Wyckoff trainer's ledger.
//
// The trainer holds 317 cases and a run history in ONE browser's localStorage.
// If that profile is cleared, months of deliberate practice vanish, and none of
// it can be compared against live results. This parses its CSV export so the
// same breakdowns work on practice and live side by side.
//
// Column list is the trainer's own COLS array, verbatim:
//   #, instrument, ctx_pct, range_lo, range_hi, band_pct, dir, entry, stop,
//   order_kind, risk_pct, rr_boundary, rr_projection, fill_bar, fill_type,
//   result, R, mae_R, mfe_R, bars_stepped, springs_at_entry,
//   upthrusts_at_entry, stopping_action, vol_ratio_at_entry, er_ratio_at_entry,
//   er_verdict_at_entry, engine, market_outcome, aids, run_id, closed_at
//
// Parsed BY HEADER NAME, never by position — the trainer is still being edited,
// and a column inserted in the middle must not silently shift every field.

export interface PracticeCaseInput {
  caseKey: string;
  seq: number | null;
  instrument: string;
  direction: string | null;
  entry: number | null;
  stop: number | null;
  orderKind: string | null;
  riskPct: number | null;
  rrBoundary: number | null;
  rrProjection: number | null;
  fillBar: number | null;
  fillType: string | null;
  result: string | null;
  resultR: number | null;
  maeR: number | null;
  mfeR: number | null;
  barsStepped: number | null;
  springsAtEntry: number | null;
  upthrustsAtEntry: number | null;
  stoppingAction: boolean | null;
  volRatioAtEntry: number | null;
  erRatioAtEntry: number | null;
  erVerdictAtEntry: string | null;
  engineVerdict: string | null;
  marketOutcome: string | null;
  ctxPct: number | null;
  bandPct: number | null;
  aids: string | null;
  closedAt: string | null;
  trainerRunId: string | null;
}

export interface ParsedTrainerCsv {
  cases: PracticeCaseInput[];
  /** Distinct run ids seen, so an export spanning several runs can be split. */
  runIds: string[];
  skipped: number;
  warnings: string[];
}

/** Split one CSV line, honouring quoted fields. The trainer quotes anything
 *  containing a comma, and instrument names are user-editable. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }   // escaped quote
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const num = (v: string | undefined): number | null => {
  if (v == null) return null;
  const t = v.trim();
  if (t === "" || t === "—" || t.toLowerCase() === "n/a") return null;
  const n = Number(t.replace(/[%×]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const int = (v: string | undefined): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const str = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t === "—" ? null : t;
};
const bool = (v: string | undefined): boolean | null => {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "") return null;
  if (["1", "true", "yes", "y"].includes(t)) return true;
  if (["0", "false", "no", "n"].includes(t)) return false;
  return null;
};

/** Stable identity for a case, matching the trainer's own `sym|ctx|lo|hi` key.
 *  Re-importing the same export must update rather than duplicate. */
export function caseKeyOf(instrument: string, ctxPct: string | undefined, lo: string | undefined, hi: string | undefined): string {
  return [instrument, (ctxPct ?? "").trim(), (lo ?? "").trim(), (hi ?? "").trim()].join("|");
}

export function parseTrainerCsv(text: string): ParsedTrainerCsv {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return { cases: [], runIds: [], skipped: 0, warnings: ["file has no data rows"] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/^﻿/, ""));
  const col = (name: string) => header.indexOf(name);
  const at = (cells: string[], name: string): string | undefined => {
    const i = col(name);
    return i < 0 ? undefined : cells[i];
  };

  if (col("instrument") < 0) {
    return { cases: [], runIds: [], skipped: 0, warnings: ["no `instrument` column — is this the trainer export?"] };
  }
  for (const required of ["result", "r", "market_outcome"]) {
    if (col(required) < 0) warnings.push(`column \`${required}\` missing — related stats will be blank`);
  }

  const cases: PracticeCaseInput[] = [];
  const runIds = new Set<string>();
  let skipped = 0;

  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const instrument = str(at(cells, "instrument"));
    if (!instrument) { skipped++; continue; }

    const runId = str(at(cells, "run_id"));
    if (runId) runIds.add(runId);

    cases.push({
      caseKey: caseKeyOf(instrument, at(cells, "ctx_pct"), at(cells, "range_lo"), at(cells, "range_hi")),
      seq: int(at(cells, "#")),
      instrument,
      direction: str(at(cells, "dir")),
      entry: num(at(cells, "entry")),
      stop: num(at(cells, "stop")),
      orderKind: str(at(cells, "order_kind")),
      riskPct: num(at(cells, "risk_pct")),
      rrBoundary: num(at(cells, "rr_boundary")),
      rrProjection: num(at(cells, "rr_projection")),
      fillBar: int(at(cells, "fill_bar")),
      fillType: str(at(cells, "fill_type")),
      result: str(at(cells, "result")),
      resultR: num(at(cells, "r")),
      maeR: num(at(cells, "mae_r")),
      mfeR: num(at(cells, "mfe_r")),
      barsStepped: int(at(cells, "bars_stepped")),
      springsAtEntry: int(at(cells, "springs_at_entry")),
      upthrustsAtEntry: int(at(cells, "upthrusts_at_entry")),
      stoppingAction: bool(at(cells, "stopping_action")),
      volRatioAtEntry: num(at(cells, "vol_ratio_at_entry")),
      erRatioAtEntry: num(at(cells, "er_ratio_at_entry")),
      erVerdictAtEntry: str(at(cells, "er_verdict_at_entry")),
      engineVerdict: str(at(cells, "engine")),
      marketOutcome: str(at(cells, "market_outcome")),
      ctxPct: num(at(cells, "ctx_pct")),
      bandPct: num(at(cells, "band_pct")),
      aids: str(at(cells, "aids")),
      closedAt: str(at(cells, "closed_at")),
      trainerRunId: runId,
    });
  }

  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped — no instrument`);
  return { cases, runIds: [...runIds], skipped, warnings };
}

/* ── Stats ────────────────────────────────────────────────────────────────
   Deliberately the same shape the live side reports, so practice and live can
   be read against each other without mentally translating between them. */

export interface PracticeStats {
  n: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netR: number;
  avgR: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownR: number;
}

export function computeStats(cases: Array<{ result?: string | null; resultR?: number | null }>): PracticeStats {
  const closed = cases.filter((c) => c.resultR != null);
  const rs = closed.map((c) => c.resultR as number);
  const wins = rs.filter((r) => r > 0.05);
  const losses = rs.filter((r) => r < -0.05);
  const netR = rs.reduce((s, r) => s + r, 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));

  // Peak-to-trough on the R curve, in R. Reported because a 40% win rate with a
  // 12R hole is a different animal from the same win rate without one.
  let peak = 0, equity = 0, maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const decided = wins.length + losses.length;
  return {
    n: cases.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decided ? Number(((wins.length / decided) * 100).toFixed(1)) : null,
    netR: Number(netR.toFixed(2)),
    avgR: rs.length ? Number((netR / rs.length).toFixed(3)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    expectancy: rs.length ? Number((netR / rs.length).toFixed(3)) : null,
    maxDrawdownR: Number(maxDd.toFixed(2)),
  };
}
