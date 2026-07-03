"use client";
// app/_components/Pager.tsx
// Lightweight pager, restyled to the v2 design language (History.dc.html):
// "Showing {n} of {total}" on the left, 32px chevron buttons + "page / pages"
// on the right. Caller owns the data + page-slicing math; this is controls only.

import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  total: number;
  pageSize: number;
  page: number;                 // 0-based
  onChange: (next: number) => void;
  /** Optional override for the left label count (e.g. rows after a client-side filter). */
  shown?: number;
}

export function Pager({ total, pageSize, page, onChange, shown }: Props) {
  if (total <= pageSize) return null; // nothing to page through

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * pageSize + 1;
  const end = Math.min(total, (safePage + 1) * pageSize);
  const count = shown ?? end - start + 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 16,
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 12,
          color: "var(--text-3)",
        }}
      >
        Showing {count} of {total}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => onChange(safePage - 1)}
          disabled={safePage <= 0}
          aria-label="Previous page"
          style={pagerBtn(safePage <= 0)}
        >
          <ChevronLeft size={15} strokeWidth={2} />
        </button>
        <span
          style={{
            padding: "0 10px",
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            color: "var(--text-label)",
          }}
        >
          {safePage + 1} / {pageCount}
        </span>
        <button
          onClick={() => onChange(safePage + 1)}
          disabled={safePage >= pageCount - 1}
          aria-label="Next page"
          style={pagerBtn(safePage >= pageCount - 1)}
        >
          <ChevronRight size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "var(--bg-inset)",
    border: "1px solid var(--border)",
    color: disabled ? "var(--text-3)" : "var(--text-label)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}
