// app/_components/strategies.ts
//
// Registry of trading strategies the dashboard recognizes. Keyed by the value
// stored in Trade.model (a single character today — A, B, C, ...).
//
// To add a new strategy in the future:
//   1. Add a row here with a fresh code letter and matching colors.
//   2. Run `npx prisma db push` IF you want a typed enum constraint — the
//      current schema is just `model String`, so no migration is needed.
//   3. The model dropdowns on /journal and the edit drawer pick up the new
//      entry automatically.
//
// When the strategy list grows past a handful, move this into the DB
// (Strategy table) and load it via /api/strategies. The component shape
// already supports that — just swap the constant for a fetch.

export interface StrategyDef {
  code: string;            // single letter — what gets stored in Trade.model
  name: string;            // short display name on cards
  subtitle: string;        // one-line description
  accent: string;          // primary color (CSS var or hex)
  accentDim: string;       // tinted background
  accentBorder: string;    // border accent
  visualKind: 'wyckoff' | 'liquidity-run' | 'generic';
}

export const STRATEGIES: StrategyDef[] = [
  {
    code: 'A',
    name: 'Wyckoff trap',
    subtitle: 'Spring (long) · Upthrust (short)',
    accent:       'var(--green)',
    accentDim:    'var(--green-dim)',
    accentBorder: 'var(--green-border)',
    visualKind: 'wyckoff',
  },
  {
    code: 'B',
    name: 'Liquidity run',
    subtitle: 'Stops swept · reversal',
    accent:       'var(--amber)',
    accentDim:    'var(--amber-dim)',
    accentBorder: 'var(--amber-border)',
    visualKind: 'liquidity-run',
  },
];

export function getStrategy(code: string | null | undefined): StrategyDef | null {
  if (!code) return null;
  return STRATEGIES.find((s) => s.code === code) ?? null;
}
