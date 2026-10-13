"use client";
// app/filled/page.tsx — every setup after it left /setups: what's the stop tonight,
// and how did the rest play out?
//
// Open fills first (with tonight's stop), then won / lost / breakeven / never
// filled. Click a row for its chart: the range, the order, the fill, the stop
// trail step by step, and the exit.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { kit as s, Btn, CandleChart, Grade, Legend, PageHead, Section, SideTag, Tag, px, rr, type ChartLine } from "../_components/swing/kit";

type Status = "open" | "win" | "loss" | "be" | "expired";
interface Row {
  id: string; market: string; instrument: string; executeSymbol: string; inverted: boolean;
  side: string; entry: string; grade: string; status: Status;
  rangeLo: number; rangeHi: number; rangeStart: string; signalDate: string | null; firstBarDate: string;
  entryPrice: number; origStop: number; target: number | null;
  fillDate: string | null; fillPrice: number | null;
  stopNow: number | null; stopPrev: number | null; stopMoved: boolean; newFill: boolean;
  lockedR: number | null; lastDate: string | null; lastClose: number | null;
  openR: number | null; peakR: number | null; barsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: string | null; resultR: number | null;
  taken: { account: string; status: string } | null;
}
interface Chart { row: Row; candles: [string, number, number, number, number][]; stops: { date: string; stop: number }[] }

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
  const [openId, setOpenId] = useState<string | null>(null);

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
          right={<div className={s.row}>{TABS.map((t) => <Btn key={t.key} primary={tab === t.key} onClick={() => { setTab(t.key); setOpenId(null); }}>{t.label} {count(t.key)}</Btn>)}</div>}>
          {shown.length ? (
            <div className={s.list}>
              {shown.map((r) => (
                <div key={r.id}>
                  <div className={s.listRow} style={{ gridTemplateColumns: "18px minmax(160px,1.3fr) 160px minmax(170px,1fr) 150px", alignItems: "start", cursor: "pointer" }}
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    {openId === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Who r={r} />
                    <Fill r={r} />
                    {r.status === "open" ? <StopNow r={r} /> : <Exit r={r} />}
                    <Result r={r} />
                  </div>
                  {openId === r.id ? <ChartPanel id={r.id} /> : null}
                </div>
              ))}
            </div>
          ) : <div className={`${s.card} ${s.empty}`}>{TABS.find((t) => t.key === tab)!.empty}</div>}
        </Section>
      ) : null}
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

function ChartPanel({ id }: { id: string }) {
  const [c, setC] = useState<Chart | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/setups/filled?id=${encodeURIComponent(id)}`)
      .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? res.statusText); if (live) setC(j); })
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [id]);
  if (err) return <div className={s.small} style={{ color: "var(--red)", padding: "8px 26px" }}>{err}</div>;
  if (!c) return <div className={s.small} style={{ padding: "8px 26px" }}>Loading chart…</div>;

  const r = c.row;
  const idx = (date: string | null) => (date ? c.candles.findIndex((b) => b[0] >= date) : -1);
  const lines: ChartLine[] = [
    { label: r.fillDate ? "fill" : "order", value: r.fillPrice ?? r.entryPrice, tone: "fg2" },
    { label: "first stop", value: r.origStop, tone: "red", dash: true },
    ...(r.stopNow != null && Math.abs(r.stopNow - r.origStop) > 1e-9 ? [{ label: "stop now", value: r.stopNow, tone: "accent" }] : []),
    ...(r.exitPrice != null ? [{ label: "exit", value: r.exitPrice, tone: (r.resultR ?? 0) >= 0 ? "green" : "red" }] : []),
    ...(r.target != null ? [{ label: "cap", value: r.target, tone: "green", dash: true }] : []),
  ];
  const marks = [
    ...(r.signalDate ? [{ date: r.signalDate, label: "break", tone: "fg3" }] : []),
    ...(r.fillDate ? [{ date: r.fillDate, label: "in", tone: "fg2" }] : []),
    ...(r.exitDate ? [{ date: r.exitDate, label: "out", tone: (r.resultR ?? 0) >= 0 ? "green" : "red" }] : []),
  ];
  return (
    <div style={{ padding: "8px 0 14px 26px", display: "grid", gap: 6 }}>
      <CandleChart bars={c.candles} lines={lines} height={260} marks={marks}
        zones={[{ from: r.rangeLo, to: r.rangeHi, tone: "accentDim", startIdx: Math.max(0, idx(r.rangeStart)) }]}
        paths={c.stops.length ? [{ tone: "amber", points: c.stops.map((p) => ({ date: p.date, value: p.stop })) }] : []} />
      <Legend items={[
        { label: "range", tone: "accentDim" }, { label: r.fillDate ? "fill" : "order", tone: "fg2" }, { label: "first stop", tone: "red" },
        ...(c.stops.length ? [{ label: "stop, bar by bar", tone: "amber" }] : []),
        ...(r.exitPrice != null ? [{ label: "exit", tone: (r.resultR ?? 0) >= 0 ? "green" : "red" }] : []),
      ]} />
    </div>
  );
}
