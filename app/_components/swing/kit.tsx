"use client";
// app/_components/swing/kit.tsx — shared pieces for the swing pages (Tonight,
// Trades, Discipline, Month, Journal): section headers, tags, buttons, the
// candle chart with your levels drawn on it, sparklines, the month bar
// (monthly stop ↔ target), distance bars, bars-left pips, score rings and an
// R-per-trade chart. Colours come from the dashboard tokens, so SVG marks use
// style={{ fill: "var(--…)" }} (presentation attributes can't read CSS vars).

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./kit.module.css";

export { s as kit };

const MONO = "'DM Mono', ui-monospace, monospace";
export const px = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : Math.abs(x) >= 2 ? x.toFixed(2) : x.toFixed(5);
export const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const rr = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`);

/** Width of the element in CSS pixels, so SVG charts draw 1 unit = 1 pixel (crisp text, no scaling). */
export function useWidth<T extends HTMLElement>(initial = 560) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW(x); };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export type Tone = "long" | "short" | "good" | "warn" | "bad" | "info" | "plain";
const TONE_VAR: Record<string, string> = {
  green: "var(--green)", red: "var(--red)", amber: "var(--amber)", accent: "var(--accent)", fg: "var(--text-1)", fg2: "var(--text-2)", fg3: "var(--text-3)",
  greenDim: "var(--green-dim)", redDim: "var(--red-dim)", amberDim: "var(--amber-dim)", accentDim: "var(--accent-dim)",
};
const tv = (t: string) => TONE_VAR[t] ?? t;

// ── Layout ───────────────────────────────────────────────────────────────────

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className={s.head}>
      <div><h1 className={s.title}>{title}</h1>{sub ? <div className={s.sub}>{sub}</div> : null}</div>
      {right}
    </header>
  );
}

export function Section({ title, count, hint, right, children }: { title: string; count?: number; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.spread}>
        <div className={s.eyebrow} style={{ flex: 1 }}>
          {title}{count != null ? <span className={s.eyebrowCount}>{count}</span> : null}
          {hint ? <span className={s.eyebrowHint}>— {hint}</span> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Tag({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${s.tag} ${tone !== "plain" ? s[tone] : ""}`}>{children}</span>;
}

export function SideTag({ side }: { side: string }) {
  return <Tag tone={side === "long" ? "long" : "short"}>{side === "long" ? "LONG" : "SHORT"}</Tag>;
}

export function Grade({ g }: { g: string }) {
  return <span className={`${s.grade} ${g === "A" ? s.gradeA : ""}`}>{g}</span>;
}

export function Btn({ primary, danger, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  return <button {...p} className={`${s.btn} ${primary ? s.btnPrimary : ""} ${danger ? s.btnDanger : ""} ${p.className ?? ""}`}>{children}</button>;
}

/** The one plain instruction on a card. */
export function Do({ what, why, tone = "info" }: { what: ReactNode; why?: ReactNode; tone?: "info" | "warn" | "bad" }) {
  return (
    <div className={`${s.do} ${tone === "warn" ? s.doWarn : tone === "bad" ? s.doBad : ""}`}>
      <div className={s.doWhat}>{what}</div>
      {why ? <div className={s.doWhy}>{why}</div> : null}
    </div>
  );
}

export function Stat({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return <div><div className={s.statK}>{k}</div><div className={s.statV} style={{ color: tone ? tv(tone) : undefined }}>{v}</div></div>;
}

export function Level({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return <div className={s.inset}><div className={s.lvlK}>{k}</div><div className={s.lvlV} style={{ color: tone ? tv(tone) : undefined }}>{v}</div></div>;
}

export function Slots({ used, max }: { used: number; max: number }) {
  return (
    <span className={s.slots} aria-label={`${used} of ${max} slots used`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={`${s.slot} ${i < used ? s.slotOn : ""}`} />)}
      <span className={s.small}>{used}/{max}</span>
    </span>
  );
}

export function Pips({ left, total }: { left: number; total: number }) {
  const n = Math.max(total, left);
  return (
    <div>
      <div className={s.pips} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={`${s.pip} ${i < left ? s.pipOn : ""}`} />)}</div>
      <div className={s.small} style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{left} bar{left === 1 ? "" : "s"} left</div>
    </div>
  );
}

