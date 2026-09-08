// lib/ea-health.ts — is the trade journal actually being told the truth?
//
// The MT4 EA pushes events. When the terminal is off, or a POST fails past its
// retries, the event is simply never sent — and nothing downstream notices,
// because every consumer reads `outcome === 'Open'` and none of them ask when
// the account last reported. A trade that closed while the EA was down sits in
// Active looking exactly like a live position.
//
// That produced three trades stuck Open for up to a month, and one account
// (FundedNext) that had not reported for fifteen days without a word anywhere
// in the UI. The EA has a repair path — it reconciles its open book against the
// server's — but before v2.11 that ran only at OnInit, so it needed a human who
// knew to reattach the EA.
//
// This is the detector for the other half: say out loud when the journal cannot
// be trusted, and say what to do about it. It asserts nothing about a specific
// trade — it cannot know whether a position is live or stale. It reports the
// conditions under which "Open" stops meaning "open".

export interface AccountSync {
  id: string;
  name: string;
  isActive: boolean;
  lastSyncedAt: Date | string | null;
  eaSyncMode?: string | null;
}

export interface OpenTradeLite {
  id: string;
  ticket?: number | null;
  pair: string;
  accountId?: string | null;
  openTimeUtc?: Date | string | null;
  date?: Date | string | null;
}

/** Hours of silence before an active account is called quiet. The EA sends a
 *  balance heartbeat every 5 minutes by default, so 24h is not a borderline
 *  gap — it means the terminal has been shut, not that a tick was missed.
 *  Generous on purpose: a warning that cries wolf gets ignored, and this one
 *  needs to still mean something in six months. */
export const QUIET_HOURS = 24;

/** Days a trade can sit Open before it is worth a second look. Not a bug on its
 *  own — a swing position is allowed to run — but combined with a quiet EA it
 *  is the exact shape of a close that never arrived. */
export const LONG_OPEN_DAYS = 14;

const ms = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

const hoursSince = (d: Date | string | null | undefined): number | null => {
  const t = ms(d);
  return t == null ? null : (Date.now() - t) / 3_600_000;
};

export interface QuietAccount {
  id: string;
  name: string;
  hoursQuiet: number | null;   // null = has never reported at all
  daysQuiet: number | null;
  openTrades: number;          // positions the journal still shows live there
}

export interface StaleOpenTrade {
  id: string;
  ticket?: number | null;
  pair: string;
  accountName: string | null;
  daysOpen: number;
  /** True when this trade's account is ALSO quiet — the combination that
   *  actually means "this probably closed and nobody heard". */
  accountQuiet: boolean;
}

export interface EaHealth {
  quietAccounts: QuietAccount[];
  staleOpenTrades: StaleOpenTrade[];
  /** Worth interrupting the page for. A long-running position on a healthy
   *  account is normal and must not raise a banner. */
  needsAttention: boolean;
}

export function assessEaHealth(
  accounts: AccountSync[],
  openTrades: OpenTradeLite[],
): EaHealth {
  const active = accounts.filter((a) => a.isActive);
  const byId = new Map(active.map((a) => [a.id, a]));

  const openCountFor = (accountId: string) =>
    openTrades.filter((t) => t.accountId === accountId).length;

  const quietAccounts: QuietAccount[] = active
    .map((a) => {
      const h = hoursSince(a.lastSyncedAt);
      return {
        id: a.id,
        name: a.name,
        hoursQuiet: h,
        daysQuiet: h == null ? null : Math.floor(h / 24),
        openTrades: openCountFor(a.id),
      };
    })
    // Never reported (h == null) counts as quiet ONLY if it is carrying open
    // trades — a freshly created account with no EA yet is not a fault.
    .filter((q) => (q.hoursQuiet == null ? q.openTrades > 0 : q.hoursQuiet >= QUIET_HOURS));

  const quietIds = new Set(quietAccounts.map((q) => q.id));

  const staleOpenTrades: StaleOpenTrade[] = openTrades
    .map((t) => {
      const opened = ms(t.openTimeUtc) ?? ms(t.date);
      const daysOpen = opened == null ? 0 : Math.floor((Date.now() - opened) / 86_400_000);
      return {
        id: t.id,
        ticket: t.ticket,
        pair: t.pair,
        accountName: t.accountId ? byId.get(t.accountId)?.name ?? null : null,
        daysOpen,
        accountQuiet: !!t.accountId && quietIds.has(t.accountId),
      };
    })
    .filter((t) => t.daysOpen >= LONG_OPEN_DAYS || t.accountQuiet)
    .sort((a, b) => b.daysOpen - a.daysOpen);

  return {
    quietAccounts,
    staleOpenTrades,
    // A stale trade alone is not enough — you are allowed to hold something for
    // three weeks. The banner fires when an EA has gone quiet, or when a trade
    // has been open long enough that a missed close is the likelier story.
    needsAttention:
      quietAccounts.length > 0 || staleOpenTrades.some((t) => t.daysOpen >= LONG_OPEN_DAYS),
  };
}
