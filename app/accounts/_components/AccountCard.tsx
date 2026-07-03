"use client";
// app/accounts/_components/AccountCard.tsx — one row card per account.
// Pixel-faithful to Accounts.dc.html: title row (name · status pill · broker ·
// type pill · payout pill), DM Mono metrics row, drawdown bar (max 360px)
// with danger note, right action rail (History → / Edit / Archive).

import { Landmark, TriangleAlert, ArrowRight, Pencil, Archive } from "lucide-react";
import { Account, fmt, statusMeta } from "./types";

const mono = "'DM Mono', monospace";

function MetricLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: "0 0 2px", fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", color: "var(--text-3)" }}>
      {children}
    </p>
  );
}

export function AccountCard({
  account: acc, onEdit, onArchive,
}: {
  account: Account;
  onEdit: (acc: Account) => void;
  onArchive: (id: string) => void;
}) {
  const sm = statusMeta(acc.status);
  const StatusIcon = sm.Icon;
  const pnl = acc.stats.pnl;
  const pnlColor = pnl > 0 ? "var(--green)" : pnl < 0 ? "var(--red)" : "var(--text-label)";
  const sign = (n: number) => (n >= 0 ? "+" : "");

  const danger = acc.stats.drawdownDanger;
  const ddPct = Math.min(100, (acc.currentDrawdownPct / acc.maxDrawdownPct) * 100);
  const ddColor = danger ? "var(--red)" : ddPct > 50 ? "var(--amber)" : "var(--green)";
  const payoutPaid = acc.payoutStatus === "Paid";

  return (
    <div
      style={{
        border: `1px solid ${danger ? "rgba(255,84,112,0.3)" : "var(--border)"}`,
        borderRadius: 14, background: "var(--bg-card)", padding: "18px 20px",
        opacity: acc.isActive ? 1 : 0.55,
      }}
    >
      <div className="acc-card-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "start" }}>
        <div>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>{acc.name}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 10, padding: "3px 9px", borderRadius: 999, fontWeight: 600, letterSpacing: "0.05em",
              color: sm.color, background: sm.bg, border: `1px solid ${sm.border}`,
            }}>
              <StatusIcon size={11} strokeWidth={2} />
              {acc.status}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-label)" }}>
              <Landmark size={12} strokeWidth={2} />
              {acc.broker}
            </span>
            <span style={{
              fontSize: 11, color: "var(--text-label)", background: "var(--bg-card-2)",
              padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border)",
            }}>
              {acc.type}
            </span>
            {acc.payoutStatus !== "None" && (
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 999,
                color: payoutPaid ? "var(--green)" : "var(--amber)",
                background: payoutPaid ? "rgba(35,224,160,0.1)" : "rgba(246,183,60,0.1)",
                border: `1px solid ${payoutPaid ? "rgba(35,224,160,0.28)" : "rgba(246,183,60,0.28)"}`,
              }}>
                Payout: {acc.payoutStatus}
              </span>
            )}
          </div>

          {/* Metrics row */}
          <div className="acc-metrics" style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <MetricLabel>BALANCE</MetricLabel>
              <p style={{ margin: 0, fontFamily: mono, fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>
                {fmt(acc.currentBalance, acc.currency)}
              </p>
            </div>
            <div>
              <MetricLabel>START</MetricLabel>
              <p style={{ margin: 0, fontFamily: mono, fontSize: 14, color: "var(--text-label)", paddingTop: 3 }}>
                {fmt(acc.startingBalance, acc.currency)}
              </p>
            </div>
            <div>
              <MetricLabel>P&L</MetricLabel>
              <p style={{ margin: 0, fontFamily: mono, fontSize: 16, fontWeight: 600, color: pnlColor }}>
                {sign(pnl)}{fmt(pnl, acc.currency)}
              </p>
            </div>
            {acc.profitTarget != null && acc.profitTarget !== 0 && (
              <div>
                <MetricLabel>TARGET</MetricLabel>
                <p style={{ margin: 0, fontFamily: mono, fontSize: 14, color: "var(--text-label)", paddingTop: 3 }}>
                  {fmt(acc.profitTarget, acc.currency)}
                </p>
              </div>
            )}
            <div>
              <MetricLabel>WIN RATE</MetricLabel>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-body)", paddingTop: 3, whiteSpace: "nowrap" }}>
                {acc.stats.winRate}% <span style={{ color: "var(--text-3)" }}>({acc.stats.closedTrades} trades)</span>
              </p>
            </div>
            <div>
              <MetricLabel>TOTAL R</MetricLabel>
              <p style={{ margin: 0, fontFamily: mono, fontSize: 14, paddingTop: 3, color: acc.stats.totalR >= 0 ? "var(--green)" : "var(--red)" }}>
                {sign(acc.stats.totalR)}{acc.stats.totalR}R
              </p>
            </div>
          </div>

          {/* Drawdown */}
          <div style={{ maxWidth: 360 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontFamily: mono, fontSize: 10, color: "var(--text-3)" }}>
              <span style={{ color: ddColor }}>{acc.currentDrawdownPct.toFixed(1)}% used</span>
              <span>{acc.maxDrawdownPct}% max drawdown</span>
            </div>
            <div style={{ height: 5, background: "var(--border-subtle)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${ddPct.toFixed(0)}%`, height: "100%", background: ddColor, borderRadius: 3, transition: "width 0.3s" }} />
            </div>
            {danger && (
              <p style={{ margin: "6px 0 0", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--red)" }}>
                <TriangleAlert size={12} strokeWidth={2} />
                Drawdown danger — {acc.stats.drawdownRemaining.toFixed(1)}% remaining
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
          <a
            href={`/accounts/${acc.id}`}
            className="acc-btn-hover"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px",
              borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)",
              color: "var(--text-body)", fontSize: 12, textDecoration: "none",
            }}
          >
            History
            <ArrowRight size={13} strokeWidth={2} />
          </a>
          <button
            onClick={() => onEdit(acc)}
            className="acc-icon-btn-hover"
            title="Edit"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-card-2)", color: "var(--text-label)", cursor: "pointer",
            }}
          >
            <Pencil size={14} strokeWidth={2} />
          </button>
          {acc.isActive && (
            <button
              onClick={() => onArchive(acc.id)}
              title="Archive"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: 8,
                border: "1px solid rgba(255,84,112,0.28)", background: "rgba(255,84,112,0.08)",
                color: "var(--red)", cursor: "pointer",
              }}
            >
              <Archive size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