/** Fuller bar = closer to the level. */
export function DistBar({ label, pct, near }: { label: ReactNode; pct: number; near: boolean }) {
  const w = Math.max(4, 100 - Math.min(100, pct * 8));
  return (
    <div className={s.dist}>
      <div className={s.small}>{label}</div>
      <div className={s.track}><i className={s.fill} style={{ width: `${w}%`, background: near ? "var(--amber)" : "var(--text-3)" }} /></div>
    </div>
  );
}

// ── Clocks ───────────────────────────────────────────────────────────────────

/** Countdowns to tonight's closes. `closes` are Lagos wall times "21:00". Lagos is UTC+1 all year. */
export function Clocks({ closes }: { closes: { label: string; at: string }[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const until = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(now);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 1, m);
    if (t <= now) t += 864e5;
    const mins = Math.round((t - now) / 60000);
    return { mins, text: `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` };
  };
  const rows = closes.map((c) => ({ ...c, ...until(c.at) }));
  const next = Math.min(...rows.map((r) => r.mins));
  return (
    <div className={s.clocks}>
      {rows.map((r) => (
        <div key={r.label} className={`${s.clock} ${r.mins === next ? s.clockNext : ""}`}>
          <div className={s.clockK}>{r.label}</div>
          <div className={s.clockV}>{r.text}</div>
          <div className={s.clockT}>{r.at} Lagos</div>
        </div>
      ))}
    </div>
  );
}

// ── Month bar: monthly stop ← $0 → target ───────────────────────────────────

