"use client";
// app/tonight/page.tsx — Tonight: what do I do right now?
//
// The evening routine on one page: the two accounts, one line per required
// action on open trades, the setups decided at this close, open rule breaks,
// and event dates to check. Everything links to the page where it's done.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Moon, RefreshCw, AlertTriangle, ShieldAlert, CalendarClock, Target } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";
import { fmtUsd, type Ledger, type SwingAccountCfg } from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const btn = { ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-strong)", color: "var(--text-1)", display: "inline-flex", gap: 6, alignItems: "center" } as const;
const h3 = { ...mono, fontSize: 11, color: "var(--text-3)", margin: "22px 0 8px", display: "flex", gap: 6, alignItems: "center" } as const;
const line = { ...mono, fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", display: "flex", gap: 8, alignItems: "baseline" } as const;

interface Payload {
  today: string;
  closes: { stocks: string; forex: string };
  accounts: (SwingAccountCfg & { ledger: Ledger })[];
  actions: { tradeId: string; instrument: string; kind: string; text: string; urgent: boolean }[];
  decided: { market: string; instrument: string; grade: string; side: string; text: string; inTrade: boolean }[];
  scannedAt: { futures: string | null; forex: string | null };
  alerts: { id: string; date: string; instrument: string; rule: string; detail: string }[];
  prompts: string[];
  openCount: number;
}

export default function TonightPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true); setError(null);
    try {
      // "refresh" re-prices the open trades first (same as Trades → refresh prices).
      if (refresh) await fetch("/api/swing/trades?status=open&refresh=1");
      const r = await fetch("/api/swing/tonight");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <SectionHeader
        icon={<Moon size={14} />}
        title="Tonight"
        note={data ? `${data.today} · stocks close ${data.closes.stocks} · forex close ${data.closes.forex} (Lagos)` : undefined}
        right={<button style={btn} onClick={() => load(true)} disabled={busy}><RefreshCw size={11} className={busy ? "animate-spin" : ""} /> refresh prices</button>}
      />
      {error ? <ErrorCard message={error} /> : null}
      {!data && !error ? <LoadingCard what="tonight" /> : null}

      {data ? (
        <>
          {data.alerts.length ? (
            <div className="card" style={{ padding: 12, borderColor: "var(--red-border)", marginBottom: 12 }}>
              <div style={{ ...mono, fontSize: 10.5, color: "var(--red)", display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <ShieldAlert size={12} /> {data.alerts.length} RULE BREAK{data.alerts.length > 1 ? "S" : ""} NOT REVIEWED
              </div>
              {data.alerts.slice(0, 5).map((a) => (
                <div key={a.id} style={{ ...mono, fontSize: 11, color: "var(--text-2)", padding: "2px 0" }}>{a.date} · {a.instrument} · {a.rule} — {a.detail}</div>
              ))}
              <Link href="/discipline" style={{ ...mono, fontSize: 10.5, color: "var(--accent)" }}>review on Discipline →</Link>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
            {data.accounts.map((a) => <AccountCard key={a.key} a={a} />)}
          </div>

          <h3 style={h3}><AlertTriangle size={11} /> ACTIONS ON OPEN TRADES · {data.actions.length}</h3>
          {data.actions.length ? (
            <div className="card" style={{ padding: "4px 12px" }}>
              {data.actions.map((a, i) => (
                <div key={i} style={{ ...line, color: a.urgent ? "var(--amber)" : "var(--text-2)", borderBottom: i === data.actions.length - 1 ? "none" : line.borderBottom }}>
                  <span>{a.urgent ? "●" : "○"}</span><span style={{ flex: 1 }}>{a.text}</span>
                  <Link href="/trades" style={{ fontSize: 10, color: "var(--accent)" }}>trades →</Link>
                </div>
              ))}
            </div>
          ) : <EmptyState text={data.openCount ? "Nothing to do on your open trades tonight." : "No open trades."} small />}

          <h3 style={h3}><Target size={11} /> TONIGHT'S CLOSES · {data.decided.length}</h3>
          {data.decided.length ? (
            <div className="card" style={{ padding: "4px 12px" }}>
              {data.decided.map((d, i) => (
                <div key={i} style={{ ...line, color: d.inTrade ? "var(--text-3)" : "var(--text-2)", borderBottom: i === data.decided.length - 1 ? "none" : line.borderBottom }}>
                  <span style={{ color: d.grade === "A" ? "var(--green)" : "var(--text-3)", minWidth: 16 }}>{d.grade}</span>
                  <b style={{ color: "var(--text-1)", minWidth: 64 }}>{d.instrument}</b>
                  <span style={{ color: d.side === "long" ? "var(--green)" : "var(--red)", minWidth: 40 }}>{d.side}</span>
                  <span style={{ flex: 1 }}>{d.text}{d.inTrade ? " · already in a trade" : ""}</span>
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>{d.market}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState text="No setups at a decision point. The last stored scans had nothing live." small />}
          <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 6 }}>
            From the last stored scans (futures {data.scannedAt.futures ? new Date(data.scannedAt.futures).toLocaleString() : "never"} · forex {data.scannedAt.forex ? new Date(data.scannedAt.forex).toLocaleString() : "never"}).
            Take or skip them on <Link href="/setups" style={{ color: "var(--accent)" }}>Setups</Link>.
          </p>

          {data.prompts.length ? (
            <>
              <h3 style={h3}><CalendarClock size={11} /> EVENTS · {data.prompts.length}</h3>
              <div className="card" style={{ padding: "4px 12px" }}>
                {data.prompts.map((p, i) => <div key={i} style={{ ...line, color: "var(--text-2)", borderBottom: i === data.prompts.length - 1 ? "none" : line.borderBottom }}>{p}</div>)}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AccountCard({ a }: { a: SwingAccountCfg & { ledger: Ledger } }) {
  const L = a.ledger;
  const stat = (k: string, v: string, tone?: string) => (
    <div><div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>{k}</div><div style={{ ...mono, fontSize: 14, color: tone ?? "var(--text-1)" }}>{v}</div></div>
  );
  const stopTone = L.stopHit ? "var(--red)" : L.stopRemaining < a.monthlyStop * 0.4 ? "var(--amber)" : "var(--text-1)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{fmtUsd(a.balance)}</span>
      </div>
      {L.stopHit ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)", marginTop: 4 }}>MONTHLY STOP HIT — done until the 1st</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
        {stat("open risk", fmtUsd(L.openRisk))}
        {stat("slots", `${L.slotsUsed} / ${a.maxSlots}`, L.slotsUsed >= a.maxSlots ? "var(--amber)" : undefined)}
        {stat("stop room", fmtUsd(L.stopRemaining), stopTone)}
        {stat("this month", fmtUsd(L.realised), L.realised >= 0 ? "var(--green)" : "var(--red)")}
        {stat("locked", fmtUsd(L.locked), L.locked > 0 ? "var(--green)" : undefined)}
        {stat("house pot", fmtUsd(L.housePot))}
      </div>
    </div>
  );
}
