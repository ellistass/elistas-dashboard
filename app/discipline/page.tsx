"use client";
// app/discipline/page.tsx — Discipline: am I following the rules?
//
// Scored separately from profit, because the backtest edge only holds if the
// rules are followed. Rule breaks are logged automatically where the dashboard
// can see them (the gate, missed stop moves, missed planned exits) or by you.
// Skips are decisions too, and are reviewed like trades.

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";
import { todayUtc } from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const inp = { ...mono, fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", width: "100%" } as const;
const btn = { ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-strong)", color: "var(--text-1)" } as const;
const lbl = { ...mono, fontSize: 9.5, color: "var(--text-3)", display: "grid", gap: 3 } as const;
const td = { padding: "6px 8px", verticalAlign: "top" } as const;
const h3 = { ...mono, fontSize: 11, color: "var(--text-3)", margin: "24px 0 8px" } as const;

const RULES: [string, string][] = [
  ["Entry", "Daily close beyond the break level only; limit at the edge; never chase the break"],
  ["Levels", "Entry, stop and take-profit placed exactly as the card, sized from the card's stop. Uneasy? Cut size, never widen the stop"],
  ["Size", "$100 per trade; $50 for a B-grade with one failed check; two failed checks = pass"],
  ["Accounts", "50k: A-grades only. 15k: every valid setup"],
  ["Exposure", "Max 3 trades at risk per account; correlated trades count as one"],
  ["Monthly stop", "50k: −$500 (5R). 15k: −$400 (4R). Hit it = done until the 1st"],
  ["House money", "New risk ≤ half the pot (realised profit + locked stops − open risk)"],
  ["Management", "Stop to breakeven the day +1R is touched; trail 1R behind the best; stops only move in your favour; adjusted once a day after the close"],
  ["Exits", "Trail or cap decides; planned event exits (earnings, deliveries) and the David Paul effort/result exit are the only manual closes"],
  ["Size after wins", "Unchanged. One big winner is not a reason to size up"],
];
const EVENT_TYPES = ["earnings", "deliveries", "central-bank", "data", "other"];

const shiftMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

interface Ev { id: string; kind: string; date: string; instrument: string; rule: string; detail: string; costR: number | null; auto: boolean; reviewedAt: string | null; tradeId: string | null }
interface Score { placed: { ok: number; total: number }; stopMoves: { ok: number; total: number }; exits: { ok: number; total: number }; skips: number; breaks: number; unreviewed: number }

export default function DisciplinePage() {
  const [month, setMonth] = useState(todayUtc().slice(0, 7));
  const [data, setData] = useState<{ events: Ev[]; score: Score } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/swing/discipline?month=${month}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/swing/discipline", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) window.alert((await r.json()).error); else load();
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this entry?")) return;
    await fetch(`/api/swing/discipline?id=${id}`, { method: "DELETE" });
    load();
  };

  const breaks = (data?.events ?? []).filter((e) => e.kind === "break");
  const skips = (data?.events ?? []).filter((e) => e.kind === "skip");

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <SectionHeader
        icon={<ShieldCheck size={14} />}
        title="Discipline"
        note="scored separately from profit"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button style={btn} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={11} /></button>
            <span style={{ ...mono, fontSize: 11.5 }}>{month}</span>
            <button style={btn} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={11} /></button>
          </div>
        }
      />
      {error ? <ErrorCard message={error} /> : null}
      {!data && !error ? <LoadingCard what="discipline" /> : null}

      {data ? (
        <>
          <ScoreStrip s={data.score} />

          <h3 style={h3}>RULE-BREAK LOG · {breaks.length}{data.score.unreviewed ? ` · ${data.score.unreviewed} not reviewed` : ""}</h3>
          <AddBreak onDone={load} />
          {breaks.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                  {["date", "trade", "rule broken", "what happened", "cost (R)", "reviewed", ""].map((h) => <th key={h} style={{ ...td, fontWeight: 400, borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {breaks.map((e) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid var(--border-subtle)", color: e.reviewedAt ? "var(--text-3)" : "var(--text-2)" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{e.date}</td>
                      <td style={{ ...td, color: "var(--text-1)" }}>{e.instrument}</td>
                      <td style={td}>{e.rule}{e.auto ? <span style={{ color: "var(--text-3)" }}> · auto</span> : null}</td>
                      <td style={{ ...td, maxWidth: 460 }}>{e.detail}</td>
                      <td style={td}>
                        <input style={{ ...inp, width: 70 }} defaultValue={e.costR ?? ""} placeholder="pending"
                          onBlur={(x) => { if (x.target.value !== String(e.costR ?? "")) patch({ id: e.id, costR: x.target.value }); }} />
                      </td>
                      <td style={td}><input type="checkbox" checked={!!e.reviewedAt} onChange={(x) => patch({ id: e.id, reviewed: x.target.checked })} /></td>
                      <td style={td}><button onClick={() => remove(e.id)} title="delete" style={{ color: "var(--text-3)" }}><Trash2 size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState text="No rule breaks this month." small />}

          <h3 style={h3}>SKIP LOG · {skips.length}</h3>
          {skips.length ? (
            <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {skips.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-2)" }}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{e.date}</td>
                    <td style={{ ...td, color: "var(--text-1)" }}>{e.instrument}</td>
                    <td style={td}>{e.rule}</td>
                    <td style={td}>{e.detail}</td>
                    <td style={td}><button onClick={() => remove(e.id)} title="delete" style={{ color: "var(--text-3)" }}><Trash2 size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState text="No skips logged. Use Skip on a setup card to log one with its reason." small />}

          <h3 style={h3}>THE RULES</h3>
          <div className="card" style={{ padding: 4 }}>
            <table style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {RULES.map(([a, r]) => (
                  <tr key={a} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>{a}</td>
                    <td style={{ ...td, color: "var(--text-body)" }}>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginTop: 8, lineHeight: 1.6 }}>
            Pre-trade gate ("took it" on a setup card): slot free under the cap · worst case inside the monthly stop · not correlated with an open loser ·
            no event inside the hold · margin use under 40% · grade allowed in the account · blind read locked first.
          </p>

          <EventDates />
        </>
      ) : null}
    </div>
  );
}

function pct(x: { ok: number; total: number }) { return x.total ? `${Math.round((100 * x.ok) / x.total)}%` : "—"; }

function ScoreStrip({ s }: { s: Score }) {
  const tile = (label: string, value: string, sub: string, good: boolean | null) => (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>{label}</div>
      <div style={{ ...mono, fontSize: 22, marginTop: 4, color: good == null ? "var(--text-1)" : good ? "var(--green)" : "var(--amber)" }}>{value}</div>
      <div style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{sub}</div>
    </div>
  );
  const full = (x: { ok: number; total: number }) => (x.total ? x.ok === x.total : null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
      {tile("PLACED EXACTLY AS THE CARD", pct(s.placed), `${s.placed.ok} of ${s.placed.total} trades · target 100%`, full(s.placed))}
      {tile("STOP MOVES BY THE RULE", pct(s.stopMoves), `${s.stopMoves.ok} of ${s.stopMoves.total} · target 100%`, full(s.stopMoves))}
      {tile("PLANNED EXITS KEPT", pct(s.exits), `${s.exits.ok} of ${s.exits.total} · target 100%`, full(s.exits))}
      {tile("SKIPS WITH A REASON", String(s.skips), `${s.breaks} rule break${s.breaks === 1 ? "" : "s"} this month`, null)}
    </div>
  );
}

function AddBreak({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: todayUtc(), instrument: "", rule: RULES[1][0], detail: "", costR: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <button style={{ ...btn, marginBottom: 8 }} onClick={() => setOpen(true)}>log a rule break</button>;
  return (
    <div className="card" style={{ padding: 10, marginBottom: 10, display: "grid", gridTemplateColumns: "110px 110px 150px 1fr 80px auto", gap: 6, alignItems: "end" }}>
      <label style={lbl}>date<input style={inp} value={f.date} onChange={set("date")} /></label>
      <label style={lbl}>trade<input style={inp} placeholder="CSCO short" value={f.instrument} onChange={set("instrument")} /></label>
      <label style={lbl}>rule<select style={inp} value={f.rule} onChange={set("rule")}>{RULES.map(([a]) => <option key={a}>{a}</option>)}</select></label>
      <label style={lbl}>what happened<input style={inp} value={f.detail} onChange={set("detail")} /></label>
      <label style={lbl}>cost (R)<input style={inp} placeholder="pending" value={f.costR} onChange={set("costR")} /></label>
      <button style={btn} onClick={async () => {
        setErr(null);
        const r = await fetch("/api/swing/discipline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "break", ...f }) });
        if (!r.ok) setErr((await r.json()).error); else { setOpen(false); setF({ ...f, instrument: "", detail: "", costR: "" }); onDone(); }
      }}>save</button>
      {err ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)", gridColumn: "1 / -1" }}>{err}</div> : null}
    </div>
  );
}

function EventDates() {
  const [events, setEvents] = useState<{ id: string; date: string; symbol: string; type: string; note: string | null }[] | null>(null);
  const [f, setF] = useState({ date: "", symbol: "", type: "earnings", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/swing/events").then((r) => r.json()).then((j) => setEvents(j.events ?? [])).catch(() => setEvents([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <h3 style={h3}>EVENT DATES · read by the gate and the trade actions</h3>
      <div className="card" style={{ padding: 10, marginBottom: 10, display: "grid", gridTemplateColumns: "110px 110px 130px 1fr auto", gap: 6, alignItems: "end" }}>
        <label style={lbl}>date<input style={inp} placeholder="2026-10-22" value={f.date} onChange={set("date")} /></label>
        <label style={lbl}>symbol / currency<input style={inp} placeholder="TSLA / USD" value={f.symbol} onChange={set("symbol")} /></label>
        <label style={lbl}>type<select style={inp} value={f.type} onChange={set("type")}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label style={lbl}>note<input style={inp} placeholder="Q3 earnings after the close" value={f.note} onChange={set("note")} /></label>
        <button style={btn} onClick={async () => {
          setErr(null);
          const r = await fetch("/api/swing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
          if (!r.ok) setErr((await r.json()).error); else { setF({ ...f, date: "", symbol: "", note: "" }); load(); }
        }}>add</button>
        {err ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)", gridColumn: "1 / -1" }}>{err}</div> : null}
      </div>
      {events && events.length ? (
        <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid var(--border-subtle)", color: e.date < todayUtc() ? "var(--text-3)" : "var(--text-2)" }}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{e.date}</td>
                <td style={{ ...td, color: "var(--text-1)" }}>{e.symbol}</td>
                <td style={td}>{e.type}</td>
                <td style={td}>{e.note}</td>
                <td style={td}><button title="delete" style={{ color: "var(--text-3)" }} onClick={async () => { await fetch(`/api/swing/events?id=${e.id}`, { method: "DELETE" }); load(); }}><Trash2 size={11} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : events ? <EmptyState text="No event dates yet. Add earnings, delivery reports and central-bank meetings for what you trade." small /> : null}
    </>
  );
}
