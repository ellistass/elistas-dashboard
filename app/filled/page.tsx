"use client";
// app/filled/page.tsx — filled setups: what's the stop tonight?
//
// Setups leave /setups the bar after they fill. This page follows each one under
// the card's rules until it's stopped, trailed or timed out, taken or not.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { kit as s, Btn, Grade, PageHead, Section, SideTag, Tag, px, rr } from "../_components/swing/kit";

interface Row {
  id: string; market: string; instrument: string; executeSymbol: string; inverted: boolean;
  side: string; entry: string; grade: string; fillDate: string; fillPrice: number; origStop: number;
  status: "open" | "closed"; stopNow: number | null; stopPrev: number | null; stopMoved: boolean; newFill: boolean;
  lockedR: number | null; lastDate: string | null; lastClose: number | null;
  openR: number | null; peakR: number | null; barsHeld: number;
  exitDate: string | null; exitPrice: number | null; exitReason: string | null; resultR: number | null;
  taken: { account: string; status: string } | null;
}

const locked = (r: number | null) =>
  r == null ? "—" : r <= -0.99 ? "full risk" : Math.abs(r) < 0.05 ? "breakeven" : r > 0 ? `${rr(r)} locked` : `${rr(r)} at risk`;

export default function FilledPage() {
  const [data, setData] = useState<{ rows: Row[]; errors: { instrument: string; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const open = data?.rows.filter((r) => r.status === "open") ?? [];
  const closed = data?.rows.filter((r) => r.status === "closed") ?? [];
  const moves = open.filter((r) => r.stopMoved).length;

  return (
    <div className={s.page}>
      <PageHead title="Filled"
        sub={data ? `${open.length} open · ${moves} stop ${moves === 1 ? "move" : "moves"} tonight · ${closed.length} closed in the last 5 days` : error ?? "Loading…"}
        right={<Btn onClick={load} disabled={busy}><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh</Btn>} />

      {data?.errors.length ? <div className={`${s.card} ${s.small}`} style={{ color: "var(--amber)" }}>Feed errors: {data.errors.map((e) => e.instrument).join(", ")}, so those markets are missing below.</div> : null}

      {data ? (
        <>
          <Section title="Open" count={open.length} hint="Stops follow the card: breakeven at +1R, then the trail. Set them after the close.">
            {open.length ? <div className={s.list}>{open.map((r) => <OpenRow key={r.id} r={r} />)}</div>
              : <div className={`${s.card} ${s.empty}`}>No filled setups open.</div>}
          </Section>
          {closed.length ? (
            <Section title="Closed recently" count={closed.length}>
              <div className={s.list}>{closed.map((r) => (
                <div key={r.id} className={s.listRow} style={{ gridTemplateColumns: "minmax(140px,1fr) 160px 160px 90px" }}>
                  <Who r={r} />
                  <span className={s.small}>in {px(r.fillPrice)} · {r.fillDate}</span>
                  <span className={s.small}>out {px(r.exitPrice)} · {r.exitDate} · {r.exitReason}</span>
                  <span className={s.mono} style={{ textAlign: "right", color: (r.resultR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{rr(r.resultR)}</span>
                </div>
              ))}</div>
            </Section>
          ) : null}
        </>
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

function OpenRow({ r }: { r: Row }) {
  return (
    <div className={s.listRow} style={{ gridTemplateColumns: "minmax(160px,1.3fr) 150px minmax(170px,1fr) 150px", alignItems: "start" }}>
      <Who r={r} />
      <div className={s.small}>
        in <b className={s.mono}>{px(r.fillPrice)}</b> · {r.fillDate}
        <div>{r.barsHeld} {r.barsHeld === 1 ? "bar" : "bars"} · first stop {px(r.origStop)}</div>
      </div>
      <div>
        <div className={s.row}>
          <span className={s.small}>stop next session</span>
          <b className={s.mono} style={{ fontSize: 14 }}>{px(r.stopNow)}</b>
          {r.stopMoved ? <Tag tone="warn">move stop</Tag> : r.newFill ? <Tag tone="info">new fill</Tag> : null}
        </div>
        <div className={s.small}>
          {locked(r.lockedR)}{r.stopMoved && r.stopPrev != null ? ` · was ${px(r.stopPrev)}` : ""}
        </div>
      </div>
      <div className={s.small} style={{ textAlign: "right" }}>
        close {px(r.lastClose)} · {r.lastDate}
        <div><span className={s.mono} style={{ color: (r.openR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{rr(r.openR)}</span> open · peak {rr(r.peakR)}</div>
      </div>
    </div>
  );
}
