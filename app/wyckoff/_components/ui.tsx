"use client";
// app/wyckoff/_components/ui.tsx — the small shared pieces every surface uses.
// Extracted from the old single-page desk so the five routes cannot drift into
// five slightly different section headers.

import { Inbox } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export function SectionHeader({ icon, title, count, total, note, right }: {
  icon?: React.ReactNode; title: string; count?: number; total?: number;
  note?: string; right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 600, color: "var(--text-1)" }}>
        {icon} {title}
      </span>
      {count != null && (
        <span style={{ ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border-strong)", color: "var(--text-2)" }}>
          {total != null && total !== count ? `${count} of ${total}` : count}
        </span>
      )}
      {note && <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{note}</span>}
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

export function EmptyState({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className="card" style={{ padding: small ? 26 : 40, textAlign: "center", marginBottom: 30 }}>
      <Inbox size={18} strokeWidth={1.6} style={{ color: "var(--text-3)", marginBottom: 8 }} />
      <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0, maxWidth: 460, marginInline: "auto", lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  );
}

export function LoadingCard({ what }: { what: string }) {
  return (
    <div className="card" style={{ padding: 48, textAlign: "center" }}>
      <p style={{ ...mono, fontSize: 12, color: "var(--text-3)", margin: 0 }}>Loading {what}…</p>
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 14, border: "1px solid var(--red-border)" }}>
      <span style={{ ...mono, fontSize: 12, color: "var(--red)" }}>{message}</span>
    </div>
  );
}
