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

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  evidence: Ev[]; calls: Call[]; scores: Score[]; cards: Card[]; stories?: Story[] };
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

type Story = { pair: string; side: string; pLong: number; pShort: number; gap: number; since: string; weeks: number;
  startPrice: number; now: number; unitPct: number; moveUnits: number; status: string; plan: any; priced?: any; orders?: any;
  history?: StoryWeek[] | null; slot: string; note?: string | null };
type StoryWeek = { w: string; pLong: number; pShort: number; gap: number; policyGap?: number | null; y2Gap?: number | null };

const STATUS: Record<string, { label: string; color: string; hint: string }> = {
  "new":             { label: "NEW — half now",       color: "var(--green)",  hint: "Story just opened: enter half at the close" },
  "dip zone":        { label: "DIP — add half",       color: "var(--accent)", hint: "Closed 1 unit against the story inside 20 days: second half" },
  "back near start": { label: "BACK AT START",        color: "var(--accent)", hint: "Open story, price back to/below the start: late entry (+0.55R tested)" },
  "running":         { label: "RUNNING",              color: "var(--text-3)",  hint: "In profit and inside the plan: hold, no new entry" },
  "stretched":       { label: "STRETCHED — wait",     color: "var(--amber)",  hint: "Far from start: don't chase, wait for a dip" },
};
const PRICED: Record<string, string> = { room: "var(--green)", "partly priced": "var(--amber)", priced: "var(--red)" };

