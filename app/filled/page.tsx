"use client";
// app/filled/page.tsx — every setup after it left /setups (range, forex, trend and
// crypto slots): what's the stop tonight, and how did the rest play out?
//
// Open fills first (with tonight's stop), then won / lost / breakeven / never
// filled. Filters: grade, and the account rules — every setup taken (no limits),
// only what the rules take (slots, 4 losers, monthly stop, one per market, card
// skips), or only what they skip. The calendar puts the simulated days next to
// your real trades. Click a row for the Setups chart with the fill, the stop
// trail step by step, and the exit drawn on it.

import { useCallback, useEffect, useState } from "react";
import { Maximize2, RefreshCw } from "lucide-react";
import { kit as s, Btn, Grade, PageHead, Section, SideTag, Tag, px, rr } from "../_components/swing/kit";
import SetupChartFull from "../setups/SetupChartFull";

type Status = "open" | "win" | "loss" | "be" | "expired";
interface RuleCall { taken: boolean; slot: string; reason: string | null }
interface AccountInfo { key: string; name: string; gradesAllowed: string[]; maxSlots: number; stopR: number | null }
interface RealTrade {
  id: string; account: string; instrument: string; executeSymbol: string | null; side: string; grade: string;
  entryDate: string; exitDate: string | null; status: string; resultR: number | null; rNow: number | null; pnlUsd: number | null;
}
type GradeF = "all" | "A" | "B" | "trend";
type ModeF = "every" | "rules" | "skipped";
interface Row {
  id: string; market: string; instrument: string; executeSymbol: string; inverted: boolean;
  side: string; entry: string; grade: string; status: Status;
  rangeLo: number; rangeHi: number; rangeStart: string; signalDate: string | null; firstBarDate: string;
  entryPrice: number; origStop: number; breakevenAt: number; target: number | null;
  fillDate: string | null; fillPrice: number | null;
  stopNow: number | null; stopPrev: number | null; stopMoved: boolean; newFill: boolean;
  lockedR: number | null; lastDate: string | null; lastClose: number | null;
  openR: number | null; peakR: number | null; barsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: string | null; resultR: number | null;
  slot: string | null; weight: number;
  plannedExit: { date: string; event: string } | null;
  rules: Record<string, RuleCall> | null;
  warmup: boolean;
  taken: { account: string; status: string } | null;
}

const TABS: { key: Status; label: string; empty: string }[] = [
  { key: "open", label: "Open", empty: "No filled setups open." },
  { key: "win", label: "Successful", empty: "No winners in the last 120 days." },
  { key: "loss", label: "Failed", empty: "No losers in the last 120 days." },
  { key: "be", label: "Breakeven", empty: "None closed at breakeven." },
  { key: "expired", label: "Never filled", empty: "Every order filled." },
];

const locked = (r: number | null) =>
  r == null ? "—" : r <= -0.99 ? "full risk" : Math.abs(r) < 0.05 ? "breakeven" : r > 0 ? `${rr(r)} locked` : `${rr(r)} at risk`;

/** The date a row belongs to on the page: the latest thing that happened to it. */
const eventDate = (r: Row) =>
  r.status === "open" ? r.fillDate ?? r.firstBarDate
  : r.status === "expired" ? r.firstBarDate
  : r.exitDate ?? r.fillDate ?? r.firstBarDate;

const rowR = (r: Row) => (r.status === "open" ? r.openR : r.status === "expired" ? null : r.resultR);
/** In account R: trend/crypto trades are half risk. */
const acctR = (r: Row) => { const v = rowR(r); return v == null ? null : v * (r.weight ?? 1); };

/** Newest month first, newest day first inside it. */
function groupByMonthDay(rows: Row[]) {
  const months = new Map<string, Map<string, Row[]>>();
  for (const r of [...rows].sort((a, b) => eventDate(b).localeCompare(eventDate(a)))) {
    const d = eventDate(r), m = d.slice(0, 7);
    if (!months.has(m)) months.set(m, new Map());
    const days = months.get(m)!;
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(r);
  }
  return [...months].map(([m, days]) => ({ month: m, days: [...days].map(([d, rs]) => ({ day: d, rows: rs })) }));
}

