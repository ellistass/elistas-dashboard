"use client";
// app/wyckoff/_components/ScoreStrip.tsx — the benchmark, composed as ONE unit.
//
// Design intent: the page's headline is a comparison (you vs engine), not five
// unrelated tiles. So the strip is a single card with a hero pair on the left
// and the supporting stats (shared sample · engine overall · pass-rate meter)
// on the right. Numbers wear text tokens; color appears only where it carries
// meaning (your side = accent; pass-rate health = status color + label).

interface Tally { n: number; correct: number; decisiveN: number; decisiveCorrect: number }
export interface Scoreboard {
  resolvedWithRead: number;
  you: Tally;
  engineSameSet: Tally;
  engineOverallBlind: Tally;
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const pct = (c: number, n: number) => (n ? `${Math.round((c / n) * 100)}%` : "—");

export default function ScoreStrip({
  score,
  passRate,
}: {
  score: Scoreboard;
  passRate: { total: number; pass: number } | null;
}) {
  const prPct = passRate && passRate.total > 0 ? passRate.pass / passRate.total : null;
  const prHealthy = prPct != null && prPct >= 0.33 && prPct <= 0.55;

  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 0, padding: 0, marginBottom: 26, overflow: "hidden" }}>
      {/* ── Hero: the duel ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 26, padding: "18px 26px", flex: "1 1 340px" }}>
        <Hero label="You" value={pct(score.you.correct, score.you.n)} detail={`${score.you.correct}/${score.you.n} · decisive ${pct(score.you.decisiveCorrect, score.you.decisiveN)}`} accent />
        <span style={{ ...mono, fontSize: 11, color: "var(--text-3)", letterSpacing: "0.14em" }}>VS</span>
        <Hero label="Engine · same set" value={pct(score.engineSameSet.correct, score.engineSameSet.n)} detail={`${score.engineSameSet.correct}/${score.engineSameSet.n} · decisive ${pct(score.engineSameSet.decisiveCorrect, score.engineSameSet.decisiveN)}`} />
      </div>

      {/* ── Supporting stats ── */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 26,
        padding: "18px 26px", flex: "2 1 420px",
        borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-card-2, transparent)",
      }}>
        <Mini label="Shared sample" value={String(score.resolvedWithRead)} detail="resolved · blind · with your read" />
        <Mini label="Engine overall (blind)" value={pct(score.engineOverallBlind.correct, score.engineOverallBlind.n)} detail={`${score.engineOverallBlind.correct}/${score.engineOverallBlind.n} ranges`} />
        {/* Pass-rate meter — the discipline gauge, with its healthy band drawn in */}
        <div style={{ minWidth: 170 }}>
          <p className="kicker" style={{ margin: "0 0 5px" }}>Pass rate</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ ...mono, fontSize: 19, fontWeight: 500, color: prPct == null ? "var(--text-2)" : prHealthy ? "var(--green)" : "var(--amber)" }}>
              {prPct == null ? "—" : `${Math.round(prPct * 100)}%`}
            </span>
            <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
              {passRate && passRate.total > 0 ? `${passRate.pass}/${passRate.total} reads` : "no reads yet"}
            </span>
          </div>
          <div style={{ position: "relative", height: 5, borderRadius: 3, background: "var(--bg-inset, var(--border-subtle))", marginTop: 7 }}>
            {/* healthy band 33–55% */}
            <div style={{ position: "absolute", left: "33%", width: "22%", top: 0, bottom: 0, background: "var(--green-dim)", borderRadius: 3 }} />
            {prPct != null && (
              <div style={{
                position: "absolute", left: `calc(${Math.min(prPct * 100, 100)}% - 2px)`, top: -2, bottom: -2, width: 4,
                borderRadius: 2, background: prHealthy ? "var(--green)" : "var(--amber)",
              }} />
            )}
          </div>
          <p style={{ ...mono, fontSize: 9, color: "var(--text-3)", margin: "5px 0 0" }}>healthy ≈ 33–55% · low = forcing calls</p>
        </div>
      </div>
    </div>
  );
}

function Hero({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <p style={{ ...mono, margin: 0, fontSize: 32, lineHeight: 1, fontWeight: 500, color: accent ? "var(--accent)" : "var(--text-1)" }}>
        {value}
      </p>
      <p style={{ ...mono, margin: "6px 0 0", fontSize: 10, color: "var(--text-3)" }}>{detail}</p>
    </div>
  );
}

function Mini({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <p style={{ ...mono, margin: 0, fontSize: 19, fontWeight: 500, color: "var(--text-1)" }}>{value}</p>
      <p style={{ ...mono, margin: "5px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>{detail}</p>
    </div>
  );
}