function StoriesSection({ stories }: { stories: Story[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!stories.length) return null;
  const th = { textAlign: "left" as const, fontSize: 11, color: "var(--text-label)", fontWeight: 500, padding: "6px 8px", whiteSpace: "nowrap" as const };
  const td = { fontSize: 12, padding: "7px 8px", borderTop: "1px solid var(--border)", whiteSpace: "nowrap" as const };
  return (
    <section>
      <SectionHeader icon={<Landmark size={14} />} title="Story divergence setups" count={stories.length}
        note="hawkish vs dovish, all 28 pairs · half at start, half on a 1-unit dip · stop 2 units (Friday close) · half off at 1:3 · one story per currency · click a row for the chart" />
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["Pair", "Trade", "Story", "Since", "Now vs start", "Status", "Entry plan", "Priced in", "Orders", "Slot"].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {stories.map(s => {
              const st = STATUS[s.status] ?? { label: s.status, color: "var(--text-3)", hint: "" };
              const taken = s.slot !== "free";
              return (
                <Fragment key={s.pair}>
                  <tr onClick={() => setOpen(open === s.pair ? null : s.pair)} style={{ cursor: "pointer", opacity: taken ? 0.55 : 1 }}>
                    <td style={{ ...td, fontWeight: 600, color: "var(--text-1)" }}>{pairLabel(s.pair)}</td>
                    <td style={td}>{s.side}</td>
                    <td style={{ ...td, ...mono }}>
                      <span style={{ color: "var(--green)" }}>{s.pLong > 0 ? "+" : ""}{s.pLong}</span> vs <span style={{ color: "var(--red)" }}>{s.pShort > 0 ? "+" : ""}{s.pShort}</span>
                      <span style={{ color: "var(--text-3)" }}> (gap {s.gap})</span>
                    </td>
                    <td style={td}>{s.since} <span style={{ color: "var(--text-3)" }}>· {s.weeks}w</span></td>
                    <td style={{ ...td, ...mono, color: s.moveUnits >= 0 ? "var(--green)" : "var(--red)" }}>{s.moveUnits >= 0 ? "+" : ""}{s.moveUnits.toFixed(2)}u</td>
                    <td style={td} title={st.hint}><Pill text={st.label} color={st.color} /></td>
                    <td style={{ ...td, ...mono, fontSize: 11 }}>
                      {s.plan?.dipHalf?.level ? <>dip {fmt(s.plan.dipHalf.level)}</> : "—"}<span style={{ color: "var(--text-3)" }}> · stop {fmt(s.plan?.startHalf?.stop)} · 1:3 {fmt(s.plan?.partial13)}</span>
                    </td>
                    <td style={td}>{s.priced?.read ? <Pill text={s.priced.read} color={PRICED[s.priced.read] ?? "var(--text-3)"} /> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                    <td style={td}>{s.orders ? <Pill text={`${s.orders.leg} ${s.orders.roll5}`} color={s.orders.roll5 === "with" ? "var(--green)" : "var(--red)"} /> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                    <td style={{ ...td, fontSize: 11, color: taken ? "var(--amber)" : "var(--text-3)" }}>{s.slot}</td>
                  </tr>
                  {open === s.pair && (
                    <tr><td colSpan={10} style={{ ...td, whiteSpace: "normal", background: "var(--bg-card-2)", fontSize: 12, lineHeight: 1.6 }}>
                      <StoryChart s={s} />
                      <div><b>Start price</b> {fmt(s.startPrice)} · <b>now</b> {fmt(s.now)} · <b>1 unit</b> {s.unitPct.toFixed(2)}%</div>
                      <div><b>Half 1</b> entry {fmt(s.plan?.startHalf?.entry)}, stop {fmt(s.plan?.startHalf?.stop)} · <b>Half 2</b> at {fmt(s.plan?.dipHalf?.level)} (until {s.plan?.window ?? "—"}), stop {fmt(s.plan?.dipHalf?.stop)} · <b>half off</b> at {fmt(s.plan?.partial13)}</div>
                      {s.priced && <div><b>Priced</b> long side: 2y {s.priced.long?.twoYear ?? "—"} vs policy {s.priced.long?.policy ?? "—"} ({s.priced.long?.spreadBp ?? "—"}bp, 4w {s.priced.long?.chg4wBp ?? "—"}bp) · short side: 2y {s.priced.short?.twoYear ?? "—"} vs policy {s.priced.short?.policy ?? "—"} ({s.priced.short?.spreadBp ?? "—"}bp, 4w {s.priced.short?.chg4wBp ?? "—"}bp)</div>}
                      {s.note && <div style={{ color: "var(--text-3)" }}>{s.note}</div>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StoryChart({ s }: { s: Story }) {
  const [bars, setBars] = useState<{ date: string; o: number; h: number; l: number; c: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/macro/chart?pair=${s.pair}`).then(r => r.json()).then(d => d.error ? setErr(d.error) : setBars(d.bars)).catch(e => setErr(String(e)));
  }, [s.pair]);
  if (err) return <div style={{ color: "var(--red)", fontSize: 12 }}>Chart: {err}</div>;
  if (!bars) return <div style={{ color: "var(--text-3)", fontSize: 12 }}>Loading chart…</div>;

  const W = 900, TOP = 300, BOT = 110, PAD = 46, n = bars.length, bw = (W - PAD - 8) / n;
  const x = (i: number) => PAD + i * bw + bw / 2;
  const levels = [
    { v: s.startPrice, c: "var(--text-3)", t: "start" },
    { v: s.plan?.dipHalf?.level, c: "var(--accent)", t: "dip (half 2)" },
    { v: s.plan?.startHalf?.stop, c: "var(--red)", t: "stop half 1" },
    { v: s.plan?.dipHalf?.stop, c: "var(--red)", t: "stop half 2" },
    { v: s.plan?.partial13, c: "var(--green)", t: "half off 1:3" },
  ].filter(l => typeof l.v === "number");
  const hi = Math.max(...bars.map(b => b.h), ...levels.map(l => l.v)), lo = Math.min(...bars.map(b => b.l), ...levels.map(l => l.v));
  const y = (p: number) => 8 + (hi - p) / (hi - lo || 1) * (TOP - 16);
  const idx = (d: string) => { const k = bars.findIndex(b => b.date >= d); return k < 0 ? n - 1 : k; };
  const hist = (s.history ?? []).filter(h => h.w >= bars[0].date);
  const gaps = hist.map(h => h.gap), rates = hist.map(h => (h.y2Gap ?? h.policyGap) as number | null).filter((v): v is number => v != null);
  const gy = (g: number) => TOP + 15 + (4 - Math.max(-4, Math.min(4, g))) / 8 * (BOT - 25);   // story gap on a fixed -4..+4 scale
  const rMin = Math.min(...rates, 0), rMax = Math.max(...rates, 0);
  const ry = (v: number) => TOP + 15 + (rMax - v) / (rMax - rMin || 1) * (BOT - 25);
  const step = (pts: [number, number][]) => pts.map(([px, py], k) => k === 0 ? `M${px},${py}` : `H${px} V${py}`).join(" ") + (pts.length ? ` H${W - 8}` : "");
  const si = idx(s.since);
  return (
    <svg viewBox={`0 0 ${W} ${TOP + BOT}`} style={{ width: "100%", height: "auto", background: "var(--bg-card)", borderRadius: 8 }}>
      {/* candles */}
      {bars.map((b, i) => {
        const up = b.c >= b.o, col = up ? "var(--green)" : "var(--red)";
        return <g key={b.date}><line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={1} />
          <rect x={x(i) - bw * 0.35} width={Math.max(1, bw * 0.7)} y={y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} fill={col} /></g>;
      })}
      {/* plan levels */}
      {levels.map(l => <g key={l.t}><line x1={PAD} x2={W - 8} y1={y(l.v)} y2={y(l.v)} stroke={l.c} strokeDasharray="4 3" strokeWidth={1} />
        <text x={W - 10} y={y(l.v) - 3} fontSize={9.5} textAnchor="end" fill={l.c}>{l.t} {fmt(l.v)}</text></g>)}
      {/* story start */}
      <line x1={x(si)} x2={x(si)} y1={0} y2={TOP + BOT} stroke="var(--accent)" strokeWidth={1} opacity={0.6} />
      <text x={x(si) + 4} y={12} fontSize={10} fill="var(--accent)">story since {s.since}</text>
      {/* price axis */}
      {[hi, (hi + lo) / 2, lo].map(p => <text key={p} x={4} y={y(p) + 3} fontSize={9.5} fill="var(--text-3)" style={mono}>{fmt(p)}</text>)}
      {/* lower panel */}
      <line x1={PAD} x2={W - 8} y1={TOP} y2={TOP} stroke="var(--border)" />
      <line x1={PAD} x2={W - 8} y1={gy(0)} y2={gy(0)} stroke="var(--border)" strokeDasharray="2 3" />
      <path d={step(hist.map(h => [x(idx(h.w)), gy(h.gap)]))} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      {rates.length > 1 && <path d={hist.filter(h => (h.y2Gap ?? h.policyGap) != null).map((h, k) => `${k ? "L" : "M"}${x(idx(h.w))},${ry((h.y2Gap ?? h.policyGap) as number)}`).join(" ")}
        fill="none" stroke="var(--amber)" strokeWidth={1.5} />}
      <text x={PAD} y={TOP + 12} fontSize={10} fill="var(--accent)">story gap ({s.side.split(" ")[1]} − other){gaps.length ? ` · now ${s.gap}` : " · no history yet"}</text>
      <text x={PAD + 230} y={TOP + 12} fontSize={10} fill="var(--amber)">{hist.some(h => h.y2Gap != null) ? "2-year yield gap" : "policy-rate gap"} (pp)</text>
    </svg>
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
        <StoriesSection stories={run.stories ?? []} />
        {/* ── calls & trades ────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Landmark size={14} />} title="Calls and trades" count={[...callsA.values()].filter((c) => c.direction !== "NONE").length}
            note="A = tested briefing (drives trades) · B = deeper story (logged only) · trade at score ≥ 2" />
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-card)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--text-label)", textAlign: "left", fontSize: 11 }}>
                  {["", "Pair", "Tested call (A)", "Deeper story (B)", "Divergence · moves first", "2-year check", "Score", "Risk", "Position", "A and B agree"].map((h) => (
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
                      <td style={{ padding: "9px 10px", whiteSpace: "nowrap", color: /^agree/i.test(s?.components?.twoYearCheck ?? "") ? "var(--green)" : /^against/i.test(s?.components?.twoYearCheck ?? "") ? "var(--red)" : "var(--text-2)" }}>{s?.components?.twoYearCheck ?? "—"}</td>
                      <td style={{ ...mono, padding: "9px 10px", color: (s?.alignment ?? 0) >= 2 ? "var(--green)" : "var(--text-3)" }}>{s?.alignment ?? "—"}</td>
                      <td style={{ ...mono, padding: "9px 10px" }}>{s ? `${s.riskPct}%` : "—"}</td>
                      <td style={{ ...mono, padding: "9px 10px", fontSize: 11.5 }}>{pos ? <>{pos.side} {fmt(pos.userFill ?? pos.entry)} <span style={{ color: "var(--text-3)" }}>stop {fmt(pos.userStop ?? pos.stop)}</span></> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                      <td style={{ padding: "9px 10px" }}>{agree == null ? "—" : agree
                        ? <Check size={14} style={{ color: "var(--green)" }} />
                        : <AlertTriangle size={14} style={{ color: "var(--amber)" }} />}</td>
                    </tr>,
                    isOpen && (
                      <tr key={p + "-x"}><td colSpan={10} style={{ padding: "4px 16px 14px 38px", background: "var(--bg-card-raised)", fontSize: 12.5, color: "var(--text-body)" }}>
                        {a && <p style={{ margin: "8px 0" }}><b style={{ color: "var(--text-label)" }}>Tested call (A):</b> <Cited text={a.reason} ev={ev} open={openRef} setOpen={setOpenRef} /></p>}
                        {b && <p style={{ margin: "8px 0" }}><b style={{ color: "var(--text-label)" }}>Deeper story (B):</b> <Cited text={b.reason} ev={ev} open={openRef} setOpen={setOpenRef} /></p>}
                        {s?.components?.hiddenStory && <p style={{ margin: "8px 0" }}><b style={{ color: "var(--text-label)" }}>Hidden story:</b> <Cited text={s.components.hiddenStory} ev={ev} open={openRef} setOpen={setOpenRef} /></p>}
                        {s?.components?.priced && <p style={{ margin: "8px 0" }}><b style={{ color: "var(--text-label)" }}>Priced:</b> <Cited text={s.components.priced} ev={ev} open={openRef} setOpen={setOpenRef} /></p>}
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
        {/* One row per economy, read left to right: what the bank did → what the data is doing (trend,
            in the bank's own measure) → what the bank itself projects → what the market already prices →
            what the bank does next → the signal and why. Every number is an evidence chip. */}
        <section>
          <SectionHeader icon={<Landmark size={14} />} title="Central banks" count={run.cards.length}
            note="▲ hawkish / strengthening · ▼ dovish / weakening · ↔ dilemma — the edge is data running past what's priced" />
          {run.cards.length === 0 ? <EmptyState small text="No bank cards in this run." /> : (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", background: "var(--bg-card)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, lineHeight: 1.55 }}>
                <thead>
                  <tr style={{ color: "var(--text-label)", textAlign: "left", fontSize: 11 }}>
                    {["Economy", "Rate & last move", "Inflation trend", "Labour trend", "Bank's own projection", "Priced (2-year)", "Next move", "Signal"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {[...run.cards].sort((x, y) => CCY_ORDER.indexOf(x.currency) - CCY_ORDER.indexOf(y.currency)).map((c) => {
                    const d = c.decision ?? {}, inf = c.inflation ?? {}, lab = c.labour ?? {}, pr = c.pricing ?? {};
                    const arrow = c.verdict === "strengthening" ? "▲" : c.verdict === "weakening" ? "▼" : "↔";
                    const cell = { padding: "11px 12px", verticalAlign: "top", borderBottom: "1px solid var(--border-subtle)" } as const;
                    const cite = (t: unknown) => (t == null || t === "" ? <span style={{ color: "var(--text-3)" }}>—</span>
                      : <Cited text={String(t)} ev={ev} open={openRef} setOpen={setOpenRef} />);
                    const sub = (t: unknown) => (t ? <div style={{ color: "var(--text-2)", fontSize: 11.5, marginTop: 2 }}>{cite(t)}</div> : null);
                    return (
                      <tr key={c.id}>
                        <td style={{ ...cell, whiteSpace: "nowrap" }}>
                          <b style={{ color: "var(--text-1)" }}>{c.currency}</b> <span style={{ color: "var(--text-3)" }}>/ {c.bank}</span>
                          {d.target && <div style={{ color: "var(--text-3)", fontSize: 11 }}>target {d.target}</div>}
                        </td>
                        <td style={{ ...cell, minWidth: 150 }}>{cite(d.rate)}{sub(d.lastMove)}</td>
                        <td style={{ ...cell, minWidth: 180 }}>
                          {inf.measure && <div style={{ color: "var(--text-3)", fontSize: 11 }}>{inf.measure}</div>}
                          {cite(inf.trend)}{sub(inf.other)}
                        </td>
                        <td style={{ ...cell, minWidth: 170 }}>{cite(lab.trend)}{sub(lab.other)}</td>
                        <td style={{ ...cell, minWidth: 220 }}>{cite(d.ownProjection)}{sub(d.guidance)}
                          {d.vsOwn && <div style={{ marginTop: 4, fontSize: 11.5, color: tone(d.vsOwn) }}>{d.vsOwn}</div>}
                        </td>
                        <td style={{ ...cell, minWidth: 160 }}>{cite(pr.twoYear)}{sub(pr.priced)}</td>
                        <td style={{ ...cell, whiteSpace: "nowrap" }}>
                          <b style={{ color: tone(d.nextMove ?? "") }}>{d.nextMove ?? "—"}</b> <span style={{ color: "var(--text-2)" }}>· {d.when ?? "—"}</span>
                          <div style={{ color: /^forced/i.test(d.forced ?? "") ? "var(--amber)" : "var(--text-2)" }}>{d.forced ?? "—"}</div>
                          <div style={{ color: "var(--text-3)" }}>pressure {d.pressure ?? "—"}</div>
                        </td>
                        <td style={{ ...cell, minWidth: 300 }}>
                          <b style={{ color: tone(c.verdict) }}>{arrow} {c.stance[0].toUpperCase() + c.stance.slice(1)}</b>{" "}
                          {d.why && <span style={{ color: "var(--text-body)" }}>{cite(d.why)}</span>}
                          <div style={{ marginTop: 4, color: "var(--text-2)", fontSize: 12 }}>
                            <span style={{ color: "var(--text-label)" }}>Changes the view: </span>{cite(c.changeView)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
