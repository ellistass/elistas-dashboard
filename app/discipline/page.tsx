"use client";
// app/discipline/page.tsx — Discipline: am I following the rules?
//
// Scored separately from profit, because the backtest edge only holds if the
// rules are followed. Rings for the monthly score, the rule-break log (logged
// automatically by the gate and the evening checks, or by you), skips by
// reason, the event dates the gate reads, and the rules themselves.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, Check, Plus } from "lucide-react";
import { kit as s, Btn, HBars, PageHead, Ring, Section, Tag } from "../_components/swing/kit";
import { addDays, todayUtc } from "@/lib/swing/core";

const RULES: [string, string][] = [
  ["Entry", "Daily close beyond the break level only; limit at the edge; never chase the break"],
  ["Levels", "Entry, stop and take-profit placed exactly as the card, sized from the card's stop. Uneasy? Cut size, never widen the stop"],
  ["Size", "$100 per trade; $50 for a B-grade with one failed check; two failed checks = pass"],
  ["Accounts", "50k: A-grades only. 15k: every valid setup"],
  ["Exposure", "Max 3 trades at risk per account; correlated trades count as one"],
  ["Monthly stop", "50k: −$500 (5R). 15k: −$400 (4R). Hit it = done until the 1st"],
  ["House money", "New risk ≤ half the pot (realised profit + locked stops − open risk)"],
  ["Management", "Stop to breakeven the day +1R is touched; trail 1R behind the best (indices: 2 × ATR); stops only move in your favour; adjusted once a day after the close"],
  ["Exits", "Trail or cap decides; planned event exits (earnings, deliveries) and the David Paul effort/result exit are the only manual closes"],
  ["Size after wins", "Unchanged. One big winner is not a reason to size up"],
];
const EVENT_TYPES = ["earnings", "deliveries", "central-bank", "data", "other"];
/** Rules that cost money directly get the red stripe; process slips get amber. */
const SEVERE = new Set(["Levels", "Size", "Monthly stop", "Exposure", "Accounts"]);

const shiftMonth = (m: string, n: number) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const daysUntil = (d: string) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(todayUtc() + "T00:00:00Z")) / 864e5);

interface Ev { id: string; kind: string; date: string; instrument: string; rule: string; detail: string; costR: number | null; auto: boolean; reviewedAt: string | null }
interface Score { placed: { ok: number; total: number }; stopMoves: { ok: number; total: number }; exits: { ok: number; total: number }; skips: number; breaks: number; unreviewed: number }

