"use client";
// app/wyckoff/practice/page.tsx — deliberate practice, and how close the demo is.
//
// Two things that were previously nowhere:
//
//   1. The trainer's ledger. 317 cases lived in one browser's localStorage,
//      invisible to everything else and one cleared profile from gone. Import
//      it and the same breakdowns that run on live reads run on practice.
//   2. Demo accounts. Account.type has always allowed "Demo" and nothing ever
//      filtered on it, so demo results were both invisible here AND silently
//      mixed into the live numbers on /analytics.
//
// The breakdowns are about STRUCTURE, not profit. Practice has no money in it,
// so "what do I read well" is the only question worth asking of it.

import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, Upload, Wallet, Layers } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../_components/ui";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

interface Stats {
  n: number; closed: number; wins: number; losses: number;
  winRate: number | null; netR: number; avgR: number | null;
  profitFactor: number | null; expectancy: number | null; maxDrawdownR: number;
}
interface Bucket extends Stats { key: string }
interface Run extends Stats {
  id: string; label: string; source: string;
  trainerRunId: string | null; importedAt: string;
}
interface DemoAccount {
  id: string; name: string; broker: string; status: string; currency: string;
  startingBalance: number; currentBalance: number; currentEquity: number | null;
  profitTarget: number | null; maxDrawdownPct: number; currentDrawdownPct: number;
}
interface Payload {
  overall: Stats; unaided: Stats; aided: Stats;
  bySetup: Bucket[]; byEngine: Bucket[];
  demoAccounts: DemoAccount[]; runs: Run[];
}

