"use client";
// app/month/page.tsx — Month: am I on plan this month?
//
// Each account against its monthly stop and target, the month's trades as R
// with a running total, what the setups did (seen → filled → taken), the
// discipline score, and the month as a calendar. Settings (balances, contract
// sizes) sit at the bottom.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings, Trash2 } from "lucide-react";
import { kit as s, Btn, HBars, PageHead, RBars, Ring, Section, Stat, Tag, rr, usd } from "../_components/swing/kit";
import AccountCard from "../_components/swing/AccountCard";
import { defaultSpec, todayUtc, type InstrumentSpecCfg, type Ledger, type SwingAccountCfg } from "@/lib/swing/core";

type Counts = { seen: number; filled: number; expired: number; taken: number; skipped: number };
interface Payload {
  month: string;
  closedTrades: { account: string; instrument: string; side: string; exitDate: string; resultR: number | null; pnlUsd: number | null }[];
  accounts: (SwingAccountCfg & { ledger: Ledger; closed: number; closedR: number })[];
  setups: { all: Counts; futures: Counts; forex: Counts; skipsWithoutSetup: number };
  score: { placed: { ok: number; total: number }; stopMoves: { ok: number; total: number }; exits: { ok: number; total: number }; skips: number; breaks: number; unreviewed: number };
  calendar: { date: string; symbol: string; type: string; note: string }[];
}

const shiftMonth = (m: string, n: number) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const monthName = (m: string) => new Date(m + "-15T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const TYPE_TONE: Record<string, string> = { earnings: "var(--amber)", deliveries: "var(--amber)", "central-bank": "var(--accent)", cot: "var(--text-3)", clock: "var(--red)", data: "var(--text-2)", other: "var(--text-2)" };

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
  useEffect(() => { load(); }, [load]);

  const totalUsd = data?.accounts.reduce((x, a) => x + a.ledger.realised, 0) ?? 0;
  const totalR = data?.closedTrades.reduce((x, t) => x + (t.resultR ?? 0), 0) ?? 0;

  return (
    <div className={s.page}>
      <PageHead title={monthName(month)}
        sub={data ? `${data.closedTrades.length} trade${data.closedTrades.length === 1 ? "" : "s"} closed · ${usd(totalUsd)} · ${rr(totalR)} · ${data.setups.all.seen} setups seen` : error ?? "Loading…"}
        right={
          <div className={s.row}>
            <Btn onClick={() => setMonth(shiftMonth(month, -1))} aria-label="previous month"><ChevronLeft size={13} /></Btn>
            <Btn onClick={() => setMonth(todayUtc().slice(0, 7))}>This month</Btn>
            <Btn onClick={() => setMonth(shiftMonth(month, 1))} aria-label="next month"><ChevronRight size={13} /></Btn>
          </div>
        } />
      {error && data ? <div className={s.small} style={{ color: "var(--red)" }}>{error}</div> : null}

      {data ? (
        <>
          <div className={s.grid2}>
            {data.accounts.map((a) => (
              <AccountCard key={a.key} a={a} extra={
                <div className={s.stats}>
                  <Stat k="closed" v={`${a.closed} · ${rr(a.closedR)}`} />
                  <Stat k="house pot" v={usd(a.ledger.housePot)} />
                  <Stat k="new risk ≤" v={usd(a.ledger.housePot / 2)} />
                </div>
              } />
            ))}
          </div>

          <Section title="Trades this month" count={data.closedTrades.length}>
            <div className={s.card}><RBars items={data.closedTrades.map((t) => ({ r: t.resultR ?? 0, label: `${t.exitDate} ${t.instrument} ${t.side} (${t.account})` }))} /></div>
          </Section>

          <div className={s.grid2}>
            <Section title="Setups this month" count={data.setups.all.seen}>
              <div className={s.card} style={{ display: "grid", gap: 14 }}>
                <HBars rows={[
                  { label: "seen", value: data.setups.all.seen, tone: "fg3" },
                  { label: "filled", value: data.setups.all.filled, tone: "accent" },
                  { label: "taken", value: data.setups.all.taken, tone: "green" },
                  { label: "skipped", value: data.setups.all.skipped, tone: "amber" },
                  { label: "expired", value: data.setups.all.expired, tone: "fg3" },
                ]} />
                <div className={s.small} style={{ color: "var(--text-3)" }}>
                  futures/stocks {data.setups.futures.seen} seen · {data.setups.futures.taken} taken — forex {data.setups.forex.seen} seen · {data.setups.forex.taken} taken.
                  Filled = the entry was reached; expired = dropped off without a fill.
                </div>
              </div>
            </Section>
            <Section title="Discipline" right={<Link href="/discipline" className={s.small} style={{ color: "var(--accent)" }}>details →</Link>}>
              <div style={{ display: "grid", gap: 10 }}>
                <Ring label="Placed as the card" ok={data.score.placed.ok} total={data.score.placed.total} />
                <Ring label="Stop moves by rule" ok={data.score.stopMoves.ok} total={data.score.stopMoves.total} />
                <div className={s.small}>{data.score.breaks} rule break{data.score.breaks === 1 ? "" : "s"} · {data.score.unreviewed} not reviewed · {data.score.skips} skips</div>
              </div>
            </Section>
          </div>

          <Section title="Calendar" count={data.calendar.length} hint="your event dates, COT nights and US clock changes">
            <MonthGrid month={month} events={data.calendar} />
          </Section>

          <SettingsPanel onSaved={load} />
        </>
      ) : null}
    </div>
  );
}