export default function DisciplinePage() {
  const [month, setMonth] = useState(todayUtc().slice(0, 7));
  const [data, setData] = useState<{ events: Ev[]; score: Score } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/swing/discipline?month=${month}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/swing/discipline", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setError((await r.json()).error); else load();
  };
  const remove = async (id: string) => { await fetch(`/api/swing/discipline?id=${id}`, { method: "DELETE" }); load(); };

  const breaks = (data?.events ?? []).filter((e) => e.kind === "break");
  const skips = (data?.events ?? []).filter((e) => e.kind === "skip");
  const skipReasons = Object.entries(skips.reduce((m: Record<string, number>, e) => ({ ...m, [e.rule]: (m[e.rule] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const costR = breaks.reduce((x, e) => x + (e.costR ?? 0), 0);

  return (
    <div className={s.page}>
      <PageHead title="Discipline"
        sub={data ? `${data.score.breaks} rule break${data.score.breaks === 1 ? "" : "s"} · ${data.score.unreviewed} not reviewed · ${data.score.skips} skip${data.score.skips === 1 ? "" : "s"} logged${costR ? ` · breaks cost ${costR.toFixed(2)}R` : ""}` : error ?? "Loading…"}
        right={
          <div className={s.row}>
            <Btn onClick={() => setMonth(shiftMonth(month, -1))} aria-label="previous month"><ChevronLeft size={13} /></Btn>
            <span className={s.mono} style={{ fontSize: 14, minWidth: 70, textAlign: "center" }}>{month}</span>
            <Btn onClick={() => setMonth(shiftMonth(month, 1))} aria-label="next month"><ChevronRight size={13} /></Btn>
          </div>
        } />
      {error && data ? <div className={s.small} style={{ color: "var(--red)" }}>{error}</div> : null}

      {data ? (
        <>
          <div className={s.grid3}>
            <Ring label="Placed exactly as the card" ok={data.score.placed.ok} total={data.score.placed.total} />
            <Ring label="Stop moves by the rule" ok={data.score.stopMoves.ok} total={data.score.stopMoves.total} />
            <Ring label="Planned exits kept" ok={data.score.exits.ok} total={data.score.exits.total} />
          </div>

          <Section title="Rule-break log" count={breaks.length} right={<Btn onClick={() => setAdding(!adding)}><Plus size={12} /> Log a break</Btn>}>
            {adding ? <AddBreak onDone={() => { setAdding(false); load(); }} /> : null}
            {breaks.length ? (
              <div className={s.list}>
                {breaks.map((e) => (
                  <div key={e.id} className={s.listRow} style={{
                    gridTemplateColumns: "92px minmax(0,1fr) 90px auto", borderLeft: `3px solid ${e.reviewedAt ? "var(--border-strong)" : SEVERE.has(e.rule) ? "var(--red)" : "var(--amber)"}`,
                    opacity: e.reviewedAt ? 0.6 : 1,
                  }}>
                    <div className={s.small}>{e.date}</div>
                    <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
                      <div className={s.row}><b>{e.instrument}</b><Tag tone={SEVERE.has(e.rule) ? "bad" : "warn"}>{e.rule}</Tag>{e.auto ? <Tag>auto</Tag> : null}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", whiteSpace: "normal" }}>{e.detail}</div>
                    </div>
                    <label className={s.field}>cost (R)
                      <input className={s.input} defaultValue={e.costR ?? ""} placeholder="pending"
                        onBlur={(x) => { if (x.target.value !== String(e.costR ?? "")) patch({ id: e.id, costR: x.target.value }); }} />
                    </label>
                    <div className={s.row} style={{ justifyContent: "flex-end" }}>
                      <Btn onClick={() => patch({ id: e.id, reviewed: !e.reviewedAt })}>{e.reviewedAt ? <><Check size={12} /> Reviewed</> : "Mark reviewed"}</Btn>
                      <Btn aria-label="delete" onClick={() => remove(e.id)}><Trash2 size={12} /></Btn>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className={`${s.card} ${s.empty}`}>No rule breaks this month.</div>}
          </Section>

          <Section title="Skips" count={skips.length} hint="decisions too — reviewed like trades">
            {skips.length ? (
              <div className={s.grid2}>
                <div className={s.card}><HBars rows={skipReasons.map(([r, n]) => ({ label: r, value: n, tone: "fg3" }))} /></div>
                <div className={s.list}>
                  {skips.map((e) => (
                    <div key={e.id} className={s.listRow} style={{ gridTemplateColumns: "88px 70px minmax(0,1fr) auto" }}>
                      <span className={s.small}>{e.date}</span><b>{e.instrument}</b>
                      <span className={s.small} style={{ whiteSpace: "normal" }}>{e.rule}{e.detail ? ` — ${e.detail}` : ""}</span>
                      <Btn aria-label="delete" onClick={() => remove(e.id)}><Trash2 size={12} /></Btn>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div className={`${s.card} ${s.empty}`}>No skips logged. Use <b>Skip</b> on a setup card to log one with its reason.</div>}
          </Section>

          <EventDates />

          <Section title="The rules">
            <div className={s.list}>
              {RULES.map(([a, r]) => (
                <div key={a} className={s.listRow} style={{ gridTemplateColumns: "120px minmax(0,1fr)" }}>
                  <Tag tone={SEVERE.has(a) ? "bad" : "warn"}>{a}</Tag>
                  <span style={{ fontSize: 13, color: "var(--text-body)" }}>{r}</span>
                </div>
              ))}
            </div>
            <div className={s.small} style={{ color: "var(--text-3)" }}>
              The gate ("Took it" on a setup card) checks: slot free under the cap · worst case inside the monthly stop · not correlated with an open loser ·
              no event inside the hold · margin use under 40% · grade allowed in the account · blind read locked first.
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function AddBreak({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ date: todayUtc(), instrument: "", rule: "Levels", detail: "", costR: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className={s.card} style={{ display: "grid", gap: 10, borderColor: "var(--accent)" }}>
      <div className={s.formGrid}>
        <label className={s.field}>date<input className={s.input} value={f.date} onChange={set("date")} /></label>
        <label className={s.field}>trade<input className={s.input} placeholder="CSCO short" value={f.instrument} onChange={set("instrument")} /></label>
        <label className={s.field}>rule<select className={s.input} value={f.rule} onChange={set("rule")}>{RULES.map(([a]) => <option key={a}>{a}</option>)}</select></label>
        <label className={s.field}>cost (R)<input className={s.input} placeholder="pending" value={f.costR} onChange={set("costR")} /></label>
      </div>
      <label className={s.field}>what happened<input className={s.input} value={f.detail} onChange={set("detail")} /></label>
      <div className={s.row}>
        <Btn primary onClick={async () => {
          setErr(null);
          const r = await fetch("/api/swing/discipline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "break", ...f }) });
          if (!r.ok) setErr((await r.json()).error); else onDone();
        }}>Save break</Btn>
        {err ? <span className={s.small} style={{ color: "var(--red)" }}>{err}</span> : null}
      </div>
    </div>
  );
}

function EventDates() {
  const [events, setEvents] = useState<{ id: string; date: string; symbol: string; type: string; note: string | null }[] | null>(null);
  const [f, setF] = useState({ date: "", symbol: "", type: "earnings", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { fetch("/api/swing/events").then((r) => r.json()).then((j) => setEvents(j.events ?? [])).catch(() => setEvents([])); }, []);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const upcoming = (events ?? []).filter((e) => e.date >= todayUtc());
  const past = (events ?? []).filter((e) => e.date < todayUtc() && e.date >= addDays(todayUtc(), -14));
  return (
    <section id="events">
      <Section title="Event dates" count={upcoming.length} hint="the gate and the trade actions read these">
        <div className={s.card} style={{ display: "grid", gap: 10 }}>
          <div className={s.formGrid} style={{ alignItems: "end" }}>
            <label className={s.field}>date<input className={s.input} placeholder="2026-10-22" value={f.date} onChange={set("date")} /></label>
            <label className={s.field}>symbol or currency<input className={s.input} placeholder="TSLA / USD" value={f.symbol} onChange={set("symbol")} /></label>
            <label className={s.field}>type<select className={s.input} value={f.type} onChange={set("type")}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className={s.field}>note<input className={s.input} placeholder="Q3 earnings after the close" value={f.note} onChange={set("note")} /></label>
            <Btn primary onClick={async () => {
              setErr(null);
              const r = await fetch("/api/swing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
              if (!r.ok) setErr((await r.json()).error); else { setF({ ...f, date: "", symbol: "", note: "" }); load(); }
            }}><Plus size={12} /> Add date</Btn>
          </div>
          {err ? <div className={s.small} style={{ color: "var(--red)" }}>{err}</div> : null}
        </div>
        {upcoming.length || past.length ? (
          <div className={s.list}>
            {[...upcoming, ...past].map((e) => {
              const n = daysUntil(e.date);
              return (
                <div key={e.id} className={s.listRow} style={{ gridTemplateColumns: "92px 78px 70px 110px minmax(0,1fr) auto", opacity: n < 0 ? 0.5 : 1 }}>
                  <span className={s.small}>{e.date}</span>
                  <span className={s.mono} style={{ fontSize: 11, color: n >= 0 && n <= 7 ? "var(--amber)" : "var(--text-3)" }}>{n === 0 ? "today" : n > 0 ? `in ${n}d` : `${-n}d ago`}</span>
                  <b>{e.symbol}</b>
                  <Tag tone={e.type === "central-bank" ? "info" : e.type === "earnings" ? "warn" : "plain"}>{e.type}</Tag>
                  <span className={s.small} style={{ whiteSpace: "normal" }}>{e.note}</span>
                  <Btn aria-label="delete" onClick={async () => { await fetch(`/api/swing/events?id=${e.id}`, { method: "DELETE" }); load(); }}><Trash2 size={12} /></Btn>
                </div>
              );
            })}
          </div>
        ) : events ? <div className={`${s.card} ${s.empty}`}>No event dates yet. Add earnings, delivery reports and central-bank meetings for what you trade.</div> : null}
      </Section>
    </section>
  );
}
