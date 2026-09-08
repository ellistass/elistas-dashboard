"use client";
// app/_components/dashboard/EaHealthBanner.tsx — say it out loud.
//
// The journal is only as honest as the EA feeding it, and when the EA stops
// feeding it the failure is silent by construction: a trade whose close event
// never arrived looks identical to one that is genuinely running. Three trades
// sat Open for up to a month that way, and one account went fifteen days
// without reporting while the dashboard said nothing at all.
//
// So this is not a status widget. It appears only when "Open" has stopped
// meaning "open", and it says the specific thing to do about it — reattaching
// the EA is what re-runs reconciliation, and there is no way anyone would
// guess that from the UI.

import { AlertTriangle, PlugZap } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export interface EaHealthPayload {
  quietAccounts: Array<{ id: string; name: string; daysQuiet: number | null; openTrades: number }>;
  staleOpenTrades: Array<{
    id: string; ticket?: number | null; pair: string;
    accountName: string | null; daysOpen: number; accountQuiet: boolean;
  }>;
  needsAttention: boolean;
}

export function EaHealthBanner({ health }: { health?: EaHealthPayload | null }) {
  if (!health?.needsAttention) return null;

  const { quietAccounts, staleOpenTrades } = health;
  const longOpen = staleOpenTrades.filter((t) => t.daysOpen >= 14);

  return (
    <div
      style={{
        display: "flex", gap: 11, padding: "12px 15px", borderRadius: 11, marginBottom: 12,
        background: "var(--amber-dim)", border: "1px solid var(--amber-border)",
      }}
    >
      <AlertTriangle size={15} strokeWidth={2} style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--amber)" }}>
          The trade journal may be out of date
        </p>

        {quietAccounts.length > 0 && (
          <p style={{ ...mono, fontSize: 11, color: "var(--text-2)", margin: "7px 0 0", lineHeight: 1.6 }}>
            {quietAccounts.map((a, i) => (
              <span key={a.id}>
                {i > 0 && " · "}
                <span style={{ color: "var(--text-1)" }}>{a.name}</span>{" "}
                {a.daysQuiet == null
                  ? "has never reported"
                  : `silent ${a.daysQuiet === 0 ? "over a day" : `${a.daysQuiet} days`}`}
                {a.openTrades > 0 && ` · ${a.openTrades} position${a.openTrades === 1 ? "" : "s"} still shown open`}
              </span>
            ))}
          </p>
        )}

        {longOpen.length > 0 && (
          <p style={{ ...mono, fontSize: 11, color: "var(--text-2)", margin: "5px 0 0", lineHeight: 1.6 }}>
            Open {longOpen[0].daysOpen}+ days:{" "}
            {longOpen.slice(0, 4).map((t, i) => (
              <span key={t.id}>
                {i > 0 && " · "}
                <span style={{ color: "var(--text-1)" }}>{t.pair}</span>
                {t.ticket ? ` #${t.ticket}` : ""} ({t.daysOpen}d)
              </span>
            ))}
            {longOpen.length > 4 && ` · +${longOpen.length - 4} more`}
          </p>
        )}

        <p style={{
          ...mono, fontSize: 10.5, color: "var(--text-3)", margin: "9px 0 0", lineHeight: 1.6,
          display: "flex", gap: 6, alignItems: "flex-start",
        }}>
          <PlugZap size={12} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Reattach the EA on a chart for that account — reconciliation runs on attach and
            re-sends any close the server never heard. Set the Account History tab to
            <em> All History</em> first, or closes older than the loaded window stay invisible to it.
            From EA v2.11 this also repeats every 30 minutes on its own.
          </span>
        </p>
      </div>
    </div>
  );
}