function MonthGrid({ month, events }: { month: string; events: Payload["calendar"] }) {
  const first = new Date(month + "-01T00:00:00Z");
  const lead = (first.getUTCDay() + 6) % 7;                  // Monday first
  const days: (string | null)[] = Array(lead).fill(null);
  for (let d = new Date(first); d.toISOString().startsWith(month); d = new Date(d.getTime() + 864e5)) days.push(d.toISOString().slice(0, 10));
  while (days.length % 7) days.push(null);
  const today = todayUtc();
  return (
    <div className={s.card} style={{ padding: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className={s.small} style={{ color: "var(--text-3)", padding: "2px 4px" }}>{d}</div>)}
        {days.map((d, i) => {
          const ev = d ? events.filter((e) => e.date === d) : [];
          return (
            <div key={i} style={{
              minHeight: 64, borderRadius: 8, padding: 5, background: d ? "var(--bg-card-2)" : "transparent",
              outline: d === today ? "1.5px solid var(--accent)" : undefined, opacity: d && d < today ? 0.65 : 1, display: "grid", alignContent: "start", gap: 3, minWidth: 0,
            }}>
              {d ? <span className={s.mono} style={{ fontSize: 10.5, color: d === today ? "var(--accent)" : "var(--text-3)" }}>{+d.slice(8)}</span> : null}
              {ev.map((e, k) => (
                <span key={k} title={`${e.symbol} ${e.type} — ${e.note}`} className={s.mono}
                  style={{ fontSize: 9.5, color: TYPE_TONE[e.type] ?? "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  ● {e.type === "cot" ? "COT" : e.type === "clock" ? "clocks" : e.symbol}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <div className={s.legend} style={{ marginTop: 8 }}>
        {[["earnings / deliveries", "var(--amber)"], ["central bank", "var(--accent)"], ["COT 20:30 Lagos", "var(--text-3)"], ["US clock change", "var(--red)"]].map(([l, c]) => (
          <span key={l}><b className={s.legendSwatch} style={{ background: c }} />{l}</span>
        ))}
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<{ accounts: SwingAccountCfg[]; specs: InstrumentSpecCfg[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { fetch("/api/swing/settings").then((r) => r.json()).then(setSt).catch(() => setErr("couldn't load settings")); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const post = async (body: Record<string, unknown>) => {
    setErr(null);
    const r = await fetch("/api/swing/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { setErr((await r.json()).error); return false; }
    load(); onSaved(); return true;
  };
  return (
    <Section title="Settings" right={<Btn onClick={() => setOpen(!open)}><Settings size={12} /> {open ? "Hide" : "Balances and contract sizes"}</Btn>}>
      {open && st ? (
        <div className={s.card} style={{ display: "grid", gap: 16 }}>
          {err ? <div className={s.small} style={{ color: "var(--red)" }}>{err}</div> : null}
          <div style={{ fontWeight: 600 }}>Accounts</div>
          {st.accounts.map((a) => <AccountForm key={a.key} a={a} save={post} />)}
          <div className={s.small} style={{ color: "var(--text-3)" }}>Open question from the spec: each firm's drawdown rule (static or trailing) and daily loss limit set how much room the 50k really has.</div>
          <div style={{ fontWeight: 600 }}>Contract sizes and margin</div>
          <div className={s.small} style={{ color: "var(--text-3)" }}>Per instrument, used for size and margin on the cards. Use the setup's symbol (ES, not US500), priced as your broker's CFD.</div>
          <SpecTable specs={st.specs} save={post} reload={load} />
        </div>
      ) : null}
    </Section>
  );
}

function AccountForm({ a, save }: { a: SwingAccountCfg; save: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = useState({ name: a.name, balance: String(a.balance), riskPerTrade: String(a.riskPerTrade), monthlyStop: String(a.monthlyStop), monthlyTarget: String(a.monthlyTarget), grades: a.gradesAllowed.join(","), maxSlots: String(a.maxSlots) });
  const [ok, setOk] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setOk(false); };
  const fld = (k: keyof typeof f, label: string) => <label className={s.field}>{label}<input className={s.input} value={f[k]} onChange={set(k)} /></label>;
  return (
    <div className={s.formGrid} style={{ alignItems: "end" }}>
      <div className={s.row}><Tag tone="info">{a.key}</Tag></div>
      {fld("name", "name")}{fld("balance", "balance $")}{fld("riskPerTrade", "risk / trade $")}{fld("monthlyStop", "monthly stop $")}
      {fld("monthlyTarget", "target $")}{fld("grades", "grades")}{fld("maxSlots", "slots")}
      <Btn primary onClick={async () => setOk(await save({
        kind: "account", key: a.key, name: f.name, balance: f.balance, riskPerTrade: f.riskPerTrade, monthlyStop: f.monthlyStop,
        monthlyTarget: f.monthlyTarget, gradesAllowed: f.grades.split(/[,\s/]+/).map((g) => g.trim().toUpperCase()).filter(Boolean), maxSlots: f.maxSlots,
      }))}>{ok ? "Saved" : "Save"}</Btn>
    </div>
  );
}

function SpecTable({ specs, save, reload }: { specs: InstrumentSpecCfg[]; save: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void }) {
  const blank = { instrument: "", unit: "lot", valuePerPoint: "", marginPerUnit: "", sector: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = { ...f, [k]: e.target.value };
    if (k === "instrument" && e.target.value.length >= 2 && !f.valuePerPoint) {
      const d = defaultSpec(e.target.value.toUpperCase());
      next.unit = d.unit; next.valuePerPoint = String(d.valuePerPoint); next.sector = d.sector ?? "";
    }
    setF(next);
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className={s.formGrid} style={{ alignItems: "end" }}>
        <label className={s.field}>instrument<input className={s.input} placeholder="ES / TSLA / EURUSD" value={f.instrument} onChange={set("instrument")} /></label>
        <label className={s.field}>unit<select className={s.input} value={f.unit} onChange={set("unit")}>{["lot", "share", "contract", "unit"].map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className={s.field}>$ per 1.0 move per unit<input className={s.input} value={f.valuePerPoint} onChange={set("valuePerPoint")} /></label>
        <label className={s.field}>margin $ per unit<input className={s.input} placeholder="blank = default %" value={f.marginPerUnit} onChange={set("marginPerUnit")} /></label>
        <label className={s.field}>sector (stocks)<input className={s.input} value={f.sector} onChange={set("sector")} /></label>
        <Btn primary onClick={async () => { if (await save({ kind: "spec", ...f })) setF(blank); }}>Save size</Btn>
      </div>
      {specs.length ? (
        <div className={s.list}>
          {specs.map((x) => (
            <div key={x.instrument} className={s.listRow} style={{ gridTemplateColumns: "90px 70px 1fr 1fr 90px auto" }}>
              <b>{x.instrument}</b><span className={s.small}>{x.unit}</span><span className={s.small}>${x.valuePerPoint} per point</span>
              <span className={s.small}>{x.marginPerUnit != null ? `margin ${usd(x.marginPerUnit)}/${x.unit}` : "margin: default %"}</span>
              <span className={s.small}>{x.sector ?? ""}</span>
              <Btn aria-label="back to default" onClick={async () => { await fetch(`/api/swing/settings?instrument=${encodeURIComponent(x.instrument)}`, { method: "DELETE" }); reload(); }}><Trash2 size={12} /></Btn>
            </div>
          ))}
        </div>
      ) : (
        <div className={s.small} style={{ color: "var(--text-3)" }}>
          No overrides — defaults: forex 1 lot = 100,000 units · stocks 1 share · index CFDs $1 a point per lot · gold 100 oz · silver 5,000 oz · oil 1,000 bbl.
          Margin: forex 1:30, stocks 20%, indices 5%, commodities 10%.
        </div>
      )}
    </div>
  );
}
