"use client";
import { rate, compareRates } from "@/lib/stats";
import { RateValueText } from "@/app/_components/Rate";
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

function HeroRate({ label, rate: r, detail, accent }: {
  label: string; rate: ReturnType<typeof rate>; detail: string; accent?: boolean;
}) {
  return (
    <div>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <RateValueText rate={r} size={30} accent={accent} />
      <p style={{ ...mono, margin: "5px 0 0", fontSize: 10, color: "var(--text-3)" }}>{detail}</p>
    </div>
  );
}

export default function ScoreStrip({
  score,
  passRate,
}: {
  score: Scoreboard;
  passRate: { total: number; pass: number } | null;
}) {
  const prPct = passRate && passRate.total > 0 ? passRate.pass / passRate.total : null;
  const prHealthy = prPct != null && prPct >= 0.33 && prPct <= 0.55;

  // The duel rests on 14 shared cases. Rendering it as two big percentages
  // facing each other invites a comparison the sample cannot settle, so the
  // verdict on whether the gap is even readable is stated next to it.
  const you = rate(score.you.correct, score.you.n);
  const eng = rate(score.engineSameSet.correct, score.engineSameSet.n);
  const engAll = rate(score.engineOverallBlind.correct, score.engineOverallBlind.n);
  const duel = compareRates(you, eng);

  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 0, padding: 0, marginBottom: 26, overflow: "hidden" }}>
      {/* ── Hero: the duel ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 26, padding: "18px 26px", flex: "1 1 340px" }}>
        <HeroRate label="You" rate={you} detail={`decisive ${pct(score.you.decisiveCorrect, score.you.decisiveN)}`} accent />
        <span style={{ ...mono, fontSize: 11, color: "var(--text-3)", letterSpacing: "0.14em" }}>VS</span>
        <HeroRate label="Engine · same set" rate={eng} detail={`decisive ${pct(score.engineSameSet.decisiveCorrect, score.engineSameSet.decisiveN)}`} />
      </div>

      <div style={{ flexBasis: "100%", padding: "0 26px 14px" }}>
        <span
          title={
            duel.meaningful
              ? "The gap clears the combined margin of error — read it as a real difference."
              : "The gap is inside the uncertainty on both numbers. Not yet a difference, however it looks."
          }
          style={{ ...mono, fontSize: 10, color: duel.meaningful ? "var(--text-2)" : "var(--text-3)" }}
        >
          {duel.note}
        </span>
      </div>

      {/* ── Supporting stats ── */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 26,
        padding: "18px 26px", flex: "2 1 420px",
        borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-card-2, transparent)",
      }}>
        <Mini label="Shared sample" value={String(score.resolvedWithRead)} detail="resolved · blind · with your read" />
        <Mini label="Engine overall (blind)" value={engAll.label} detail={`${engAll.hits}/${engAll.n} ranges`} />
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
function Mini({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <p style={{ ...mono, margin: 0, fontSize: 19, fontWeight: 500, color: "var(--text-1)" }}>{value}</p>
      <p style={{ ...mono, margin: "5px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>{detail}</p>
    </div>
  );
}