export default function PracticePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/practice", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function importCsv(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      setNote(
        `imported ${j.casesWritten} case${j.casesWritten === 1 ? "" : "s"} across ${j.runsTouched} run${j.runsTouched === 1 ? "" : "s"}` +
          (j.skipped ? ` · ${j.skipped} skipped` : "") +
          (j.warnings?.length ? ` · ${j.warnings.join("; ")}` : ""),
      );
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (loading) return <LoadingCard what="practice" />;

  return (
    <>
      {error && <ErrorCard message={error} />}

      <SectionHeader
        icon={<FlaskConical size={13} strokeWidth={2} />}
        title="Practice"
        count={data?.overall.n ?? 0}
        note="separate tables · simulated fills never touch live P&L"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            {note && <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", maxWidth: 340, textAlign: "right" }}>{note}</span>}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px",
                borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-on)",
                fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1, fontFamily: "'Sora', sans-serif",
              }}
            >
              <Upload size={14} strokeWidth={2} />
              {busy ? "Importing…" : "Import trainer CSV"}
            </button>
          </div>
        }
      />

      {!data || data.overall.n === 0 ? (
        <EmptyState text="No practice cases yet. Export the ledger from the Wyckoff trainer (its CSV button) and import it here — runs are split out by the trainer's own run id, and re-importing the same export updates rather than duplicating." />
      ) : (
        <>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 0, padding: 0, marginBottom: 16, overflow: "hidden" }}>
            <Cell label="Cases" value={String(data.overall.n)} detail={`${data.overall.closed} closed`} />
            <Cell label="Win rate" value={data.overall.winRate == null ? "—" : `${data.overall.winRate}%`} detail={`${data.overall.wins}W / ${data.overall.losses}L`} accent bordered />
            <Cell label="Net R" value={fmtR(data.overall.netR)} detail={`expectancy ${data.overall.expectancy ?? "—"}R`} bordered />
            <Cell label="Profit factor" value={data.overall.profitFactor == null ? "—" : String(data.overall.profitFactor)} detail="gross win / gross loss" bordered />
            <Cell label="Max drawdown" value={`${data.overall.maxDrawdownR}R`} detail="peak to trough" warn={data.overall.maxDrawdownR > 10} bordered />
          </div>

          {/* Aided vs unaided — the number that predicts whether practice
              transfers. A win rate that only survives with the helpers on is a
              habit that will not come with you. */}
          {data.aided.closed > 0 && data.unaided.closed > 0 && (
            <div className="card" style={{ padding: "14px 20px", marginBottom: 16, display: "flex", gap: 26, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                aids
              </span>
              <Mini label="unaided" s={data.unaided} />
              <Mini label="with aids" s={data.aided} />
              <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", maxWidth: 420, lineHeight: 1.5 }}>
                a gap here means the reading leans on the helpers rather than on the tape
              </span>
            </div>
          )}

          <SectionHeader icon={<Layers size={13} strokeWidth={2} />} title="By structure" note="what you actually read well" />
          <Buckets rows={[...data.bySetup, ...data.byEngine.map((b) => ({ ...b, key: `engine: ${b.key}` }))]} />

          <SectionHeader title="Runs" count={data.runs.length} note="split by the trainer's own run id" />
          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 26 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Run", "Imported", "Cases", "Win rate", "Net R", "PF", "Max DD"].map((h, i) => (
                    <th key={h} style={{
                      ...mono, textAlign: i > 1 ? "right" : "left", fontSize: 9.5, letterSpacing: "0.1em",
                      textTransform: "uppercase", color: "var(--text-3)", fontWeight: 500,
                      padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-faint, var(--border-subtle))" }}>
                    <td style={{ ...mono, padding: "9px 12px", color: "var(--text-1)" }}>{r.label}</td>
                    <td style={{ ...mono, padding: "9px 12px", color: "var(--text-3)" }}>{r.importedAt.slice(0, 10)}</td>
                    <td style={{ ...mono, padding: "9px 12px", textAlign: "right", color: "var(--text-2)" }}>{r.n}</td>
                    <td style={{ ...mono, padding: "9px 12px", textAlign: "right", color: "var(--text-2)" }}>{r.winRate == null ? "—" : `${r.winRate}%`}</td>
                    <td style={{ ...mono, padding: "9px 12px", textAlign: "right", color: r.netR >= 0 ? "var(--green)" : "var(--red)" }}>{fmtR(r.netR)}</td>
                    <td style={{ ...mono, padding: "9px 12px", textAlign: "right", color: "var(--text-2)" }}>{r.profitFactor ?? "—"}</td>
                    <td style={{ ...mono, padding: "9px 12px", textAlign: "right", color: "var(--text-3)" }}>{r.maxDrawdownR}R</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <SectionHeader
        icon={<Wallet size={13} strokeWidth={2} />}
        title="Demo accounts"
        count={data?.demoAccounts.length ?? 0}
        note="accounts typed Demo — these should NOT be in your live stats"
      />
      {!data?.demoAccounts.length ? (
        <EmptyState
          small
          text="No accounts typed Demo. Set an account's type to Demo on the Accounts page and it appears here — and can be excluded from live analytics."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginBottom: 30 }}>
          {data.demoAccounts.map((a) => {
            const pnl = (a.currentEquity ?? a.currentBalance) - a.startingBalance;
            const targetPct = a.profitTarget ? Math.max(0, Math.min(100, (pnl / a.profitTarget) * 100)) : null;
            return (
              <div key={a.id} className="card" style={{ padding: "15px 17px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 9 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>{a.name}</span>
                  <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{a.broker} · {a.status}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span style={{ ...mono, fontSize: 19, fontWeight: 500, color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                    {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                  </span>
                  <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
                    {a.currency} · from {a.startingBalance.toFixed(0)}
                  </span>
                </div>
                {targetPct != null && (
                  <>
                    <div style={{ position: "relative", height: 5, borderRadius: 3, background: "var(--bg-inset, var(--border-subtle))", marginTop: 10 }}>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${targetPct}%`, borderRadius: 3, background: "var(--accent)" }} />
                    </div>
                    <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", margin: "5px 0 0" }}>
                      {targetPct.toFixed(0)}% of the {a.profitTarget} target · drawdown {a.currentDrawdownPct.toFixed(1)}% of {a.maxDrawdownPct}%
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const fmtR = (r: number) => `${r >= 0 ? "+" : ""}${r}R`;

function Buckets({ rows }: { rows: Bucket[] }) {
  const live = rows.filter((r) => r.n > 0);
  if (!live.length) return <EmptyState small text="No structural breakdown yet." />;
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 26 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {live.map((b) => (
            <tr key={b.key} style={{ borderBottom: "1px solid var(--border-faint, var(--border-subtle))" }}>
              <td style={{ ...mono, padding: "9px 14px", color: "var(--text-1)", whiteSpace: "nowrap" }}>{b.key}</td>
              <td style={{ ...mono, padding: "9px 14px", color: "var(--text-3)", textAlign: "right" }}>{b.n} cases</td>
              <td style={{ ...mono, padding: "9px 14px", textAlign: "right", color: "var(--text-2)" }}>
                {b.winRate == null ? "—" : `${b.winRate}%`}
              </td>
              <td style={{ ...mono, padding: "9px 14px", textAlign: "right", color: b.netR >= 0 ? "var(--green)" : "var(--red)" }}>
                {fmtR(b.netR)}
              </td>
              {/* Small samples get said out loud rather than dressed up as a
                  finding — 4 cases is a mood, not a pattern. */}
              <td style={{ ...mono, padding: "9px 14px", fontSize: 9.5, color: "var(--text-3)", textAlign: "right" }}>
                {b.closed < 20 ? "sample too small" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ label, value, detail, accent, bordered, warn }: {
  label: string; value: string; detail: string; accent?: boolean; bordered?: boolean; warn?: boolean;
}) {
  return (
    <div style={{ flex: "1 1 160px", padding: "15px 20px", borderLeft: bordered ? "1px solid var(--border-subtle)" : undefined }}>
      <p className="kicker" style={{ margin: "0 0 5px" }}>{label}</p>
      <p style={{ ...mono, margin: 0, fontSize: 20, lineHeight: 1, fontWeight: 500, color: warn ? "var(--amber)" : accent ? "var(--accent)" : "var(--text-1)" }}>
        {value}
      </p>
      <p style={{ ...mono, margin: "6px 0 0", fontSize: 9.5, color: "var(--text-3)" }}>{detail}</p>
    </div>
  );
}

function Mini({ label, s }: { label: string; s: Stats }) {
  return (
    <div>
      <p className="kicker" style={{ margin: "0 0 4px" }}>{label}</p>
      <p style={{ ...mono, margin: 0, fontSize: 16, fontWeight: 500, color: "var(--text-1)" }}>
        {s.winRate == null ? "—" : `${s.winRate}%`}
        <span style={{ fontSize: 10, color: "var(--text-3)" }}> · {fmtR(s.netR)}</span>
      </p>
      <p style={{ ...mono, margin: "3px 0 0", fontSize: 9, color: "var(--text-3)" }}>{s.closed} cases</p>
    </div>
  );
}
