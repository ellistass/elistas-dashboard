"use client";
// app/month/page.tsx — Month: am I on plan this month?
//
// One view per account (ledger against the monthly stop and target), what the
// setups did this month, the discipline score, and the month's calendar. The
// settings the swing pages use (balances, contract sizes) live at the bottom.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight, Settings, Trash2 } from "lucide-react";
import { SectionHeader, LoadingCard, ErrorCard, EmptyState } from "../wyckoff/_components/ui";
import { defaultSpec, fmtR, fmtUsd, todayUtc, type InstrumentSpecCfg, type Ledger, type SwingAccountCfg } from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const btn = { ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-strong)", color: "var(--text-1)" } as const;
const inp = { ...mono, fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", width: "100%" } as const;
const lbl = { ...mono, fontSize: 9.5, color: "var(--text-3)", display: "grid", gap: 3 } as const;
const h3 = { ...mono, fontSize: 11, color: "var(--text-3)", margin: "24px 0 8px" } as const;
const td = { padding: "6px 8px", whiteSpace: "nowrap" } as const;

type Counts = { seen: number; filled: number; expired: number; taken: number; skipped: number };
interface Payload {
  month: string;
  accounts: (SwingAccountCfg & { ledger: Ledger; closed: number; closedR: number })[];
  setups: { all: Counts; futures: Counts; forex: Counts; skipsWithoutSetup: number };
  score: { placed: { ok: number; total: number }; stopMoves: { ok: number; total: number }; exits: { ok: number; total: number }; skips: number; breaks: number; unreviewed: number };
  calendar: { date: string; symbol: string; type: string; note: string }[];
}

const shiftMonth = (m: string, n: number) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const pct = (x: { ok: number; total: number }) => (x.total ? `${Math.round((100 * x.ok) / x.total)}%` : "—");

export default function MonthPage() {
  const [month, setMonth] = useState(todayUtc().slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/swing/month?month=${month}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const thisMonth = month === todayUtc().slice(0, 7);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <SectionHeader
        icon={<CalendarRange size={14} />}
        title="Month"
        note="on plan?"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button style={btn} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={11} /></button>
            <span style={{ ...mono, fontSize: 11.5 }}>{month}</span>
            <button style={btn} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={11} /></button>
          </div>
        }
      />
      {error ? <ErrorCard message={error} /> : null}
      {!data && !error ? <LoadingCard what="the month" /> : null}

      {data ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {data.accounts.map((a) => <AccountLedger key={a.key} a={a} thisMonth={thisMonth} />)}
          </div>

          <h3 style={h3}>SETUPS THIS MONTH</h3>
          <div className="card" style={{ padding: 4, overflowX: "auto" }}>
            <table style={{ ...mono, fontSize: 11.5, width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                {["", "seen", "filled", "expired", "taken", "skipped"].map((h) => <th key={h} style={{ ...td, fontWeight: 400 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(["all", "futures", "forex"] as const).map((k) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--border-subtle)", color: k === "all" ? "var(--text-1)" : "var(--text-2)" }}>
                    <td style={td}>{k === "all" ? "all" : k === "futures" ? "futures / stocks" : "forex"}</td>
                    <td style={td}>{data.setups[k].seen}</td>
                    <td style={td}>{data.setups[k].filled}</td>
                    <td style={td}>{data.setups[k].expired}</td>
                    <td style={td}>{data.setups[k].taken}</td>
                    <td style={td}>{data.setups[k].skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 6 }}>
            From the setup log (first seen this month). Filled = the entry was reached; expired = dropped off without a fill.
            {data.setups.skipsWithoutSetup ? ` ${data.setups.skipsWithoutSetup} skip${data.setups.skipsWithoutSetup > 1 ? "s" : ""} couldn't be matched to a logged setup.` : ""}
          </p>

          <h3 style={h3}>DISCIPLINE · <Link href="/discipline" style={{ color: "var(--accent)" }}>details →</Link></h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {[
              ["placed as the card", pct(data.score.placed), `${data.score.placed.ok}/${data.score.placed.total}`],
              ["stop moves by rule", pct(data.score.stopMoves), `${data.score.stopMoves.ok}/${data.score.stopMoves.total}`],
              ["planned exits kept", pct(data.score.exits), `${data.score.exits.ok}/${data.score.exits.total}`],
              ["rule breaks", String(data.score.breaks), `${data.score.unreviewed} not reviewed`],
              ["skips logged", String(data.score.skips), "with a reason"],
            ].map(([k, v, sub]) => (
              <div key={k} className="card" style={{ padding: 10 }}>
                <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>{k}</div>
                <div style={{ ...mono, fontSize: 18 }}>{v}</div>
                <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>{sub}</div>
              </div>
            ))}
          </div>

          <h3 style={h3}>CALENDAR · {data.calendar.length}</h3>
          {data.calendar.length ? (
            <div className="card" style={{ padding: "4px 12px" }}>
              {data.calendar.map((e, i) => (
                <div key={i} style={{ ...mono, fontSize: 11.5, display: "flex", gap: 10, padding: "5px 0", borderTop: i ? "1px solid var(--border-subtle)" : "none",
                  color: e.date < todayUtc() ? "var(--text-3)" : e.type === "clock" ? "var(--amber)" : "var(--text-2)" }}>
                  <span style={{ minWidth: 86 }}>{e.date}</span>
                  <b style={{ minWidth: 60, color: "var(--text-1)" }}>{e.symbol}</b>
                  <span style={{ minWidth: 90 }}>{e.type}</span>
                  <span>{e.note}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState text="Nothing in the calendar." small />}
          <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 6 }}>
            Earnings, deliveries and central-bank meetings come from <Link href="/discipline" style={{ color: "var(--accent)" }}>Discipline → Event dates</Link>.
          </p>

          <SettingsPanel onSaved={load} />
        </>
      ) : null}
    </div>
  );
}

function AccountLedger({ a, thisMonth }: { a: Payload["accounts"][number]; thisMonth: boolean }) {
  const L = a.ledger;
  const progress = Math.max(0, Math.min(1, L.realised / a.monthlyTarget));
  const stopUsed = Math.max(0, Math.min(1, -L.worstCase / a.monthlyStop));
  const row = (k: string, v: string, tone?: string) => (
    <><span style={{ color: "var(--text-3)" }}>{k}</span><span style={{ color: tone, textAlign: "right" }}>{v}</span></>
  );
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{fmtUsd(a.balance)}</span>
      </div>
      <div style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
        {fmtUsd(a.riskPerTrade)} a trade · stop −{fmtUsd(a.monthlyStop)} · target +{fmtUsd(a.monthlyTarget)} · {a.gradesAllowed.join("/")}-grades · {a.maxSlots} slots
      </div>
      {L.stopHit ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)", marginTop: 6 }}>MONTHLY STOP HIT — done until the 1st</div> : null}

      <div style={{ ...mono, fontSize: 11.5, display: "grid", gridTemplateColumns: "1fr auto", rowGap: 3, marginTop: 10 }}>
        {row("realised", `${fmtUsd(L.realised)} · ${a.closed} closed · ${fmtR(a.closedR)}`, L.realised >= 0 ? "var(--green)" : "var(--red)")}
        {row(thisMonth ? "open risk" : "open risk (now)", fmtUsd(L.openRisk))}
        {row("locked by stops", fmtUsd(L.locked), L.locked > 0 ? "var(--green)" : undefined)}
        {row("worst case", `${fmtUsd(L.worstCase)} of −${fmtUsd(a.monthlyStop)}`, L.stopRemaining < a.monthlyStop * 0.4 ? "var(--amber)" : undefined)}
        {row("house pot", `${fmtUsd(L.housePot)} · new risk ≤ ${fmtUsd(L.housePot / 2)}`)}
      </div>

      <Bar label={`target ${Math.round(progress * 100)}%`} frac={progress} tone="var(--green)" />
      <Bar label={`monthly stop used ${Math.round(stopUsed * 100)}% (worst case)`} frac={stopUsed} tone={stopUsed > 0.6 ? "var(--red)" : "var(--amber)"} />
    </div>
  );
}

function Bar({ label, frac, tone }: { label: string; frac: number; tone: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginBottom: 3 }}>{label}</div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--bg-card-2)" }}>
        <div style={{ height: 6, borderRadius: 3, width: `${frac * 100}%`, background: tone }} />
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<{ accounts: SwingAccountCfg[]; specs: InstrumentSpecCfg[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { fetch("/api/swing/settings").then((r) => r.json()).then(setS).catch(() => setErr("couldn't load settings")); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const post = async (body: Record<string, unknown>) => {
    setErr(null);
    const r = await fetch("/api/swing/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { setErr((await r.json()).error); return false; }
    load(); onSaved(); return true;
  };

  return (
    <>
      <h3 style={{ ...h3, display: "flex", gap: 6, alignItems: "center" }}>
        <Settings size={11} /> SETTINGS
        <button style={{ ...btn, fontSize: 9.5, padding: "2px 8px" }} onClick={() => setOpen(!open)}>{open ? "hide" : "show"}</button>
      </h3>
      {open && s ? (
        <div className="card" style={{ padding: 12, display: "grid", gap: 14 }}>
          {err ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)" }}>{err}</div> : null}
          <div style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>ACCOUNTS</div>
          {s.accounts.map((a) => <AccountForm key={a.key} a={a} save={post} />)}
          <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", margin: 0 }}>
            Open question from the spec: each firm's drawdown rule (static or trailing) and daily loss limit set how much room the 50k really has — check them against the monthly stop.
          </p>

          <div style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>CONTRACT SIZES AND MARGIN · per instrument, used for size and margin on the cards · use the setup's symbol (ES, not US500), priced as your broker's CFD</div>
          <SpecTable specs={s.specs} save={post} reload={load} />
        </div>
      ) : null}
    </>
  );
}

function AccountForm({ a, save }: { a: SwingAccountCfg; save: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = useState({ name: a.name, balance: String(a.balance), riskPerTrade: String(a.riskPerTrade), monthlyStop: String(a.monthlyStop), monthlyTarget: String(a.monthlyTarget), grades: a.gradesAllowed.join(","), maxSlots: String(a.maxSlots) });
  const [ok, setOk] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setOk(false); };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "50px 1.4fr repeat(6, 1fr) auto", gap: 6, alignItems: "end" }}>
      <span style={{ ...mono, fontSize: 12, paddingBottom: 5 }}>{a.key}</span>
      <label style={lbl}>name<input style={inp} value={f.name} onChange={set("name")} /></label>
      <label style={lbl}>balance $<input style={inp} value={f.balance} onChange={set("balance")} /></label>
      <label style={lbl}>risk / trade $<input style={inp} value={f.riskPerTrade} onChange={set("riskPerTrade")} /></label>
      <label style={lbl}>monthly stop $<input style={inp} value={f.monthlyStop} onChange={set("monthlyStop")} /></label>
      <label style={lbl}>target $<input style={inp} value={f.monthlyTarget} onChange={set("monthlyTarget")} /></label>
      <label style={lbl}>grades<input style={inp} value={f.grades} onChange={set("grades")} /></label>
      <label style={lbl}>slots<input style={inp} value={f.maxSlots} onChange={set("maxSlots")} /></label>
      <button style={btn} onClick={async () => setOk(await save({
        kind: "account", key: a.key, name: f.name, balance: f.balance, riskPerTrade: f.riskPerTrade, monthlyStop: f.monthlyStop,
        monthlyTarget: f.monthlyTarget, gradesAllowed: f.grades.split(/[,\s/]+/).map((g) => g.trim().toUpperCase()).filter(Boolean), maxSlots: f.maxSlots,
      }))}>{ok ? "saved" : "save"}</button>
    </div>
  );
}

function SpecTable({ specs, save, reload }: { specs: InstrumentSpecCfg[]; save: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void }) {
  const [f, setF] = useState({ instrument: "", unit: "lot", valuePerPoint: "", marginPerUnit: "", sector: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = { ...f, [k]: e.target.value };
    // Typing an instrument pre-fills its current default, so you only change what's wrong.
    if (k === "instrument" && e.target.value.length >= 2 && !f.valuePerPoint) {
      const d = defaultSpec(e.target.value.toUpperCase());
      next.unit = d.unit; next.valuePerPoint = String(d.valuePerPoint); next.sector = d.sector ?? "";
    }
    setF(next);
  };
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr 1.2fr 1fr auto", gap: 6, alignItems: "end" }}>
        <label style={lbl}>instrument<input style={inp} placeholder="ES / TSLA / EURUSD" value={f.instrument} onChange={set("instrument")} /></label>
        <label style={lbl}>unit<select style={inp} value={f.unit} onChange={set("unit")}>{["lot", "share", "contract", "unit"].map((u) => <option key={u}>{u}</option>)}</select></label>
        <label style={lbl}>$ per 1.0 move per unit<input style={inp} value={f.valuePerPoint} onChange={set("valuePerPoint")} /></label>
        <label style={lbl}>margin $ per unit (blank = default %)<input style={inp} value={f.marginPerUnit} onChange={set("marginPerUnit")} /></label>
        <label style={lbl}>sector (stocks)<input style={inp} value={f.sector} onChange={set("sector")} /></label>
        <button style={btn} onClick={async () => { if (await save({ kind: "spec", ...f })) setF({ instrument: "", unit: "lot", valuePerPoint: "", marginPerUnit: "", sector: "" }); }}>save</button>
      </div>
      {specs.length ? (
        <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {specs.map((x) => (
              <tr key={x.instrument} style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-2)" }}>
                <td style={{ ...td, color: "var(--text-1)" }}>{x.instrument}</td>
                <td style={td}>{x.unit}</td>
                <td style={td}>${x.valuePerPoint} per point</td>
                <td style={td}>{x.marginPerUnit != null ? `margin ${fmtUsd(x.marginPerUnit)}/${x.unit}` : "margin: default %"}</td>
                <td style={td}>{x.sector ?? ""}</td>
                <td style={td}><button title="back to default" style={{ color: "var(--text-3)" }} onClick={async () => { await fetch(`/api/swing/settings?instrument=${encodeURIComponent(x.instrument)}`, { method: "DELETE" }); reload(); }}><Trash2 size={11} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", margin: 0 }}>
          No overrides — defaults in use: forex 1 lot = 100,000 units · stocks 1 share · index CFDs $1 a point per lot · gold 100 oz · silver 5,000 oz · oil 1,000 bbl.
          Margin defaults: forex 1:30, stocks 20%, indices 5%, commodities 10%. Set your broker's real figures here.
        </p>
      )}
    </>
  );
}
