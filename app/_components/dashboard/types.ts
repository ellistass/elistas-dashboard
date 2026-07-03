// app/_components/dashboard/types.ts
// Shared response types for the dashboard page (mirrors /api/dashboard +
// /api/accounts payloads — unchanged from the pre-redesign page.tsx).

export interface CurrencyScore {
  cur: string; score: number; tag: string;
  fundamental: number; pricePerf: number; stdDev: number; notes?: string[];
}
export interface PairSetup {
  pair: string; direction: string; strong: string; weak: string;
  divergence: number; grade: string; session: string[];
  reason: string; strongScore: number; weakScore: number;
}
export interface ScoringResult {
  top3: CurrencyScore[]; bottom3: CurrencyScore[];
  pairs9: PairSetup[]; priority1: PairSetup;
  allScores: CurrencyScore[]; divergenceWarnings?: string[];
  generatedAt?: string; scoredBy?: string;
  scoringModel?: string | null; dataAge?: number | null;
  // Context fields from Claude's reasoning
  reasoning?: string | null;
  neutralCurrencies?: string[];
  excludedCurrencies?: string[];
  excludedReasons?: string[];
  marketCondition?: string | null;
  sessionRecommendation?: string | null;
}
export interface OpenTrade {
  id: string; pair: string; direction: string; model: string;
  grade: string; session: string; entryPrice: number;
  slPrice: number; tpPrice: number; strongCcy: string;
  weakCcy: string; divScore?: number;
  alignmentStatus: "Green" | "Amber" | "Red" | "Unknown";
  alignmentReason: string; date: string;
  newsCollisions?: Array<{ title: string; country: string; currency: string; date: string; impact: string }>;
  source?: string; accountId?: string | null; riskPercent?: number;
  lotSize?: number | null; profitCcy?: number | null;
}
export interface SectorRow { sector: string; symbol?: string; percentChange: number }
export interface CentralBankRateLite { currency: string; bankName: string; currentRate: number; previousRate: number | null; source?: string }
export interface FreshnessTile { source: string; label: string; fetchedAt: string | null; ageMinutes: number | null; status: 'fresh' | 'stale' | 'missing' }
export interface DailyRStatus { todayR: number; cutoffR: number; pctOfCutoff: number; state: 'safe' | 'caution' | 'stop'; closedToday: number }
export interface CalEvent { title: string; country: string; currency: string; date: string; impact: string; forecast: string | null; previous: string | null; actual: string | null }
export interface MacroTile { symbol: string; name: string; latest: number; percentChange: number }
export interface RecentAlert { id: string; date: string; sentAt: string | null; pair: string | null; direction: string | null; grade: string | null }
export interface DashboardData {
  scores: ScoringResult | null; openTrades: OpenTrade[];
  sectors?: SectorRow[];
  centralBankRates?: CentralBankRateLite[];
  freshness?: FreshnessTile[];
  dailyR?: DailyRStatus;
  nextEvent?: CalEvent | null;
  macros?: MacroTile[];
  todaysIdeas?: any[];
  recentAlerts?: RecentAlert[];
  barchartFetchedAt?: string | null;
  ratesFetchedAt?: string | null;
  fetchedAt: string; fetchErrors: string[];
  hasLiveData: boolean; scoredAt?: string | null;
}
export interface AccountAggregate {
  totalAccounts: number; activeAccounts: number;
  byStatus: Record<string, number>;
  totalEquity: number; totalPnL: number; dangerAccounts: number;
}
