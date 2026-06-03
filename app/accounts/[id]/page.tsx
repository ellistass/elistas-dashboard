"use client";
// app/accounts/[id]/page.tsx — Per-account history page.
//
// What you see here:
//   • Header: account name + broker + status + balance reconciliation
//   • Reconciliation banner — flags if sum(P&L) + startingBalance doesn't
//     match currentBalance (i.e. missing trades or external deposits/withdrawals)
//   • Stats row — trades, win rate, total R, total P&L
//   • Equity curve — simple inline SVG sparkline of running balance
//   • Closed-trades table — chronological, with running balance column
//   • Open trades (if any) — separate small table at top
//
// Data source: /api/accounts/[id]/history (which walks profitCcy chronologically)

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EditTradeDrawer } from "@/app/_components/EditTradeDrawer";
import { Pager } from "@/app/_components/Pager";

const CLOSED_PAGE_SIZE = 50;

interface ClosedTrade {
  id: string; ticket: number | null; source: string;
  pair: string; direction: string; lotSize: number | null;
  entryPrice: number; slPrice: number; initialSlPrice: number | null;
  tpPrice: number; closePrice: number | null;
  closeTimeUtc: string | null; date: string;
  outcome: string | null; resultR: number | null;
  profitCcy: number | null; commission: number | null; swap: number | null;
  riskPercent: number | null;
  grade: string | null; model: string | null; reason: string | null;
  notes: string | null; preTradeNotes: string | null; postTradeNotes: string | null;
  screenshotUrl: string | null; closeScreenshotUrl: string | null;
  balanceAfter: number;
}
// Open trades carry the same column set as closed ones — the history API just
// splits by outcome. We need all fields so the edit drawer can render even for
// open rows (you might want to fix initialSlPrice or attach a setup screenshot
// before the trade closes).
interface OpenTrade {
  id: string; ticket: number | null; pair: string; direction: string;
  entryPrice: number; slPrice: number; initialSlPrice: number | null;
  tpPrice: number; closePrice: number | null;
  openTimeUtc: string | null; closeTimeUtc: string | null; date: string;
  outcome: string | null; resultR: number | null; profitCcy: number | null;
  grade: string | null; model: string | null; reason: string | null;
  notes: string | null; preTradeNotes: string | null; postTradeNotes: string | null;
  screenshotUrl: string | null; closeScreenshotUrl: string | null;
}
interface ApiKeyInfo {
  id: string;
  name: string;
  broker?: string;
  apiKey: string | null;
  mt4AccountNumber: number | null;
}
interface HistoryResponse {
  account: {
    id: string; name: string; broker: string; currency: string;
    type: string; market: string; status: string;
    startingBalance: number; currentBalance: number;
  };
  stats: {
    totalTrades: number; closedTrades: number; openTrades: number;
    wins: number; losses: number; be: number;
    winRate: number; totalR: number; avgR: number; totalPnL: number;
  };
  reconciliation: {
    startingBalance: number; currentBalance: number; sumClosedPnL: number;
    expectedFromTrades: number; externalAdjustments: number;
  };
  openTrades: OpenTrade[];
  closedTrades: ClosedTrade[];
}

function fmtCcy(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(n);
}
function fmtNum(n: number | null | undefined, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }); }
  catch { return "—"; }
}

// Simple sparkline of the running balance — no recharts dependency.
function EquityCurve({ points, color }: { points: { x: number; y: number }[]; color: string }) {
  if (points.length < 2) return null;
  const W = 600, H = 80, P = 4;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (x: number) => P + ((x - minX) / Math.max(1, maxX - minX)) * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - minY) / Math.max(1, maxY - minY)) * (H - 2 * P);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 80 }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={sx(last.x)} cy={sy(last.y)} r="2" fill={color} />
    </svg>
  );
}