export function MonthBar({ stop, target, realised, worst }: { stop: number; target: number; realised: number; worst: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(400);
  const x0 = (W * stop) / (stop + target);
  const sx = (v: number) => (v < 0 ? x0 + (Math.max(v, -stop) / stop) * x0 : x0 + (Math.min(v, target) / target) * (W - x0));
  const worstX = sx(Math.min(0, worst)), realX = sx(Math.max(0, realised));
  return (
    <div ref={ref} style={{ width: "100%" }}><svg width={W} height={46} viewBox={`0 0 ${W} 46`} style={{ display: "block" }} role="img"
      aria-label={`Realised ${usd(realised)}, worst case ${usd(worst)}, between a ${usd(-stop)} monthly stop and a ${usd(target)} target`}>
      <text x={2} y={9} fontFamily={MONO} fontSize={11} style={{ fill: "var(--text-3)" }}>THIS MONTH</text>
      <rect x={0} y={14} width={x0} height={10} rx={3} style={{ fill: "var(--red-dim)" }} />
      <rect x={x0} y={14} width={W - x0} height={10} rx={3} style={{ fill: "var(--green-dim)" }} />
      {worst < 0 ? <rect x={worstX} y={14} width={x0 - worstX} height={10} style={{ fill: "var(--red)" }} /> : null}
      {realised > 0 ? <rect x={x0} y={14} width={realX - x0} height={10} style={{ fill: "var(--green)" }} /> : null}
      {realised < 0 ? <line x1={sx(realised)} x2={sx(realised)} y1={10} y2={28} strokeWidth={2} style={{ stroke: "var(--amber)" }} /> : null}
      <line x1={x0} x2={x0} y1={8} y2={30} strokeWidth={2} style={{ stroke: "var(--text-1)" }} />
      <text x={2} y={44} fontFamily={MONO} fontSize={11} style={{ fill: "var(--red)" }}>{usd(-stop)} stop</text>
      <text x={x0} y={44} textAnchor="middle" fontFamily={MONO} fontSize={11} style={{ fill: "var(--text-2)" }}>$0</text>
      <text x={W - 2} y={44} textAnchor="end" fontFamily={MONO} fontSize={11} style={{ fill: "var(--green)" }}>+{usd(target)} target</text>
    </svg></div>
  );
}

// ── Candle chart with levels ─────────────────────────────────────────────────

/** [date, o, h, l, c] */
export type Candle = [string, number, number, number, number];
export interface ChartLine { label: string; value: number; tone: string; dash?: boolean }
export interface ChartZone { from: number; to: number; tone: string; startIdx?: number }

export function CandleChart({ bars, lines, zones = [], height = 200, marks = [] }: {
  bars: Candle[]; lines: ChartLine[]; zones?: ChartZone[]; height?: number; marks?: { date: string; label: string; tone: string }[];
}) {
  const [ref, W] = useWidth<HTMLDivElement>(560);
  if (!bars.length) return <div className={s.empty}>no price data yet</div>;
  const H = height, padR = 76, padT = 10, padB = 18, cw = W - padR;
  const vals = lines.map((l) => l.value).filter(Number.isFinite);
  let lo = Math.min(...bars.map((b) => b[3]), ...vals), hi = Math.max(...bars.map((b) => b[2]), ...vals);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const bw = cw / bars.length;
  // Level labels: nudge apart so they never overlap.
  const labels = lines.map((l) => ({ ...l, y: y(l.value) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 17) labels[i].y = labels[i - 1].y + 17;
  return (
    <div ref={ref} style={{ width: "100%" }}><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} role="img"
      aria-label={`Daily candles ${bars[0][0]} to ${bars[bars.length - 1][0]}; ${lines.map((l) => `${l.label} ${px(l.value)}`).join(", ")}`}>
      {[0, 1, 2, 3].map((i) => { const v = lo + ((hi - lo) * i) / 3; return <line key={i} x1={0} x2={cw} y1={y(v)} y2={y(v)} strokeWidth={1} style={{ stroke: "var(--border-subtle)" }} />; })}
      {zones.map((z, i) => {
        const x = z.startIdx != null ? Math.max(0, z.startIdx) * bw : cw * 0.6;
        return <rect key={i} x={x} width={cw - x} y={y(Math.max(z.from, z.to))} height={Math.abs(y(z.from) - y(z.to))} style={{ fill: tv(z.tone) }} />;
      })}
      {bars.map((b, i) => {
        const [, o, h, l, c] = b, x = i * bw + bw / 2, col = c >= o ? "var(--green)" : "var(--red)";
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(h)} y2={y(l)} strokeWidth={1} style={{ stroke: col }} />
            <rect x={x - bw * 0.32} y={y(Math.max(o, c))} width={bw * 0.64} height={Math.max(1, Math.abs(y(o) - y(c)))} style={{ fill: col }} />
          </g>
        );
      })}
      {marks.map((m, i) => {
        const idx = bars.findIndex((b) => b[0] >= m.date);
        if (idx < 0) return null;
        const x = idx * bw + bw / 2;
        return <g key={i}><line x1={x} x2={x} y1={padT} y2={H - padB} strokeDasharray="2 3" style={{ stroke: tv(m.tone) }} />
          <text x={x + 3} y={padT + 8} fontFamily={MONO} fontSize={10.5} style={{ fill: tv(m.tone) }}>{m.label}</text></g>;
      })}
      {lines.map((l, i) => <line key={i} x1={0} x2={cw} y1={y(l.value)} y2={y(l.value)} strokeWidth={1.3} strokeDasharray={l.dash ? "4 3" : undefined} style={{ stroke: tv(l.tone) }} />)}
      {labels.map((l, i) => (
        <g key={i}>
          <rect x={cw + 4} y={l.y - 9} width={padR - 6} height={18} rx={4} style={{ fill: tv(l.tone) }} />
          <text x={cw + 9} y={l.y + 4} fontFamily={MONO} fontSize={11} fontWeight={500} style={{ fill: "#0a0b0f" }}>{px(l.value)}</text>
        </g>
      ))}
      <text x={0} y={H - 4} fontFamily={MONO} fontSize={11} style={{ fill: "var(--text-3)" }}>{bars[0][0].slice(5)}</text>
      <text x={cw} y={H - 4} textAnchor="end" fontFamily={MONO} fontSize={11} style={{ fill: "var(--text-3)" }}>{bars[bars.length - 1][0].slice(5)}</text>
    </svg></div>
  );
}

export function Legend({ items }: { items: { label: string; tone: string }[] }) {
  return <div className={s.legend}>{items.map((i) => <span key={i.label}><b className={s.legendSwatch} style={{ background: tv(i.tone) }} />{i.label}</span>)}</div>;
}

// ── Sparkline with a level ───────────────────────────────────────────────────

export function Sparkline({ values, level, height = 34 }: { values: number[]; level?: number | null; height?: number }) {
  if (values.length < 2) return null;
  const W = 200, H = height, all = level != null ? [...values, level] : values;
  const lo = Math.min(...all), hi = Math.max(...all), y = (v: number) => 2 + ((hi - v) / (hi - lo || 1)) * (H - 4), x = (i: number) => (i / (values.length - 1)) * W;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", width: "100%", height: H }} aria-hidden="true">
      <polygon points={`0,${H} ${pts} ${W},${H}`} style={{ fill: "var(--accent-dim)" }} />
      <polyline points={pts} fill="none" strokeWidth={1.2} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--text-2)" }} />
      {level != null ? <line x1={0} x2={W} y1={y(level)} y2={y(level)} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--amber)" }} /> : null}
      <circle cx={W} cy={y(values[values.length - 1])} r={2.5} style={{ fill: "var(--text-1)" }} />
    </svg>
  );
}

