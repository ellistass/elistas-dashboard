"use client";
// app/log/page.tsx — Journal: is the system working over time?
//
// Every setup ever seen, played out under the mechanical rules, next to the
// trades you took. The top chart is the test: each group's average R plotted
// against its backtest band. Compare with the band, not with zero; greyed dots
// have under 30 trades.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { kit as s, Btn, PageHead, RBars, Section, Tag, px, rr } from "../_components/swing/kit";

const MIN_N = 30;
interface Stats { n: number; avgR: number | null; winPct: number | null; maxDD: number | null; longestLosing: number | null }
interface Group { group: string; expectation: string; expLo: number | null; expHi: number | null; stats: Stats }
interface Payload { table: Group[]; counts: Record<string, number>; rows: any[]; yours: { r: number; label: string }[] }

const OUTCOME_TONE: Record<string, "good" | "bad" | "plain" | "info" | "warn"> = { win: "good", loss: "bad", be: "plain", expired: "plain", open: "info" };

export default function JournalPage() {
  const [market, setMarket] = useState<"all" | "futures" | "forex">("all");
  const [show, setShow] = useState<"all" | "closed" | "open" | "expired">("all");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/swing/journal?market=${market}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [market]);
  useEffect(() => { load(); }, [load]);

  const resolve = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/swing/journal", { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const closed = (data?.rows ?? []).filter((r) => ["win", "loss", "be"].includes(r.outcome))
    .sort((a, b) => String(a.exitDate).localeCompare(String(b.exitDate)));
  const rows = (data?.rows ?? []).filter((r) => show === "all" ? true : show === "closed" ? ["win", "loss", "be"].includes(r.outcome) : r.outcome === show);
  const all = data?.table.find((g) => g.group === "All setups")?.stats;

  return (
    <div className={s.page}>
      <PageHead title="Journal"
        sub={data ? `${data.rows.length} setups logged · ${closed.length} played out · ${all?.avgR != null ? `${rr(all.avgR)} average` : "no results yet"}` : error ?? "Loading…"}
        right={
          <div className={s.row}>
            {(["all", "futures", "forex"] as const).map((m) => <Btn key={m} primary={market === m} onClick={() => setMarket(m)}>{m === "futures" ? "futures / stocks" : m}</Btn>)}
            <Btn onClick={resolve} disabled={busy}><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Update results</Btn>
          </div>
        } />
      {error && data ? <div className={s.small} style={{ color: "var(--red)" }}>{error}</div> : null}

      {data ? (
        <>
          <Section title="Is it working?" hint="each group's average R against its backtest band">
            <div className={s.card}><BandChart groups={data.table} /></div>
            <div className={s.small} style={{ color: "var(--text-3)" }}>
              Compare with the band, not with zero · grey dots have under {MIN_N} trades (not enough data) · losing streaks of 5–8 on A-grades are normal ·
              the key test is whether the COT trapped vs late gap holds. Only setups that filled and closed count; no costs or swaps.
            </div>
          </Section>

          <div className={s.grid2}>
            <Section title="Every setup, played out" count={closed.length}>
              <div className={s.card}><RBars items={closed.map((r) => ({ r: r.resultR, label: `${r.exitDate} ${r.instrument} ${r.side}` }))} /></div>
            </Section>
            <Section title="Your trades" count={data.yours.length}>
              <div className={s.card}><RBars items={data.yours} /></div>
            </Section>
          </div>

          <Section title="Results table">
            <div className={`${s.card} ${s.tableWrap}`} style={{ padding: 4 }}>
              <table className={s.table}>
                <thead><tr>{["group", "backtest", "n", "avg R", "win %", "max drawdown", "longest losing run"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.table.map((g) => {
                    const thin = g.stats.n < MIN_N;
                    return (
                      <tr key={g.group} style={{ color: thin ? "var(--text-3)" : "var(--text-1)" }}>
                        <td style={{ color: "inherit" }}>{g.group}</td>
                        <td>{g.expectation}</td>
                        <td>{g.stats.n}{thin && g.stats.n ? <Tag>thin</Tag> : null}</td>
                        <td style={{ color: thin || g.stats.avgR == null ? undefined : g.stats.avgR >= 0 ? "var(--green)" : "var(--red)" }}>{rr(g.stats.avgR)}</td>
                        <td>{g.stats.winPct == null ? "—" : `${g.stats.winPct}%`}</td>
                        <td>{g.stats.maxDD == null ? "—" : `${g.stats.maxDD}R`}</td>
                        <td>{g.stats.longestLosing ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Every setup" count={rows.length}
            right={<div className={s.row}>{(["all", "closed", "open", "expired"] as const).map((x) => <Btn key={x} primary={show === x} onClick={() => setShow(x)}>{x} {x === "all" ? data.rows.length : x === "closed" ? closed.length : data.counts[x] ?? 0}</Btn>)}</div>}>
            {rows.length ? (
              <div className={s.list}>
                {rows.map((r) => (
                  <div key={r.id} className={s.listRow} style={{ gridTemplateColumns: "88px minmax(120px,1fr) minmax(120px,1fr) 150px 110px" }}>
                    <span className={s.small}>{r.firstBarDate}</span>
                    <div className={s.row}>
                      <b>{r.instrument}</b><Tag tone={r.side === "long" ? "long" : "short"}>{r.side}</Tag>
                      <span className={s.grade + (r.grade === "A" ? " " + s.gradeA : "")}>{r.grade}</span>
                    </div>
                    <div className={s.small} style={{ whiteSpace: "normal" }}>
                      {r.entry}{r.context ? ` · ${r.context}` : ""}{r.cot ? ` · COT ${r.cot}` : ""}{r.quietRetest ? " · quiet retest" : ""}
                      {r.taken ? <span style={{ color: "var(--accent)" }}> · you took it ({r.taken.account}){r.taken.resultR != null ? ` ${rr(r.taken.resultR)}` : ""}</span> : null}
                    </div>
                    <div className={s.small}>
                      {r.fillDate ? `in ${px(r.fillPrice)} · ${r.fillDate}` : r.outcome === "expired" ? "never filled" : "waiting"}
                      {r.exitDate ? <div>out {px(r.exitPrice)} · {r.exitReason}</div> : null}
                    </div>
                    <div className={s.row} style={{ justifyContent: "flex-end" }}>
                      {r.resultR != null ? <span className={s.mono} style={{ fontSize: 13, color: r.resultR >= 0 ? "var(--green)" : "var(--red)" }}>{rr(r.resultR)}</span> : null}
                      <Tag tone={OUTCOME_TONE[r.outcome] ?? "plain"}>{r.outcome ?? "pending"}</Tag>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className={`${s.card} ${s.empty}`}>No logged setups here yet. The log fills from the scans; press <b>Update results</b> to play them out.</div>}
          </Section>
        </>
      ) : null}
    </div>
  );
}

/** Each group: its backtest band (shaded) and your average R (dot, sized by n, grey under 30). */
function BandChart({ groups }: { groups: Group[] }) {
  const rowsH = 30, padL = 230, padR = 100, W = 980, H = groups.length * rowsH + 26;
  const vals = groups.flatMap((g) => [g.expLo, g.expHi, g.stats.avgR]).filter((v): v is number => v != null);
  const lo = Math.min(-0.5, ...vals) - 0.1, hi = Math.max(1, ...vals) + 0.1;
  const x = (v: number) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
  const ticks = [-0.5, 0, 0.5, 1].filter((t) => t >= lo && t <= hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label="Average R per group against the backtest expectation">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={4} y2={H - 20} strokeWidth={1} style={{ stroke: t === 0 ? "var(--border-strong)" : "var(--border-subtle)" }} />
          <text x={x(t)} y={H - 6} textAnchor="middle" fontFamily="'DM Mono', monospace" fontSize={10} style={{ fill: "var(--text-3)" }}>{t > 0 ? "+" : ""}{t}R</text>
        </g>
      ))}
      {groups.map((g, i) => {
        const cy = 4 + i * rowsH + rowsH / 2, thin = g.stats.n < MIN_N, a = g.stats.avgR;
        const inBand = a != null && g.expLo != null && g.expHi != null && a >= g.expLo && a <= g.expHi;
        const tone = a == null ? "var(--text-3)" : thin ? "var(--text-3)" : g.expLo == null ? (a >= 0 ? "var(--green)" : "var(--red)") : inBand || a > (g.expHi ?? 0) ? "var(--green)" : "var(--amber)";
        return (
          <g key={g.group}>
            <text x={0} y={cy + 4} fontFamily="'DM Mono', monospace" fontSize={11} style={{ fill: thin ? "var(--text-3)" : "var(--text-1)" }}>{g.group}</text>
            <line x1={padL} x2={W - padR} y1={cy} y2={cy} strokeWidth={1} style={{ stroke: "var(--border-subtle)" }} />
            {g.expLo != null && g.expHi != null ? <rect x={x(g.expLo)} y={cy - 7} width={Math.max(3, x(g.expHi) - x(g.expLo))} height={14} rx={3} style={{ fill: "var(--accent-dim)", stroke: "var(--accent)" }} strokeWidth={1} /> : null}
            {a != null ? <circle cx={x(a)} cy={cy} r={thin ? 4.5 : 6} style={{ fill: tone }} /> : null}
            <text x={W - padR + 8} y={cy + 4} fontFamily="'DM Mono', monospace" fontSize={10.5} style={{ fill: a == null ? "var(--text-3)" : tone }}>
              {a == null ? "no data" : `${rr(a)} n${g.stats.n}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