export default function AccountHistoryPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [revealKey, setRevealKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [mt4NumDraft, setMt4NumDraft] = useState("");
  const [editing, setEditing] = useState<ClosedTrade | null>(null);
  // Closed-trade table is shown newest-first. Pager works on that reversed
  // ordering so "page 0" is the most recent N trades.
  const [closedPage, setClosedPage] = useState(0);
  // Broker statement import dialog state.
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStartDate, setImportStartDate] = useState("");
  const [importPreMode, setImportPreMode] = useState<"skip" | "tag" | "import">("skip");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  async function runImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      if (importStartDate) fd.append("strategyStartDate", importStartDate);
      fd.append("preStrategyMode", importPreMode);
      const res = await fetch(`/api/accounts/${params?.id}/import-statement`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json();
      if (j.error) {
        setImportResult(`Failed: ${j.error}`);
        return;
      }
      const s = j.summary;
      setImportResult(
        `Done (${s.format ?? 'unknown'} format) · ${s.created} created, ${s.updated} updated, ${s.preStrategySkipped} pre-strategy skipped, ${s.skipped} other skipped, ${s.errorCount} errors.`
      );
      await refreshHistory();
    } finally {
      setImportBusy(false);
    }
  }

  async function refreshHistory() {
    if (!params?.id) return;
    const r = await fetch(`/api/accounts/${params.id}/history`);
    const j = await r.json();
    if (!j.error) setData(j);
  }

  // Quick close — marks a phantom/forgotten open trade as BE at entry. The user
  // can later click Edit to set a real close price; this just gets the row out
  // of "open" so balance reconciliation isn't thrown off.
  async function closeOpenTrade(t: OpenTrade) {
    if (!confirm(`Mark ${t.pair} ${t.direction} as closed at entry (BE)?`)) return;
    await fetch("/api/trades", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: t.id,
        outcome: "BE",
        closePrice: t.entryPrice,
        closeTimeUtc: new Date().toISOString(),
        resultR: 0,
        profitCcy: 0,
      }),
    });
    await refreshHistory();
  }

  async function deleteOpenTrade(t: OpenTrade) {
    if (!confirm(`Delete ${t.pair} ${t.direction} entirely? Only do this for phantom rows that don't exist in MT4. This can't be undone.`)) return;
    await fetch(`/api/trades?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
    await refreshHistory();
  }

  // ── Bulk maintenance ────────────────────────────────────────────────────
  // Used when the dashboard's data has diverged from the broker and the user
  // wants a clean slate to let the EA resync from scratch.
  async function clearAllOpenTrades() {
    if (!data) return;
    const ids = data.openTrades.map((t) => t.id);
    if (ids.length === 0) { alert("No open trades to clear."); return; }
    if (!confirm(`Delete ALL ${ids.length} open trade rows for this account? This cannot be undone. Use this for phantoms — confirmed real open trades will get re-posted by the EA on its next sweep.`)) return;
    const res = await fetch("/api/trades", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await res.json();
    if (j.error) { alert(`Delete failed: ${j.error}`); return; }
    await refreshHistory();
  }

  async function wipeEAData() {
    if (!data) return;
    const ids = [
      ...data.openTrades.filter((t) => (t as any).source?.startsWith?.("mt4")).map((t) => t.id),
      ...data.closedTrades.filter((t) => t.source?.startsWith?.("mt4")).map((t) => t.id),
    ];
    if (ids.length === 0) { alert("No EA-synced trades found for this account."); return; }
    const ok = confirm(
      `WIPE ALL ${ids.length} EA-synced trade rows for this account?\n\n` +
      `This deletes every Trade whose source is 'mt4' or 'mt4-catchup'.\n` +
      `Manual journal entries are NOT touched.\n\n` +
      `After this, set ForceFullResweep=true in the EA and reload it on the chart so it re-posts everything from broker history.\n\n` +
      `This cannot be undone.`
    );
    if (!ok) return;
    const res = await fetch("/api/trades", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await res.json();
    if (j.error) { alert(`Delete failed: ${j.error}`); return; }
    alert(`Deleted ${j.deleted ?? ids.length} rows. Now flip ForceFullResweep=true in the EA inputs and reload the chart.`);
    await refreshHistory();
  }

  useEffect(() => {
    if (!params?.id) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/accounts/${params.id}/history`).then((r) => r.json()),
      fetch(`/api/accounts/${params.id}/api-key`).then((r) => r.json()),
    ])
      .then(([h, k]) => {
        if (h.error) setError(h.error); else setData(h);
        if (!k.error) {
          setKeyInfo(k);
          setMt4NumDraft(k.mt4AccountNumber ? String(k.mt4AccountNumber) : "");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params?.id]);

  async function rotateKey() {
    if (!params?.id) return;
    const num = parseInt(mt4NumDraft, 10);
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/accounts/${params.id}/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Number.isFinite(num) ? { mt4AccountNumber: num } : {}),
      });
      const j = await res.json();
      if (j.error) {
        setError(j.error);
      } else {
        setKeyInfo(j);
        setRevealKey(true); // auto-reveal once after rotation so they can copy
      }
    } finally {
      setKeyBusy(false);
    }
  }
  async function revokeKey() {
    if (!params?.id) return;
    if (!confirm("Revoke this API key? The EA will start getting 401s until you generate a new one.")) return;
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/accounts/${params.id}/api-key`, { method: "DELETE" });
      const j = await res.json();
      setKeyInfo({ ...keyInfo!, apiKey: j.apiKey });
      setRevealKey(false);
    } finally {
      setKeyBusy(false);
    }
  }
  async function copyKey() {
    if (!keyInfo?.apiKey) return;
    try { await navigator.clipboard.writeText(keyInfo.apiKey); } catch {}
  }

  if (loading) return <main style={{ padding: 24 }}><p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading…</p></main>;
  if (error || !data) return (
    <main style={{ padding: 24 }}>
      <p style={{ fontSize: 12, color: "var(--red)" }}>{error ?? "No data"}</p>
      <Link href="/accounts" style={{ fontSize: 12, color: "var(--blue)" }}>← Back to accounts</Link>
    </main>
  );

  const { account, stats, reconciliation, openTrades, closedTrades } = data;
  const ccy = account.currency;
  const equityPoints = closedTrades.map((t, i) => ({ x: i, y: t.balanceAfter }));
  if (equityPoints.length > 0) equityPoints.unshift({ x: -1, y: account.startingBalance });
  const equityColor = stats.totalPnL >= 0 ? "var(--green)" : "var(--red)";
  const reconcileOff = Math.abs(reconciliation.externalAdjustments) > 0.01;

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <Link href="/accounts" style={{ fontSize: 11, color: "var(--text-3)" }}>← All accounts</Link>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 4px" }}>{account.name}</h1>
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          {account.broker} · {account.type} · {account.market} · {account.status}
        </p>
      </div>

      {/* Reconciliation banner — surfaces external deposits/withdrawals or
          missing trades so the user knows whether the ledger ties out. */}
      <div className="card" style={{
        padding: "12px 16px", marginBottom: 14,
        borderColor: reconcileOff ? "rgba(245, 158, 11, 0.4)" : "var(--border)",
        background: reconcileOff ? "rgba(245, 158, 11, 0.06)" : "var(--bg-card)",
      }}>
        <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 6px" }}>BALANCE RECONCILIATION</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, fontSize: 12 }}>
          <div>
            <p style={{ color: "var(--text-3)", margin: 0, fontSize: 10 }}>Starting balance</p>
            <p className="font-mono" style={{ margin: 0 }}>{fmtCcy(reconciliation.startingBalance, ccy)}</p>
          </div>
          <div>
            <p style={{ color: "var(--text-3)", margin: 0, fontSize: 10 }}>Sum of closed P&L</p>
            <p className="font-mono" style={{ margin: 0, color: reconciliation.sumClosedPnL >= 0 ? "var(--green)" : "var(--red)" }}>
              {reconciliation.sumClosedPnL >= 0 ? "+" : ""}{fmtCcy(reconciliation.sumClosedPnL, ccy)}
            </p>
          </div>
          <div>
            <p style={{ color: "var(--text-3)", margin: 0, fontSize: 10 }}>Expected balance</p>
            <p className="font-mono" style={{ margin: 0 }}>{fmtCcy(reconciliation.expectedFromTrades, ccy)}</p>
          </div>
          <div>
            <p style={{ color: "var(--text-3)", margin: 0, fontSize: 10 }}>Broker balance</p>
            <p className="font-mono" style={{ margin: 0 }}>{fmtCcy(reconciliation.currentBalance, ccy)}</p>
          </div>
          <div>
            <p style={{ color: "var(--text-3)", margin: 0, fontSize: 10 }}>External adjustments</p>
            <p className="font-mono" style={{ margin: 0, color: reconcileOff ? "var(--amber)" : "var(--text-3)" }}>
              {reconciliation.externalAdjustments >= 0 ? "+" : ""}{fmtCcy(reconciliation.externalAdjustments, ccy)}
            </p>
          </div>
        </div>
        {reconcileOff && (
          <p style={{ fontSize: 10, color: "var(--amber)", margin: "8px 0 0", lineHeight: 1.4 }}>
            Closed-trade P&L doesn't fully account for the current balance. Likely causes:
            deposits, withdrawals, broker credits, or trades the EA hasn't synced yet.
            Re-run the EA catchup (CatchupHistoryDays=0) to backfill any missing trades.
          </p>
        )}
      </div>

      {/* MT4 integration panel — generate / reveal / rotate the per-account
          bearer token that the ElistasJournal EA uses. Without a key, the EA
          can't post events; setting one activates the integration. */}
      {keyInfo && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: 0 }}>MT4 EXPERT ADVISOR</p>
            {!keyInfo.apiKey && (
              <span style={{ fontSize: 10, color: "var(--amber)", background: "var(--amber-dim)", padding: "2px 8px", borderRadius: 20, border: "1px solid var(--amber-border)" }}>
                Not yet activated
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "var(--text-2)" }}>MT4 account number</label>
            <input
              value={mt4NumDraft}
              onChange={(e) => setMt4NumDraft(e.target.value)}
              placeholder="e.g. 1234567"
              style={{ padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }}
            />
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>broker login number</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto auto auto", gap: 6, alignItems: "center" }}>
            <label style={{ fontSize: 11, color: "var(--text-2)" }}>API key</label>
            <input
              readOnly
              value={
                !keyInfo.apiKey
                  ? "(not generated)"
                  : revealKey
                    ? keyInfo.apiKey
                    : "•".repeat(Math.min(48, keyInfo.apiKey.length))
              }
              style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace" }}
            />
            <button
              onClick={() => setRevealKey((v) => !v)}
              disabled={!keyInfo.apiKey}
              style={btn("ghost")}
            >
              {revealKey ? "Hide" : "Reveal"}
            </button>
            <button
              onClick={copyKey}
              disabled={!keyInfo.apiKey || !revealKey}
              style={btn("ghost")}
              title={!revealKey ? "Reveal first" : "Copy to clipboard"}
            >
              Copy
            </button>
            <button onClick={rotateKey} disabled={keyBusy} style={btn("primary")}>
              {keyInfo.apiKey ? "Rotate" : "Generate"}
            </button>
          </div>

          {keyInfo.apiKey && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <button onClick={revokeKey} disabled={keyBusy} style={btn("danger")}>
                Revoke
              </button>
            </div>
          )}

          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "8px 0 0", lineHeight: 1.5 }}>
            Paste this into the <span className="font-mono">ApiKey</span> input on the
            ElistasJournal EA. Rotating immediately invalidates the previous key —
            the EA stops posting until you update its input parameter.
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="card" style={{ padding: "14px 18px", marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
          <Stat label="Trades" value={`${stats.closedTrades}`} sub={stats.openTrades > 0 ? `+ ${stats.openTrades} open` : undefined} />
          <Stat label="Win rate" value={`${fmtNum(stats.winRate, 1)}%`} sub={`${stats.wins}W ${stats.losses}L ${stats.be}BE`} />
          <Stat label="Total R" value={`${stats.totalR >= 0 ? "+" : ""}${fmtNum(stats.totalR, 2)}R`} color={stats.totalR >= 0 ? "var(--green)" : "var(--red)"} />
          <Stat label="Avg R" value={`${stats.avgR >= 0 ? "+" : ""}${fmtNum(stats.avgR, 2)}R`} />
          <Stat label="Total P&L" value={fmtCcy(stats.totalPnL, ccy)} color={stats.totalPnL >= 0 ? "var(--green)" : "var(--red)"} />
        </div>
      </div>

      {/* Maintenance — bulk cleanup for when the dashboard data has diverged
          from the broker and the EA needs to resync from scratch. */}
      <div className="card" style={{
        padding: "12px 16px", marginBottom: 14,
        border: "1px solid var(--red-border)", background: "rgba(239,68,68,0.04)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--red)", margin: 0 }}>
            DANGER ZONE — bulk maintenance
          </p>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>
            {data.openTrades.length} open · {data.closedTrades.length} closed
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: "0 0 8px", lineHeight: 1.5 }}>
          Use these when the dashboard has phantom trades or you want the EA to resync from scratch.
          After wiping, set <span className="font-mono" style={{ color: "var(--text-2)" }}>ForceFullResweep=true</span> in the EA inputs and reload the chart — the EA's per-account memory clears and it re-POSTs every history row.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={clearAllOpenTrades} style={btn("danger")}>
            Clear all open trades ({data.openTrades.length})
          </button>
          <button onClick={wipeEAData} style={btn("danger")}>
            Wipe all EA-synced data
          </button>
          <button onClick={() => { setImportOpen(true); setImportResult(null); }} style={btn("ghost")}>
            Import broker CSV…
          </button>
        </div>
      </div>

      {importOpen && (
        <div
          onClick={() => !importBusy && setImportOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 95vw)", background: "var(--bg-card)",
              border: "1px solid var(--border)", borderRadius: 10, padding: 18,
            }}
          >
            <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 12px" }}>
              IMPORT BROKER STATEMENT
            </p>
            <p style={{ fontSize: 11, color: "var(--text-2)", margin: "0 0 12px", lineHeight: 1.5 }}>
              Upload the FundedNext CSV export. Trades upsert by ticket — re-importing
              is safe and won't duplicate. Existing journal context (reason, notes,
              grade, screenshots) is preserved on update.
            </p>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>CSV file</label>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={importBusy}
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                style={{ fontSize: 11, color: "var(--text-2)" }}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>
                Strategy started on
              </label>
              <input
                type="date"
                value={importStartDate}
                onChange={(e) => setImportStartDate(e.target.value)}
                disabled={importBusy}
                style={{ width: "100%", padding: "6px 10px", fontSize: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)" }}
              />
              <p style={{ fontSize: 10, color: "var(--text-3)", margin: "3px 0 0", lineHeight: 1.4 }}>
                Trades opened BEFORE this date are treated as pre-strategy.
                Leave blank to count everything as strategy.
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>
                Pre-strategy trades
              </label>
              <select
                value={importPreMode}
                onChange={(e) => setImportPreMode(e.target.value as any)}
                disabled={importBusy}
                style={{ width: "100%", padding: "6px 10px", fontSize: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)" }}
              >
                <option value="skip">Skip — don't import pre-strategy trades (recommended)</option>
                <option value="tag">Import & tag as 'pre-strategy' (filter out of stats later)</option>
                <option value="import">Import normally (full history, counts toward stats)</option>
              </select>
            </div>

            {importResult && (
              <p style={{ fontSize: 11, color: importResult.startsWith("Failed") ? "var(--red)" : "var(--green)", marginBottom: 10, lineHeight: 1.4 }}>
                {importResult}
              </p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={runImport}
                disabled={importBusy || !importFile}
                style={btn("primary")}
              >
                {importBusy ? "Importing…" : "Import"}
              </button>
              <button
                onClick={() => setImportOpen(false)}
                disabled={importBusy}
                style={btn("ghost")}
              >
                {importResult && !importResult.startsWith("Failed") ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Equity curve */}
      {equityPoints.length > 1 && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 14 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 6px" }}>EQUITY CURVE</p>
          <EquityCurve points={equityPoints} color={equityColor} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
            <span>{fmtCcy(account.startingBalance, ccy)}</span>
            <span>{fmtCcy(closedTrades[closedTrades.length - 1]?.balanceAfter ?? account.startingBalance, ccy)}</span>
          </div>
        </div>
      )}

      {/* Open trades */}
      {openTrades.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", padding: "12px 18px 6px", margin: 0 }}>
            OPEN TRADES ({openTrades.length})
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                <Th>Opened</Th><Th>Ticket</Th><Th>Pair</Th><Th>Dir</Th>
                <Th right>Entry</Th><Th right>SL</Th><Th right>TP</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {openTrades.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <Td>{fmtDate(t.openTimeUtc ?? t.date)}</Td>
                  <Td mono>{t.ticket != null ? `#${t.ticket}` : "—"}</Td>
                  <Td><span className="font-mono">{t.pair}</span></Td>
                  <Td><span style={{ color: t.direction === "Long" ? "var(--green)" : "var(--red)" }}>{t.direction}</span></Td>
                  <Td right mono>{fmtNum(t.entryPrice, 5)}</Td>
                  <Td right mono>{fmtNum(t.slPrice, 5)}</Td>
                  <Td right mono>{fmtNum(t.tpPrice, 5)}</Td>
                  <Td right>
                    <span style={{ display: "inline-flex", gap: 4, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setEditing(t as any)}
                        style={openRowBtn("ghost")}
                        title="Edit / fix R / attach screenshot"
                      >Edit</button>
                      <button
                        onClick={() => closeOpenTrade(t)}
                        style={openRowBtn("ghost")}
                        title="Mark closed at entry (BE) — for trades the EA failed to close"
                      >Mark closed</button>
                      <button
                        onClick={() => deleteOpenTrade(t)}
                        style={openRowBtn("danger")}
                        title="Delete this trade row (for phantoms that don't exist in MT4)"
                      >Delete</button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Closed trades — chronological */}
      <div className="card" style={{ padding: 0 }}>
        <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", padding: "12px 18px 6px", margin: 0 }}>
          CLOSED TRADES ({closedTrades.length}) — chronological, running balance
        </p>
        {closedTrades.length === 0 ? (
          <p style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>No closed trades yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                <Th>Closed</Th><Th>Ticket</Th><Th>Pair</Th><Th>Dir</Th><Th>Outcome</Th>
                <Th right>R</Th><Th right>P&L</Th><Th right>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {[...closedTrades].reverse().slice(
                closedPage * CLOSED_PAGE_SIZE,
                (closedPage + 1) * CLOSED_PAGE_SIZE,
              ).map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setEditing(t)}
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                  }}
                  title="Click to edit / fix R / attach screenshot"
                >
                  <Td>{fmtDate(t.closeTimeUtc ?? t.date)}</Td>
                  <Td mono>{t.ticket != null ? `#${t.ticket}` : "—"}</Td>
                  <Td><span className="font-mono">{t.pair}</span></Td>
                  <Td><span style={{ color: t.direction === "Long" ? "var(--green)" : "var(--red)" }}>{t.direction}</span></Td>
                  <Td><OutcomePill outcome={t.outcome} /></Td>
                  <Td right mono color={(t.resultR ?? 0) >= 0 ? "var(--green)" : "var(--red)"}>
                    {(t.resultR ?? 0) >= 0 ? "+" : ""}{fmtNum(t.resultR, 2)}R
                  </Td>
                  <Td right mono color={(t.profitCcy ?? 0) >= 0 ? "var(--green)" : "var(--red)"}>
                    {(t.profitCcy ?? 0) >= 0 ? "+" : ""}{fmtCcy(t.profitCcy ?? 0, ccy)}
                  </Td>
                  <Td right mono>{fmtCcy(t.balanceAfter, ccy)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager
          total={closedTrades.length}
          pageSize={CLOSED_PAGE_SIZE}
          page={closedPage}
          onChange={setClosedPage}
        />
      </div>

      {editing && (
        <EditTradeDrawer
          trade={editing}
          currency={ccy}
          startingBalance={account.startingBalance}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refreshHistory(); }}
        />
      )}
    </main>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: "var(--text-3)", margin: 0, letterSpacing: "0.06em" }}>{label.toUpperCase()}</p>
      <p className="font-mono" style={{ fontSize: 18, fontWeight: 600, margin: "2px 0", color: color ?? "var(--text-1)" }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: "var(--text-3)", margin: 0 }}>{sub}</p>}
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{
    padding: "8px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
    color: "var(--text-3)", textAlign: right ? "right" : "left",
  }}>{children}</th>;
}
function Td({ children, right, mono, color }: { children: React.ReactNode; right?: boolean; mono?: boolean; color?: string }) {
  return <td style={{
    padding: "10px 14px", textAlign: right ? "right" : "left",
    fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
    color: color ?? "var(--text-2)",
  }}>{children}</td>;
}
function openRowBtn(variant: "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
  };
  if (variant === "danger") return { ...base, background: "var(--red-dim)", color: "var(--red)", border: "1px solid var(--red-border)" };
  return { ...base, background: "transparent", color: "var(--text-2)", border: "1px solid var(--border)" };
}
function btn(variant: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11, padding: "6px 12px", borderRadius: 6, cursor: "pointer", flexShrink: 0,
  };
  if (variant === "primary") return { ...base, background: "var(--green)", color: "#001a14", border: "none", fontWeight: 500 };
  if (variant === "danger")  return { ...base, background: "var(--red-dim)", color: "var(--red)", border: "1px solid var(--red-border)" };
  return { ...base, background: "transparent", color: "var(--text-2)", border: "1px solid var(--border)" };
}
function OutcomePill({ outcome }: { outcome: string | null }) {
  const map: Record<string, { bg: string; color: string }> = {
    Win:  { bg: "var(--green-dim)", color: "var(--green)" },
    Loss: { bg: "var(--red-dim)",   color: "var(--red)" },
    BE:   { bg: "var(--bg-elevated)", color: "var(--text-3)" },
  };
  const s = map[outcome ?? ""] ?? { bg: "var(--bg-elevated)", color: "var(--text-3)" };
  return <span style={{
    fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
    background: s.bg, color: s.color,
  }}>{outcome ?? "—"}</span>;
}