function Tally({ rows }: { rows: Row[] }) {
  const rs = rows.map(acctR).filter((v): v is number => v != null);
  const net = rs.reduce((a, b) => a + b, 0);
  const w = rs.filter((v) => v > 0.05).length, l = rs.filter((v) => v < -0.05).length;
  return (
    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: "var(--text-3)" }}>
      {rows.length} {rows.length === 1 ? "setup" : "setups"}
      {rs.length ? <> · {w}W {l}L · <span style={{ color: net >= 0 ? "var(--green)" : "var(--red)" }}>{rr(net)}</span></> : null}
    </span>
  );
}

const monthLabel = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (d: string) => new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default function FilledPage() {
  const [data, setData] = useState<{
    rows: Row[]; errors: { instrument: string; error: string }[];
    accounts: AccountInfo[]; real: RealTrade[]; windowStart: string; warmupDays: number;
  } | null>(null);
  const [grade, setGrade] = useState<GradeF>("all");
  const [mode, setMode] = useState<ModeF>("every");
  const [acct, setAcct] = useState("50k");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Status>("open");
  const [popup, setPopup] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/setups/filled");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const gradeOk = (r: Row) => grade === "all" || (grade === "trend" ? r.entry === "trend" : r.grade === grade);
  const call = (r: Row) => r.rules?.[acct] ?? null;
  const modeOk = (r: Row) => mode === "every" || (mode === "rules" ? call(r)?.taken === true : !!call(r) && !call(r)!.taken);
  const rows = (data?.rows ?? []).filter((r) => gradeOk(r) && modeOk(r));
  const real = (data?.real ?? []).filter((t) => t.account === acct && (grade === "all" || grade === "trend" || t.grade === grade));
  const count = (k: Status) => rows.filter((r) => r.status === k).length;
  const shown = rows.filter((r) => r.status === tab);
  const moves = rows.filter((r) => r.status === "open" && r.stopMoved).length;
  const closedR = rows.filter((r) => r.resultR != null && r.status !== "expired").map((r) => r.resultR! * (r.weight ?? 1));
  const avg = closedR.length ? closedR.reduce((a, b) => a + b, 0) / closedR.length : null;
  const net = closedR.reduce((a, b) => a + b, 0);
  const accInfo = data?.accounts.find((a) => a.key === acct);

  return (
    <div className={s.page}>
      <PageHead title="Filled"
        sub={data ? `${count("open")} open · ${moves} stop ${moves === 1 ? "move" : "moves"} tonight · ${count("win")} won · ${count("loss")} lost${avg != null ? ` · ${rr(avg)} average · ${rr(net)} net closed` : ""}` : error ?? "Loading…"}
        right={<Btn onClick={load} disabled={busy}><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh</Btn>} />

      {data?.errors.length ? <div className={`${s.card} ${s.small}`} style={{ color: "var(--amber)" }}>Feed errors: {data.errors.map((e) => e.instrument).join(", ")}, so those markets are missing below.</div> : null}

      {data ? (
        <div className={`${s.card} ${s.small}`} style={{ display: "grid", gap: 8 }}>
          <div className={s.row} style={{ flexWrap: "wrap" }}>
            <span style={{ width: 56 }}>Grade</span>
            {(["all", "A", "B", "trend"] as const).map((g) => (
              <Btn key={g} primary={grade === g} onClick={() => setGrade(g)}>{g === "all" ? "All grades" : g === "trend" ? "Trend / crypto" : `Grade ${g}`}</Btn>
            ))}
          </div>
          <div className={s.row} style={{ flexWrap: "wrap" }}>
            <span style={{ width: 56 }}>Trades</span>
            <Btn primary={mode === "every"} onClick={() => setMode("every")}>Every setup taken</Btn>
            <Btn primary={mode === "rules"} onClick={() => setMode("rules")}>Taken by the rules</Btn>
            <Btn primary={mode === "skipped"} onClick={() => setMode("skipped")}>Skipped by the rules</Btn>
            <span style={{ width: 12 }} />
            {data.accounts.map((a) => <Btn key={a.key} primary={acct === a.key} onClick={() => setAcct(a.key)}>{a.key}</Btn>)}
          </div>
          <div className={s.row} style={{ flexWrap: "wrap" }}>
            <span style={{ width: 56 }}>View</span>
            <Btn primary={view === "list"} onClick={() => setView("list")}>List</Btn>
            <Btn primary={view === "calendar"} onClick={() => setView("calendar")}>Calendar · simulated vs real</Btn>
          </div>
          <div style={{ color: "var(--text-3)", lineHeight: 1.6 }}>
            {mode === "every" ? "Every setup that filled, as if all were taken — no slot, loss or monthly limits."
              : `${accInfo?.key ?? acct} rules: ${accInfo?.gradesAllowed.join("/") ?? "A"} only in the ${accInfo?.maxSlots ?? 3} range slots · trend 1 slot · crypto 1 slot (both ½ risk) · a trade at breakeven frees its slot · correlated trades share a slot unless the other is losing · one trade per market · stop after 4 losers in a month · monthly stop ${accInfo?.stopR ?? 5}R (worst case) · the card's own skips (not on FTMO, forex COT skip, 4h heavy first drop).`}
            {" "}Events inside a hold (Discipline → Event dates) exit at the close the day before. R totals are account R (½-risk trades count half).
            {mode !== "every" ? ` Fills in the first ${data.warmupDays} days (before ${addDaysIso(data.windowStart, data.warmupDays)}) are warming up: the rules don't see trades from before the window, so slots look emptier than they were.` : ""}
          </div>
        </div>
      ) : null}

      {data && view === "calendar" ? <Calendar rows={rows} real={real} onPick={setPopup} /> : null}

      {data && view === "list" ? (
        <Section title={TABS.find((t) => t.key === tab)!.label} count={shown.length}
          hint={tab === "open" ? "Stops follow the card: breakeven at +1R, then the trail. Set them after the close." : "Last 120 days, played out under the card's rules."}
          right={<div className={s.row}>{TABS.map((t) => <Btn key={t.key} primary={tab === t.key} onClick={() => { setTab(t.key); }}>{t.label} {count(t.key)}</Btn>)}</div>}>
          {shown.length ? (
            groupByMonthDay(shown).map(({ month, days }) => (
              <div key={month} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 2px", borderBottom: "1px solid var(--border)" }}>
                  <b style={{ fontSize: 13 }}>{monthLabel(month)}</b>
                  <Tally rows={days.flatMap((d) => d.rows)} />
                </div>
                {days.map(({ day, rows: dr }) => (
                  <div key={day} style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 2px 4px", color: "var(--text-2)", fontSize: 11.5 }}>
                      <span>{dayLabel(day)}</span>
                      <Tally rows={dr} />
                    </div>
                    <div className={s.list}>
                      {dr.map((r) => (
                        <div key={r.id} className={s.listRow} title="Click for the chart"
                          style={{ gridTemplateColumns: "18px minmax(160px,1.3fr) 160px minmax(170px,1fr) 150px", alignItems: "start", cursor: "zoom-in" }}
                          onClick={() => setPopup(r)}>
                          <Maximize2 size={12} style={{ marginTop: 3, color: "var(--text-3)" }} />
                          <Who r={r} acct={acct} />
                          <Fill r={r} />
                          {r.status === "open" ? <StopNow r={r} /> : <Exit r={r} />}
                          <Result r={r} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          ) : <div className={`${s.card} ${s.empty}`}>{TABS.find((t) => t.key === tab)!.empty}</div>}
        </Section>
      ) : null}
      {popup ? <ChartModal r={popup} onClose={() => setPopup(null)} /> : null}
    </div>
  );
}

function Who({ r, acct }: { r: Row; acct: string }) {
  const c = r.rules?.[acct] ?? null;
  return (
    <div className={s.row} style={{ flexWrap: "wrap" }}>
      <b>{r.executeSymbol}</b>{r.executeSymbol !== r.instrument ? <span className={s.small}>{r.instrument}</span> : null}
      <SideTag side={r.side} /><Grade g={r.grade} />
      <span className={s.small}>{r.entry === "trend" ? `${r.market} slot · ½ risk` : r.entry}</span>
      {c ? (c.taken
        ? <Tag tone="good">rules: take{c.reason ? ` · ${c.reason}` : ""}</Tag>
        : <Tag tone="plain">rules: skip · {c.reason}</Tag>) : null}
      {c && r.warmup ? <span className={s.small}>warming up</span> : null}
      {r.taken ? <Tag tone="info">{r.taken.status === "pending" ? "your order · waiting" : r.taken.status === "cancelled" ? "your order · cancelled" : "you took it"} · {r.taken.account}</Tag> : r.fillDate ? <span className={s.small}>you: not taken</span> : null}
      {r.plannedExit ? <Tag tone="warn">exit {r.plannedExit.date} close · {r.plannedExit.event}</Tag> : null}
      {r.inverted ? <span className={s.small}>prices are the future's — translate to {r.executeSymbol}</span> : null}
    </div>
  );
}

function Fill({ r }: { r: Row }) {
  if (!r.fillDate) return <div className={s.small}>order {px(r.entryPrice)}<div>seen {r.firstBarDate} · never filled</div></div>;
  return (
    <div className={s.small}>
      in <b className={s.mono}>{px(r.fillPrice)}</b> · {r.fillDate}
      <div>{r.barsHeld} {r.barsHeld === 1 ? "bar" : "bars"} · first stop {px(r.origStop)}</div>
    </div>
  );
}

function StopNow({ r }: { r: Row }) {
  return (
    <div>
      <div className={s.row}>
        <span className={s.small}>stop next session</span>
        <b className={s.mono} style={{ fontSize: 14 }}>{px(r.stopNow)}</b>
        {r.stopMoved ? <Tag tone="warn">move stop</Tag> : r.newFill ? <Tag tone="info">new fill</Tag> : null}
      </div>
      <div className={s.small}>{locked(r.lockedR)}{r.stopMoved && r.stopPrev != null ? ` · was ${px(r.stopPrev)}` : ""}</div>
    </div>
  );
}

function Exit({ r }: { r: Row }) {
  if (!r.exitDate) return <div className={s.small}>—</div>;
  return <div className={s.small}>out <b className={s.mono}>{px(r.exitPrice)}</b> · {r.exitDate}<div>{r.exitReason}</div></div>;
}

function Result({ r }: { r: Row }) {
  const v = r.status === "open" ? r.openR : r.resultR;
  return (
    <div className={s.small} style={{ textAlign: "right" }}>
      {v != null ? <span className={s.mono} style={{ fontSize: 13, color: v >= 0 ? "var(--green)" : "var(--red)" }}>{rr(v)}</span> : "—"}
      {r.status === "open" ? <div>close {px(r.lastClose)} · {r.lastDate}</div> : null}
      {r.fillDate ? <div>peak {rr(r.peakR)}</div> : null}
    </div>
  );
}

/** Same popup as /setups: the Setups chart, plus the fill, the stop trail and the exit. */
function ChartModal({ r, onClose }: { r: Row; onClose: () => void }) {
  const [stops, setStops] = useState<{ date: string; stop: number }[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`/api/setups/filled?id=${encodeURIComponent(r.id)}`)
      .then((res) => res.json()).then((j) => { if (live && Array.isArray(j.stops)) setStops(j.stops); })
      .catch(() => {});                                            // the chart still draws without the trail
    return () => { live = false; };
  }, [r.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const long = r.side === "long";
  const execLong = r.inverted ? !long : long;
  const v = r.status === "open" ? r.openR : r.resultR;
  const mono = { fontFamily: "'DM Mono', monospace" } as const;
  return (
    <div role="dialog" aria-modal="true" aria-label={`${r.instrument} chart`} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1180px, 100%)", maxHeight: "100%", overflow: "auto", background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ ...mono, fontSize: 13 }}>
            <b style={{ fontSize: 16 }}>{r.instrument}</b>
            <span style={{ marginLeft: 10, color: execLong ? "var(--green)" : "var(--red)" }}>
              {execLong ? "BUY" : "SELL"} {r.executeSymbol} · {r.entry} · grade {r.grade}
            </span>
            {v != null ? <span style={{ marginLeft: 10, color: v >= 0 ? "var(--green)" : "var(--red)" }}>{rr(v)}{r.status === "open" ? " open" : ""}</span> : null}
          </div>
          <button onClick={onClose} style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>close (esc)</button>
        </div>
        <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", margin: "8px 0 12px", display: "flex", gap: 18, flexWrap: "wrap" }}>
          {r.fillDate ? <span>in {px(r.fillPrice)} · {r.fillDate}</span> : <span>order {px(r.entryPrice)} · never filled</span>}
          <span style={{ color: "var(--red)" }}>first stop {px(r.origStop)}</span>
          {r.status === "open" ? <span style={{ color: "var(--amber)" }}>stop next session {px(r.stopNow)} · {locked(r.lockedR)}</span> : null}
          {r.exitDate ? <span style={{ color: (r.resultR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>out {px(r.exitPrice)} · {r.exitDate} · {r.exitReason}</span> : null}
          {r.fillDate ? <span style={{ color: "var(--text-3)" }}>peak {rr(r.peakR)}</span> : null}
          <span style={{ color: "var(--amber)" }}>— amber line: the stop, bar by bar</span>
        </div>
        <SetupChartFull
          instrument={r.instrument} entry={r.entry === "aggressive" || r.entry === "trend" ? "aggressive" : "conservative"} long={long}
          rangeLo={r.rangeLo} rangeHi={r.rangeHi} rangeStart={r.rangeStart} signalDate={r.signalDate ?? r.firstBarDate}
          entryPrice={r.entryPrice} stop={r.origStop} breakevenAt={r.breakevenAt} target={r.target ?? undefined} fmt={(x) => px(x)}
          dataUrl={r.market === "forex" ? `/api/setups/forex/chart?pair=${encodeURIComponent(r.instrument)}` : undefined}
          note={r.entry === "trend" ? "trend slot · box = the 55-day channel the close broke · no target, 3 × ATR trail" : r.inverted ? `prices are the future's — translate to ${r.executeSymbol}` : undefined}
          played={{ fillDate: r.fillDate, fillPrice: r.fillPrice, exitDate: r.exitDate, exitPrice: r.exitPrice,
            win: r.status === "win" ? true : r.status === "loss" ? false : null, stops }} />
      </div>
    </div>
  );
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10) + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

/** Month grid: each day = the simulated trades that closed that day (under the filters above)
 *  next to your real trades that closed that day. Click a day for its trades. */
function Calendar({ rows, real, onPick }: { rows: Row[]; real: RealTrade[]; onPick: (r: Row) => void }) {
  const sim = rows.filter((r) => r.exitDate && r.status !== "open" && r.status !== "expired");
  const realClosed = real.filter((t) => t.status === "closed" && t.exitDate);
  const months = [...new Set([...sim.map((r) => r.exitDate!.slice(0, 7)), ...realClosed.map((t) => t.exitDate!.slice(0, 7)), new Date().toISOString().slice(0, 7)])].sort();
  const [month, setMonth] = useState(months[months.length - 1]);
  const [day, setDay] = useState<string | null>(null);
  const mi = months.indexOf(month);

  const simBy = new Map<string, Row[]>(), realBy = new Map<string, RealTrade[]>();
  for (const r of sim) simBy.set(r.exitDate!.slice(0, 10), [...(simBy.get(r.exitDate!.slice(0, 10)) ?? []), r]);
  for (const t of realClosed) realBy.set(t.exitDate!.slice(0, 10), [...(realBy.get(t.exitDate!.slice(0, 10)) ?? []), t]);
  const sumSim = (rs: Row[]) => rs.reduce((a, r) => a + (acctR(r) ?? 0), 0);
  const sumReal = (ts: RealTrade[]) => ts.reduce((a, t) => a + (t.resultR ?? 0), 0);

  const first = new Date(month + "-01T00:00:00Z");
  const lead = (first.getUTCDay() + 6) % 7;                     // Monday first
  const nDays = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);

  const mSim = sim.filter((r) => r.exitDate!.startsWith(month)), mReal = realClosed.filter((t) => t.exitDate!.startsWith(month));
  const wl = (vs: number[]) => `${vs.filter((v) => v > 0.05).length}W ${vs.filter((v) => v < -0.05).length}L`;
  const tone = (v: number) => (v > 0.05 ? "var(--green)" : v < -0.05 ? "var(--red)" : "var(--text-3)");
  const mono = { fontFamily: "'DM Mono', monospace" } as const;

  return (
    <div className={s.card} style={{ display: "grid", gap: 10 }}>
      <div className={s.row} style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className={s.row}>
          <Btn disabled={mi <= 0} onClick={() => { setMonth(months[mi - 1]); setDay(null); }}>‹</Btn>
          <b style={{ fontSize: 14 }}>{monthLabel(month)}</b>
          <Btn disabled={mi >= months.length - 1} onClick={() => { setMonth(months[mi + 1]); setDay(null); }}>›</Btn>
        </div>
        <div style={{ ...mono, fontSize: 11, display: "flex", gap: 18 }}>
          <span>simulated <b style={{ color: tone(sumSim(mSim)) }}>{rr(sumSim(mSim))}</b> · {mSim.length} · {wl(mSim.map((r) => acctR(r) ?? 0))}</span>
          <span>real <b style={{ color: tone(sumReal(mReal)) }}>{rr(sumReal(mReal))}</b> · {mReal.length} · {wl(mReal.map((t) => t.resultR ?? 0))}</span>
          <span style={{ color: "var(--text-3)" }}>gap {rr(sumReal(mReal) - sumSim(mSim))}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className={s.small} style={{ textAlign: "center" }}>{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const ss = simBy.get(d) ?? [], rs = realBy.get(d) ?? [];
          const empty = !ss.length && !rs.length;
          return (
            <button key={d} onClick={() => setDay(empty ? null : d)} disabled={empty}
              style={{ ...mono, textAlign: "left", minHeight: 62, padding: "5px 6px", borderRadius: 8, fontSize: 10.5, lineHeight: 1.5,
                border: `1px solid ${day === d ? "var(--text-2)" : "var(--border-subtle)"}`, background: empty ? "transparent" : "var(--surface-2, transparent)",
                cursor: empty ? "default" : "pointer", color: "var(--text-2)" }}>
              <div style={{ color: "var(--text-3)" }}>{Number(d.slice(8))}</div>
              {ss.length ? <div>sim <span style={{ color: tone(sumSim(ss)) }}>{rr(sumSim(ss))}</span> ·{ss.length}</div> : null}
              {rs.length ? <div>real <span style={{ color: tone(sumReal(rs)) }}>{rr(sumReal(rs))}</span> ·{rs.length}</div> : null}
            </button>
          );
        })}
      </div>
      {day ? (
        <div style={{ display: "grid", gap: 6 }}>
          <b style={{ fontSize: 12 }}>{dayLabel(day)}</b>
          {(simBy.get(day) ?? []).map((r) => (
            <div key={r.id} className={s.row} style={{ cursor: "zoom-in", flexWrap: "wrap" }} onClick={() => onPick(r)}>
              <span className={s.small} style={{ width: 40 }}>sim</span><b>{r.executeSymbol}</b><SideTag side={r.side} /><Grade g={r.grade} />
              <span className={s.small}>{r.exitReason}</span>
              <span className={s.mono} style={{ color: tone(acctR(r) ?? 0), marginLeft: "auto" }}>{rr(acctR(r))}{r.weight !== 1 ? " (½)" : ""}</span>
            </div>
          ))}
          {(realBy.get(day) ?? []).map((t) => (
            <div key={t.id} className={s.row} style={{ flexWrap: "wrap" }}>
              <span className={s.small} style={{ width: 40 }}>real</span><b>{t.executeSymbol || t.instrument}</b><SideTag side={t.side} /><Grade g={t.grade} />
              <span className={s.small}>{t.account} · in {t.entryDate}</span>
              <span className={s.mono} style={{ color: tone(t.resultR ?? 0), marginLeft: "auto" }}>{rr(t.resultR)}</span>
            </div>
          ))}
        </div>
      ) : <div className={s.small}>Days show trades by exit date. Click a day to see them; click a simulated trade for its chart.</div>}
    </div>
  );
}
