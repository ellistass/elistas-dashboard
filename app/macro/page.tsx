"use client";
// app/macro/page.tsx — the weekly macro story run.
//
// One question: what does each central bank's story say this week, and which trades
// does it put on? Claude runs it each Friday and writes it here through the MCP tools.
//   Calls     — the tested call (A, drives trades) next to the deeper story (B, logged only)
//   Banks     — each bank's story: worry, next move, how soon, forced or can wait
//   Positions — the open book; your real fill / stop / skip / notes go back to the next run
//   Record    — each call scored 4 weeks later
// Every number in a reason is an evidence chip [E12]: click it to see the release,
// the forecast, the source, and flag it if it's wrong.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, RefreshCw, Flag, ExternalLink, ChevronDown, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ev = { id: string; ref: string; currency: string; kind: string; name: string; value: string; expected?: string | null;
  target?: string | null; releaseDate: string; source: string; sourceUrl?: string | null; flagged: boolean; flagNote?: string | null };
type Call = { id: string; pair: string; version: "A" | "B"; direction: "UP" | "DOWN" | "NONE"; confidence: number; reason: string; valid: boolean; outcome?: any };
type Score = { pair: string; regime: string; role: string; alignment: number; riskPct: number; components: any };
type Card = { id: string; currency: string; bank: string; inflation: any; labour: any; decision: any; pricing: any;
  verdict: string; stance: string; changeView: string; valid: boolean; userNote?: string | null };
type Pos = { id: string; pair: string; side: "long" | "short"; unit: number; openedWeek: string; entry: number; stop: number;
  stopMode: string; riskPct: number; status: string; closedWeek?: string | null; exitPrice?: number | null; exitReason?: string | null;
  userFill?: number | null; userStop?: number | null; userNote?: string | null };
type Run = { id: string; week: string; kind: string; status: string; notes?: string | null; dataSnapshot?: any;
  evidence: Ev[]; calls: Call[]; scores: Score[]; cards: Card[] };
interface Payload { runs: { id: string; week: string; kind: string; status: string }[]; run: Run | null; positions: Pos[]; record: (Call & { run: { week: string } })[] }

const PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCAD", "USDCHF"];
const CCY_ORDER = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"];
const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmt = (x: number | null | undefined) => (x == null ? "—" : Math.abs(x) >= 100 ? x.toFixed(3) : x.toFixed(5));
const pairLabel = (p: string) => `${p.slice(0, 3)}/${p.slice(3)}`;
const tone = (s: string) =>
  /hawk|strength|hike/i.test(s) ? "var(--green)" : /dov|weak|cut/i.test(s) ? "var(--red)" : "var(--amber)";
/** what the call means as a trade, in plain words: "long USD", "short NZD" */
const side = (pair: string, dir: string) =>
  dir === "NONE" ? "no trade" : dir === "UP" ? `long ${pair.slice(0, 3)}` : `short ${pair.slice(0, 3)}`;

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 999, color, border: `1px solid ${color}`, whiteSpace: "nowrap" }}>{text}</span>
  );
}

/** Text with [E12] refs turned into clickable evidence chips. */
function Cited({ text, ev, open, setOpen }: { text: string; ev: Map<string, Ev>; open: string | null; setOpen: (r: string | null) => void }) {
  const parts = text.split(/(\[E\d+\])/g);
  return (
    <span style={{ lineHeight: 1.65 }}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(E\d+)\]$/);
        if (!m) return <span key={i}>{p}</span>;
        const e = ev.get(m[1]);
        return (
          <button key={i} onClick={() => setOpen(open === m[1] ? null : m[1])}
            style={{ ...mono, fontSize: 10, margin: "0 2px", padding: "0 5px", borderRadius: 4, cursor: "pointer",
              background: e?.flagged ? "var(--red-dim)" : "var(--accent-dim)", color: e ? (e.flagged ? "var(--red)" : "var(--accent)") : "var(--red)",
              border: `1px solid ${e ? (e.flagged ? "var(--red-border)" : "var(--accent-border)") : "var(--red-border)"}` }}>
            {m[1]}
          </button>
        );
      })}
    </span>
  );
}

