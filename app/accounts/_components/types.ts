// app/accounts/_components/types.ts — shared types + status meta for the Accounts screen.
// Interfaces are reused VERBATIM from the previous app/accounts/page.tsx — do not change
// field names or shapes; they mirror the /api/accounts response contract.

import type { LucideIcon } from "lucide-react";
import {
  Target, Layers, BadgeCheck, Radio, CircleCheck, CircleX, TriangleAlert, Archive,
} from "lucide-react";

// ── Types (verbatim from the old page) ───────────────────────────────────────

export interface AccountStats {
  totalTrades: number; openTrades: number; closedTrades: number;
  wins: number; winRate: number; totalR: number;
  computedPnL: number; pnl: number;
  drawdownRemaining: number; drawdownDanger: boolean;
}
export interface Account {
  id: string; createdAt: string; name: string; broker: string;
  type: string; market: string; status: string; currency: string;
  startingBalance: number; currentBalance: number;
  profitTarget: number | null; maxDrawdownPct: number;
  dailyDrawdownLimitPct: number; currentDrawdownPct: number;
  currentDailyDrawdownPct: number; payoutStatus: string;
  notes: string | null; isActive: boolean; stats: AccountStats;
}
export interface Aggregate {
  totalAccounts: number; activeAccounts: number;
  byStatus: Record<string, number>;
  totalEquity: number; totalPnL: number; dangerAccounts: number;
}

// ── Form (verbatim fields / payload shape from the old page) ────────────────

export const emptyForm = {
  name: "", broker: "", type: "Prop", market: "forex", status: "Phase1",
  currency: "USD", startingBalance: "", currentBalance: "",
  profitTarget: "", maxDrawdownPct: "10", dailyDrawdownLimitPct: "5",
  currentDrawdownPct: "0", currentDailyDrawdownPct: "0",
  payoutStatus: "None", notes: "",
};
export type AccountForm = typeof emptyForm;

// ── Status meta (prototype statusMeta) — color + icon (colorblind safety) ────

export interface StatusMeta { color: string; bg: string; border: string; Icon: LucideIcon }

export const STATUS_META: Record<string, StatusMeta> = {
  Phase1:   { color: "#3ad4ec", bg: "rgba(58,212,236,0.12)",  border: "rgba(58,212,236,0.3)",  Icon: Target },
  Phase2:   { color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.3)", Icon: Layers },
  Funded:   { color: "#23e0a0", bg: "rgba(35,224,160,0.12)",  border: "rgba(35,224,160,0.3)",  Icon: BadgeCheck },
  Live:     { color: "#23e0a0", bg: "rgba(35,224,160,0.12)",  border: "rgba(35,224,160,0.3)",  Icon: Radio },
  Passed:   { color: "#23e0a0", bg: "rgba(35,224,160,0.12)",  border: "rgba(35,224,160,0.3)",  Icon: CircleCheck },
  Failed:   { color: "#ff5470", bg: "rgba(255,84,112,0.12)",  border: "rgba(255,84,112,0.3)",  Icon: CircleX },
  Breached: { color: "#ff5470", bg: "rgba(255,84,112,0.12)",  border: "rgba(255,84,112,0.3)",  Icon: TriangleAlert },
  Archived: { color: "#565d78", bg: "#1e2130",                border: "#333850",               Icon: Archive },
};

export function statusMeta(s: string): StatusMeta {
  return STATUS_META[s] ?? STATUS_META.Archived;
}

export function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
