"use client";
// app/_components/Pager.tsx
// Lightweight pager. Caller owns the data + the page-slicing math; this is
// purely controls. Renders Prev / Next, page count, and "X–Y of N".

interface Props {
  total: number;
  pageSize: number;
  page: number;
  onChange: (next: number) => void;
}

export function Pager({ total, pageSize, page, onChange }: Props) {
  if (total <= pageSize) return null;     // nothing to page through

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * pageSize + 1;
  const end = Math.min(total, (safePage + 1) * pageSize);

  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 14px", fontSize: 11, color: "var(--text-3)",
      borderTop: "1px solid var(--border-subtle)",
    }}>
      <span>
        {start}–{end} of {total}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => onChange(safePage - 1)}
          disabled={safePage <= 0}
          style={pagerBtn(safePage <= 0)}
        >‹ Prev</button>
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          Page <span className="font-mono">{safePage + 1}</span> / {pageCount}
        </span>
        <button
          onClick={() => onChange(safePage + 1)}
          disabled={safePage >= pageCount - 1}
          style={pagerBtn(safePage >= pageCount - 1)}
        >Next ›</button>
      </span>
    </div>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 11, padding: "4px 10px", borderRadius: 6,
    background: "transparent", color: disabled ? "var(--text-3)" : "var(--text-2)",
    border: "1px solid var(--border)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