function EvidencePanel({ e, onFlag }: { e: Ev; onFlag: (e: Ev) => void }) {
  return (
    <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", fontSize: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <b style={{ color: "var(--text-1)" }}>{e.ref} · {e.currency} · {e.name}</b>
        <span style={{ display: "flex", gap: 8 }}>
          {e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-2)" }}><ExternalLink size={12} /></a>}
          <button onClick={() => onFlag(e)} title="This number is wrong" style={{ color: e.flagged ? "var(--red)" : "var(--text-3)", cursor: "pointer" }}><Flag size={12} /></button>
        </span>
      </div>
      <div style={{ ...mono, marginTop: 4, color: "var(--text-body)" }}>
        actual <b>{e.value}</b>{e.expected ? <> · forecast {e.expected}</> : null}{e.target ? <> · {e.target}</> : null}
      </div>
      <div style={{ marginTop: 2, color: "var(--text-3)" }}>{e.kind} · released {e.releaseDate} · {e.source}</div>
      {e.flagged && <div style={{ marginTop: 4, color: "var(--red)" }}>Flagged: {e.flagNote || "marked wrong"}</div>}
    </div>
  );
}

export default function MacroPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);

  const load = useCallback(async (id?: string | null) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/macro${id ? `?run=${id}` : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(runId); }, [load, runId]);

  const edit = useCallback(async (entity: string, id: string, field: string, value: unknown, reason: string) => {
    const r = await fetch("/api/macro/edit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, id, field, value, reason }) });
    const j = await r.json();
    if (!r.ok) { alert(j.error ?? "Edit failed"); return; }
    load(runId);
  }, [load, runId]);

  const run = data?.run ?? null;
  const ev = useMemo(() => new Map((run?.evidence ?? []).map((e) => [e.ref, e])), [run]);
  const byPair = (v: "A" | "B") => new Map((run?.calls ?? []).filter((c) => c.version === v).map((c) => [c.pair, c]));
  const callsA = byPair("A"), callsB = byPair("B");
  const scores = new Map((run?.scores ?? []).map((s) => [s.pair, s]));
  const open = (data?.positions ?? []).filter((p) => p.status === "open");
  const openRisk = open.reduce((s, p) => s + p.riskPct, 0);
  const snap = run?.dataSnapshot ?? {};
  const flagEvidence = (e: Ev) => {
    const note = e.flagged ? "" : prompt(`What's wrong with ${e.ref} (${e.name})?`) ?? "";
    if (!e.flagged && !note) return;
    edit("evidence", e.id, "flagged", !e.flagged, note || "unflagged").then(() => { if (note) edit("evidence", e.id, "flagNote", note, "flag note"); });
  };

  if (error) return <div style={{ padding: 24 }}><ErrorCard message={error} /></div>;
  if (!data) return <div style={{ padding: 24 }}><LoadingCard what="the macro run" /></div>;

  return (
    <div style={{ padding: "20px 24px 60px", maxWidth: 1240, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 }}>
      {/* ── header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Landmark size={18} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, color: "var(--text-1)", margin: 0 }}>Macro story</h1>
        <select value={run?.id ?? ""} onChange={(e) => setRunId(e.target.value)}
          style={{ ...mono, fontSize: 12, background: "var(--bg-card-2)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}>
          {data.runs.map((r) => <option key={r.id} value={r.id}>week of Fri {r.week} · {r.kind}{r.status !== "done" ? ` · ${r.status}` : ""}</option>)}
        </select>
        {snap.regime && <Pill text={`10y regime: ${snap.regime.label} (z ${snap.regime.z >= 0 ? "+" : ""}${snap.regime.z})`} color="var(--text-2)" />}
        <Pill text={`open risk ${openRisk.toFixed(1)}% · ${open.length} positions`} color={openRisk > 6 ? "var(--red)" : "var(--text-2)"} />
        <button onClick={() => load(runId)} style={{ marginLeft: "auto", color: "var(--text-2)", cursor: "pointer" }} title="Reload">
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      {!run && <EmptyState text="No macro run yet. Claude writes one each Friday after the close." />}

      {run && (<>
        {/* ── calls & trades ────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Landmark size={14} />} title="Calls and trades" count={[...callsA.values()].filter((c) => c.direction !== "NONE").length}
            note="A = tested briefing (drives trades) · B = deeper story (logged only) · trade at score ≥ 2" />
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-card)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--text-label)", textAlign: "left", fontSize: 11 }}>
                  {["", "Pair", "Tested call (A)", "Deeper story (B)", "Divergence · moves first", "Score", "Risk", "Position", "A and B agree"].map((h) => (
                    <th key={h} style={{ padding: "9px 10px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {PAIRS.filter((p) => callsA.has(p) || callsB.has(p)).map((p) => {
                  const a = callsA.get(p), b = callsB.get(p), s = scores.get(p);
                  const pos = open.find((x) => x.pair === p);
                  const story = s?.components?.storyB;
                  const agree = a && b ? a.direction === b.direction : null;
                  const isOpen = expanded === p;
                  return [
                    <tr key={p} onClick={() => setExpanded(isOpen ? null : p)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "9px 10px", color: "var(--text-3)" }}>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                      <td style={{ padding: "9px 10px", color: "var(--text-1)", fontWeight: 600 }}>{pairLabel(p)}</td>
                      <td style={{ padding: "9px 10px" }}>{a ? <><b style={{ color: a.direction === "NONE" ? "var(--text-3)" : "var(--text-1)" }}>{side(p, a.direction)}</b> <span style={{ color: "var(--text-3)" }}>· conf {a.confidence}</span></> : "—"}</td>
                      <td style={{ padding: "9px 10px" }}>{b ? <><span style={{ color: "var(--text-body)" }}>{side(p, b.direction)}</span> <span style={{ color: "var(--text-3)" }}>· conf {b.confidence}</span></> : <span style={{ color: "var(--text-3)" }}>not run</span>}</td>
                      <td style={{ padding: "9px 10px", color: "var(--text-body)" }}>{story ? `${story.divergence} · ${story.firstMover}` : "—"}</td>
                      <td style={{ ...mono, padding: "9px 10px", color: (s?.alignment ?? 0) >= 2 ? "var(--green)" : "var(--text-3)" }}>{s?.alignment ?? "—"}</td>
                      <td style={{ ...mono, padding: "9px 10px" }}>{s ? `${s.riskPct}%` : "—"}</td>
                      <td style={{ ...mono, padding: "9px 10px", fontSize: 11.5 }}>{pos ? <>{pos.side} {fmt(pos.userFill ?? pos.entry)} <span style={{ color: "var(--text-3)" }}>stop {fmt(pos.userStop ?? pos.stop)}</span></> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                      <td style={{ padding: "9px 10px" }}>{agree == null ? "—" : agree
                        ? <Check size={14} style={{ color: "var(--green)" }} />
                        : <AlertTriangle size={14} style={{ color: "var(--amber)" }} />}</td>
                    </tr>,
                    isOpen && (
                      <tr key={p + "-x"}><td colSpan={9} style={{ padding: "4px 16px 14px 38px", background: "var(--bg-card-raised)", fontSize: 12.5, color: "var(--text-body)" }}>
                        {a && <p style={{ margin: "8px 0" }}><b style={{ color: "var(--text-label)" }}>Tested call (A):</b> <Cited text={a.reason} ev={ev} open={openRef} setOpen={setOpenRef} /></p>}
                        {b && <p style={{ margin: "8px 0" }}><b style={{ color: "var(--text-label)" }}>Deeper story (B):</b> <Cited text={b.reason} ev={ev} open={openRef} setOpen={setOpenRef} /></p>}
                        {s && <p style={{ margin: "8px 0", color: "var(--text-2)", fontSize: 11.5 }}>Score {s.alignment} = confidence {s.components?.confidence} + regime {s.components?.regime} · 2-year: {s.components?.twoYear ?? "—"} · role: {s.role}</p>}
                        {openRef && ev.get(openRef) && <EvidencePanel e={ev.get(openRef)!} onFlag={flagEvidence} />}
                      </td></tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── central banks ─────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Landmark size={14} />} title="Central banks" count={run.cards.length} note="each bank's story this week: what it's worried about, its likely next move, and whether it's forced or can wait" />
          {run.cards.length === 0 ? <EmptyState small text="No bank cards in this run." /> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {[...run.cards].sort((x, y) => CCY_ORDER.indexOf(x.currency) - CCY_ORDER.indexOf(y.currency)).map((c) => {
                const d = c.decision ?? {};
                return (
                  <div key={c.id} style={{ padding: 14, borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b style={{ color: "var(--text-1)", fontSize: 13.5 }}>{c.bank} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· {c.currency}</span></b>
                      <Pill text={c.stance} color={tone(c.stance)} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px" }}>
                      <span style={{ color: "var(--text-3)" }}>Next move</span><b style={{ color: tone(d.nextMove ?? "") }}>{d.nextMove ?? "—"} <span style={{ color: "var(--text-2)", fontWeight: 400 }}>· {d.when ?? "—"}</span></b>
                      <span style={{ color: "var(--text-3)" }}>Forced?</span><span style={{ color: "var(--text-body)" }}>{d.forced ?? "—"} · pressure {d.pressure ?? "—"}</span>
                      <span style={{ color: "var(--text-3)" }}>Rate</span><span style={{ color: "var(--text-body)" }}><Cited text={d.rate ?? "—"} ev={ev} open={openRef} setOpen={setOpenRef} /></span>
                      <span style={{ color: "var(--text-3)" }}>Verdict</span><span style={{ color: tone(c.verdict) }}>{c.verdict}</span>
                    </div>
                    {[["Inflation", c.inflation], ["Labour", c.labour], ["Priced", c.pricing]].map(([label, obj]: any) => (
                      <div key={label} style={{ color: "var(--text-body)" }}>
                        <span style={{ color: "var(--text-label)" }}>{label}: </span>
                        {Object.entries(obj ?? {}).map(([k, v], i) => (
                          <span key={k}>{i ? " · " : ""}<span style={{ color: "var(--text-3)" }}>{k.replace(/_/g, " ")}</span> <Cited text={String(v)} ev={ev} open={openRef} setOpen={setOpenRef} /></span>
                        ))}
                      </div>
                    ))}
                    <div style={{ color: "var(--text-2)", borderTop: "1px solid var(--border-subtle)", paddingTop: 6 }}>
                      <span style={{ color: "var(--text-label)" }}>What changes the view: </span><Cited text={c.changeView} ev={ev} open={openRef} setOpen={setOpenRef} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {openRef && ev.get(openRef) && !expanded && <EvidencePanel e={ev.get(openRef)!} onFlag={flagEvidence} />}
        </section>

        {/* ── positions ─────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Landmark size={14} />} title="Positions" count={open.length} total={data.positions.length}
            note="your fill, stop and notes go to the next Friday run · stop is judged on the Friday close (2R_close)" />
          {data.positions.length === 0 ? <EmptyState small text="No positions yet." /> : (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-card)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr style={{ color: "var(--text-label)", textAlign: "left", fontSize: 11 }}>
                  {["Pair", "Side", "Opened", "Entry", "Stop", "Risk", "Status", "Your fill", "Your stop", "Note", ""].map((h) => (
                    <th key={h} style={{ padding: "9px 10px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{h}</th>))}
                </tr></thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)", opacity: p.status === "open" ? 1 : 0.55 }}>
                      <td style={{ padding: "8px 10px", color: "var(--text-1)", fontWeight: 600 }}>{pairLabel(p.pair)}{p.unit > 1 ? ` (add ${p.unit})` : ""}</td>
                      <td style={{ padding: "8px 10px", color: p.side === "long" ? "var(--green)" : "var(--red)" }}>{p.side}</td>
                      <td style={{ ...mono, padding: "8px 10px" }}>{p.openedWeek}</td>
                      <td style={{ ...mono, padding: "8px 10px" }}>{fmt(p.entry)}</td>
                      <td style={{ ...mono, padding: "8px 10px" }}>{fmt(p.stop)}</td>
                      <td style={{ ...mono, padding: "8px 10px" }}>{p.riskPct}%</td>
                      <td style={{ padding: "8px 10px" }}>{p.status}{p.exitReason ? ` · ${p.exitReason}` : ""}</td>
                      {(["userFill", "userStop"] as const).map((f) => (
                        <td key={f} style={{ padding: "6px 10px" }}>
                          <input defaultValue={p[f] ?? ""} placeholder="—" disabled={p.status !== "open"}
                            onBlur={(e) => { const v = e.target.value.trim(); const n = v === "" ? null : Number(v);
                              if (v !== "" && !Number.isFinite(n)) return alert("Not a number"); if (n !== (p[f] ?? null)) edit("position", p.id, f, n, `${f} set on /macro`); }}
                            style={{ ...mono, width: 86, fontSize: 12, background: "var(--bg-card-2)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 6px" }} />
                        </td>
                      ))}
                      <td style={{ padding: "6px 10px" }}>
                        <input defaultValue={p.userNote ?? ""} placeholder="note"
                          onBlur={(e) => { if (e.target.value !== (p.userNote ?? "")) edit("position", p.id, "userNote", e.target.value, "note on /macro"); }}
                          style={{ width: 150, fontSize: 12, background: "var(--bg-card-2)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 6px" }} />
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        {p.status === "open" && <button onClick={() => confirm(`Skip ${pairLabel(p.pair)}? The run will treat it as not taken.`) && edit("position", p.id, "status", "skipped", "skipped on /macro")}
                          style={{ fontSize: 11, color: "var(--text-2)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px", cursor: "pointer" }}>skip</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── context ───────────────────────────────────────────── */}
        {snap.context && (
          <section>
            <SectionHeader icon={<Landmark size={14} />} title="Rates context" note="US only for now · not in the trade rules until tested" />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[["US 10-year", snap.regime?.us10y_asof_fri, snap.regime?.chg], ["US 2-year", snap.context.us2y, snap.context.us2y_4w_chg],
                ["10-year real", snap.context.real10y, snap.context.real10y_4w_chg], ["10-year breakeven", snap.context.breakeven10y, snap.context.breakeven10y_4w_chg]]
                .map(([label, v, c]: any) => (
                  <div key={label} style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)", minWidth: 150 }}>
                    <div style={{ fontSize: 11, color: "var(--text-label)" }}>{label}</div>
                    <div style={{ ...mono, fontSize: 15, color: "var(--text-1)" }}>{v != null ? `${v}%` : "—"}
                      <span style={{ fontSize: 11, marginLeft: 6, color: c > 0 ? "var(--green)" : c < 0 ? "var(--red)" : "var(--text-3)" }}>
                        {c != null ? `${c > 0 ? "+" : ""}${Math.round(c * 100)}bp 4w` : ""}</span></div>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* ── record ────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Landmark size={14} />} title="Record" count={data.record.length} note="tested calls, scored 4 weeks after the call" />
          {data.record.length === 0 ? <EmptyState small text="No scored calls yet. The first live calls (week of 20 Nov) get scored on Fri 18 Dec." /> : (() => {
            const traded = data.record.filter((c) => c.direction !== "NONE");
            const wins = traded.filter((c) => c.outcome?.win).length;
            const r = traded.reduce((s, c) => s + (c.outcome?.R4 ?? 0), 0);
            return (
              <div style={{ fontSize: 12.5, color: "var(--text-body)" }}>
                <div style={{ marginBottom: 8 }}>{traded.length} calls · win {traded.length ? Math.round((100 * wins) / traded.length) : 0}% · total {r.toFixed(1)}R</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 6 }}>
                  {traded.map((c) => (
                    <div key={c.id} style={{ ...mono, fontSize: 11.5, padding: "6px 9px", borderRadius: 6, background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                      {c.run.week} {pairLabel(c.pair)} {c.direction} c{c.confidence} → <b style={{ color: c.outcome?.win ? "var(--green)" : "var(--red)" }}>{(c.outcome?.R4 ?? 0).toFixed(2)}R</b>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </section>

        {run.notes && <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.6 }}>Run notes: {run.notes}</div>}
      </>)}
    </div>
  );
}