// ── Score ring ───────────────────────────────────────────────────────────────

export function Ring({ ok, total, label, target = 1 }: { ok: number; total: number; label: string; target?: number }) {
  const frac = total ? ok / total : 0, r = 30, c = 2 * Math.PI * r;
  const tone = !total ? "var(--text-3)" : frac >= target ? "var(--green)" : frac >= 0.8 ? "var(--amber)" : "var(--red)";
  return (
    <div className={s.card} style={{ display: "flex", gap: 14, alignItems: "center" }}>
      <svg viewBox="0 0 76 76" width={76} height={76} role="img" aria-label={`${label}: ${ok} of ${total}`}>
        <circle cx={38} cy={38} r={r} fill="none" strokeWidth={7} style={{ stroke: "var(--bg-card-2)" }} />
        {total ? <circle cx={38} cy={38} r={r} fill="none" strokeWidth={7} strokeLinecap="round" strokeDasharray={`${frac * c} ${c}`} transform="rotate(-90 38 38)" style={{ stroke: tone }} /> : null}
        <text x={38} y={43} textAnchor="middle" fontFamily={MONO} fontSize={15} style={{ fill: "var(--text-1)" }}>{total ? `${Math.round(frac * 100)}%` : "—"}</text>
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
        <div className={s.small} style={{ color: "var(--text-3)" }}>{total ? `${ok} of ${total}` : "nothing to score yet"} · target 100%</div>
      </div>
    </div>
  );
}

// ── R per trade + running total ──────────────────────────────────────────────

export function RBars({ items, height = 170 }: { items: { r: number; label: string }[]; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(900);
  if (!items.length) return <div className={s.empty}>no closed trades yet</div>;
  const H = height, padL = 40, padB = 16, cw = W - padL;
  let cum = 0;
  const cums = items.map((i) => (cum += i.r));
  const hi = Math.max(1, ...items.map((i) => i.r), ...cums), lo = Math.min(-1, ...items.map((i) => i.r), ...cums);
  const y = (v: number) => 6 + ((hi - v) / (hi - lo)) * (H - 6 - padB);
  const bw = cw / items.length;
  const ticks = [lo, 0, hi].map((v) => Math.round(v * 10) / 10);
  return (
    <div ref={ref} style={{ width: "100%" }}><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} role="img" aria-label={`R per trade and running total, now ${rr(cum)}`}>
      {ticks.map((t) => <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: t === 0 ? "var(--border-strong)" : "var(--border-subtle)" }} />
        <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontFamily={MONO} fontSize={10.5} style={{ fill: "var(--text-3)" }}>{t}R</text></g>)}
      {items.map((i, k) => (
        <rect key={k} x={padL + k * bw + (bw - Math.min(bw * 0.64, 46)) / 2} width={Math.min(bw * 0.64, 46)} y={Math.min(y(0), y(i.r))} height={Math.max(1, Math.abs(y(i.r) - y(0)))}
          style={{ fill: i.r >= 0 ? "var(--green)" : "var(--red)", opacity: 0.8 }}><title>{i.label}: {rr(i.r)}</title></rect>
      ))}
      <polyline fill="none" strokeWidth={2} style={{ stroke: "var(--accent)" }}
        points={cums.map((v, k) => `${padL + k * bw + bw / 2},${y(v)}`).join(" ")} />
      <circle cx={padL + (items.length - 1) * bw + bw / 2} cy={y(cum)} r={3.5} style={{ fill: "var(--accent)" }} />
      <text x={W - 2} y={Math.max(12, y(cum) - 8)} textAnchor="end" fontFamily={MONO} fontSize={12} style={{ fill: "var(--accent)" }}>{rr(cum)} total</text>
    </svg></div>
  );
}

// ── Horizontal funnel / bars ─────────────────────────────────────────────────

export function HBars({ rows }: { rows: { label: string; value: number; tone: string; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "92px 1fr 40px", gap: 10, alignItems: "center" }}>
          <span className={s.small}>{r.label}</span>
          <div className={s.track} style={{ height: 10, borderRadius: 5 }}><i className={s.fill} style={{ width: `${(r.value / max) * 100}%`, background: tv(r.tone), borderRadius: 5 }} /></div>
          <span className={s.mono} style={{ fontSize: 13, textAlign: "right" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
