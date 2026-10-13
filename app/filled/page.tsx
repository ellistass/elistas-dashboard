"use client";
// app/filled/page.tsx — every setup after it left /setups: what's the stop tonight,
// and how did the rest play out?
//
// Open fills first (with tonight's stop), then won / lost / breakeven / never
// filled. Click a row for the Setups page's chart in a popup, with the fill,
// the stop trail step by step, and the exit drawn on it.

import { useCallback, useEffect, useState } from "react";
import { Maximize2, RefreshCw } from "lucide-react";
import { kit as s, Btn, Grade, PageHead, Section, SideTag, Tag, px, rr } from "../_components/swing/kit";
import SetupChartFull from "../setups/SetupChartFull";

type Status = "open" | "win" | "loss" | "be" | "expired";
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

export default function FilledPage() {
  const [data, setData] = useState<{ rows: Row[]; errors: { instrument: string; error: string }[] } | null>(null);
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

  const rows = data?.rows ?? [];
  const count = (k: Status) => rows.filter((r) => r.status === k).length;
  const shown = rows.filter((r) => r.status === tab);
  const moves = rows.filter((r) => r.status === "open" && r.stopMoved).length;
  const closedR = rows.filter((r) => r.resultR != null && r.status !== "expired").map((r) => r.resultR!);
  const avg = closedR.length ? closedR.reduce((a, b) => a + b, 0) / closedR.length : null;

  return (
    <div className={s.page}>
      <PageHead title="Filled"
        sub={data ? `${count("open")} open · ${moves} stop ${moves === 1 ? "move" : "moves"} tonight · ${count("win")} won · ${count("loss")} lost${avg != null ? ` · ${rr(avg)} average closed` : ""}` : error ?? "Loading…"}
        right={<Btn onClick={load} disabled={busy}><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh</Btn>} />

      {data?.errors.length ? <div className={`${s.card} ${s.small}`} style={{ color: "var(--amber)" }}>Feed errors: {data.errors.map((e) => e.instrument).join(", ")}, so those markets are missing below.</div> : null}

      {data ? (
        <Section title={TABS.find((t) => t.key === tab)!.label} count={shown.length}
          hint={tab === "open" ? "Stops follow the card: breakeven at +1R, then the trail. Set them after the close." : "Last 120 days, played out under the card's rules."}
          right={<div className={s.row}>{TABS.map((t) => <Btn key={t.key} primary={tab === t.key} onClick={() => { setTab(t.key); }}>{t.label} {count(t.key)}</Btn>)}</div>}>
          {shown.length ? (
            <div className={s.list}>
              {shown.map((r) => (
                <div key={r.id} className={s.listRow} title="Click for the chart"
                  style={{ gridTemplateColumns: "18px minmax(160px,1.3fr) 160px minmax(170px,1fr) 150px", alignItems: "start", cursor: "zoom-in" }}
                  onClick={() => setPopup(r)}>
                  <Maximize2 size={12} style={{ marginTop: 3, color: "var(--text-3)" }} />
                  <Who r={r} />
                  <Fill r={r} />
                  {r.status === "open" ? <StopNow r={r} /> : <Exit r={r} />}
                  <Result r={r} />
                </div>
              ))}
            </div>
          ) : <div className={`${s.card} ${s.empty}`}>{TABS.find((t) => t.key === tab)!.empty}</div>}
        </Section>
      ) : null}
      {popup ? <ChartModal r={popup} onClose={() => setPopup(null)} /> : null}
    </div>
  );
}

function Who({ r }: { r: Row }) {
  return (
    <div className={s.row} style={{ flexWrap: "wrap" }}>
      <b>{r.executeSymbol}</b>{r.executeSymbol !== r.instrument ? <span className={s.small}>{r.instrument}</span> : null}
      <SideTag side={r.side} /><Grade g={r.grade} />
      <span className={s.small}>{r.entry}</span>
      {r.taken ? <Tag tone="good">taken · {r.taken.account}</Tag> : <Tag tone="plain">not taken</Tag>}
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
          instrument={r.instrument} entry={r.entry === "aggressive" ? "aggressive" : "conservative"} long={long}
          rangeLo={r.rangeLo} rangeHi={r.rangeHi} rangeStart={r.rangeStart} signalDate={r.signalDate ?? r.firstBarDate}
          entryPrice={r.entryPrice} stop={r.origStop} breakevenAt={r.breakevenAt} target={r.target ?? undefined} fmt={(x) => px(x)}
          dataUrl={r.market === "forex" ? `/api/setups/forex/chart?pair=${encodeURIComponent(r.instrument)}` : undefined}
          note={r.inverted ? `prices are the future's — translate to ${r.executeSymbol}` : undefined}
          played={{ fillDate: r.fillDate, fillPrice: r.fillPrice, exitDate: r.exitDate, exitPrice: r.exitPrice,
            win: r.status === "win" ? true : r.status === "loss" ? false : null, stops }} />
      </div>
    </div>
  );
}
