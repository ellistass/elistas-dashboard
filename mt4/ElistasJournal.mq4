//+------------------------------------------------------------------+
//|                                              ElistasJournal.mq4 |
//|                              Auto-log MT4 trades to the dashboard|
//|                                                                  |
//|  HOW IT WORKS                                                    |
//|  -------------                                                   |
//|  • Attach to ANY chart on the terminal — it watches every trade  |
//|    on the account, not just the chart's symbol.                  |
//|  • OnTradeTransaction-style polling: each tick we diff the open  |
//|    orders + a tail of history against the last snapshot to find  |
//|    new opens, modifies, and closes. POSTs each event to the      |
//|    dashboard.                                                    |
//|  • On startup (OnInit) it sweeps history to catch any trades the |
//|    terminal missed while it was offline — back-fills the journal.|
//|  • At entry and close it grabs a screenshot of the chart and     |
//|    POSTs it to /api/trades/mt4/screenshot.                       |
//|                                                                  |
//|  SETUP                                                           |
//|  -----                                                           |
//|  • Tools → Options → Expert Advisors → "Allow WebRequest for    |
//|    listed URL" → add: https://elistas-dashboard.vercel.app       |
//|  • Drag this EA onto any chart, set the ApiKey input parameter.  |
//|  • Allow live trading + DLL imports (no DLLs used, but standard).|
//+------------------------------------------------------------------+
#property strict
#property copyright "Elistas"
#property version   "1.00"

//--- Inputs
input string  ApiBase     = "https://elistas-dashboard.vercel.app";
input string  ApiKey      = "REPLACE_WITH_ACCOUNT_API_KEY";  // per-account bearer token
input bool    SendScreenshots = true;                        // capture chart on open/close
input int     ScreenshotW   = 1280;
input int     ScreenshotH   = 720;
input int     CatchupHistoryDays = 0;                        // sweep history this far back on init; 0 = ALL history the broker exposes
input bool    ForceFullResweep   = false;                    // set true once to wipe the per-account catchup memory and re-POST everything. Useful after a dashboard rebuild.
input int     PollMillis    = 2000;                          // diff frequency
input bool    VerboseLog    = false;

//--- Internal state — known open tickets, and the most recent history ticket we've processed
int      knownOpenTickets[];
//--- Parallel arrays — for each entry in knownOpenTickets we remember the last
//--- SL / TP we saw. Every poll DetectModifications diffs current vs these and
//--- posts a modify event (with both old + new values) when they change.
double   knownOpenSL[];
double   knownOpenTP[];
int      lastHistoryTicket = 0;
datetime lastPollTime      = 0;
string   accountBroker     = "";

//+------------------------------------------------------------------+
//| Init                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   accountBroker = AccountCompany();
   Print("[ElistasJournal] Starting for MT4 account ", AccountNumber(), " (", accountBroker, ")");

   // Build the initial "known open tickets" snapshot from current open orders
   RebuildOpenSnapshot();

   // === Source-of-truth watermark ===
   // The server is authoritative about "what trades I already have". On every
   // OnInit we ask /api/trades/mt4/state for:
   //   • highestTicket  — max(ticket) the DB has for this account
   //   • openTickets[]  — tickets the DB still has as outcome=Open
   //
   // We use highestTicket as the sinceTicket watermark for SweepHistoryCatchup
   // — anything > that needs posting; anything ≤ is already in the DB.
   //
   // Why this beats a local GlobalVariable: when the user wipes data on the
   // dashboard (Danger zone → "Wipe all EA-synced data"), the server's
   // highestTicket drops to 0, so the next EA init re-posts everything
   // automatically. No more stale local marker blocking resync. No more
   // ForceFullResweep dance.
   //
   // We fall back to a GlobalVariable cache only if the fetch fails — keeps
   // the EA usable offline.
   string cacheKey = "ElistasJournal_LastSeenTicket_" + IntegerToString(AccountNumber());

   if(ForceFullResweep)
   {
      // Manual escape hatch — overrides the fetch and forces sinceTicket=0.
      // Set this true ONLY if the server is up but you want to deliberately
      // re-post everything (e.g. debugging).
      if(GlobalVariableCheck(cacheKey)) GlobalVariableDel(cacheKey);
      Print("[ElistasJournal] ForceFullResweep=true — local cache cleared and fetching fresh server state.");
   }

   int serverHighest = -1;
   int openServer[];  ArrayResize(openServer, 0);
   string syncMode = "full";  // default if server fetch fails
   bool serverOk = FetchServerState(serverHighest, openServer, syncMode);

   // === Mode gate ===
   // The dashboard's per-account toggle decides what the EA actually does.
   // We honor it here so the user can flip between full sync / realtime-only
   // / off without recompiling — just reload the chart.
   if(syncMode == "off")
   {
      Print("[ElistasJournal] syncMode=off — EA is paused for this account. No catchup, no polling. Change the toggle on the dashboard and reload the chart to re-enable.");
      return(INIT_SUCCEEDED);    // No timer started — OnTimer never fires.
   }

   int sinceTicket;
   if(serverOk)
   {
      sinceTicket = serverHighest;
      GlobalVariableSet(cacheKey, (double)serverHighest);
      Print("[ElistasJournal] Server state: syncMode=", syncMode,
            ", highestTicket=", serverHighest, ", openCount=", ArraySize(openServer));
   }
   else if(GlobalVariableCheck(cacheKey))
   {
      sinceTicket = (int)GlobalVariableGet(cacheKey);
      Print("[ElistasJournal] Server fetch failed — using cached watermark ticket #", sinceTicket);
   }
   else
   {
      sinceTicket = 0;
      Print("[ElistasJournal] Server fetch failed AND no cache — sweeping everything.");
   }

   // History catchup — skipped in realtime-only mode because the user is
   // authoritative on history via broker CSV import. Realtime events still
   // flow through OnTimer below.
   if(syncMode == "full")
   {
      int newMaxTicket = SweepHistoryCatchupSince(sinceTicket);
      if(newMaxTicket > sinceTicket)
         GlobalVariableSet(cacheKey, (double)newMaxTicket);
   }
   else
   {
      Print("[ElistasJournal] syncMode=realtime-only — skipping history catchup. Live opens / modifies / closes still post.");
   }

   // Open-trade reconciliation: any ticket open in MT4 right now that the
   // server doesn't have as Open gets a fresh open event POSTed. Useful in
   // realtime-only too — it's how the server learns about positions opened
   // before the EA was attached.
   if(serverOk) ReconcileOpensAgainstServer(openServer);

   EventSetMillisecondTimer(PollMillis);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Fetch authoritative state from the dashboard                      |
//|                                                                  |
//| GETs /api/trades/mt4/state and parses two fields from the JSON:  |
//|   • highestTicket — used as sinceTicket for the catchup sweep    |
//|   • openTickets   — list of tickets the server thinks are open   |
//|                                                                  |
//| Returns true on success. On any failure (network down, 401,      |
//| malformed body) returns false and the caller falls back to the   |
//| local cache.                                                     |
//+------------------------------------------------------------------+
bool FetchServerState(int &highestTicket, int &openTickets[], string &syncMode)
{
   string url     = ApiBase + "/api/trades/mt4/state";
   string headers = "Authorization: Bearer " + ApiKey + "\r\n";
   uchar  emptyBody[];
   char   result[];
   string resultHeaders;

   ResetLastError();
   int code = WebRequest("GET", url, headers, 5000, emptyBody, result, resultHeaders);
   if(code != 200)
   {
      Print("[ElistasJournal] /state fetch failed — code=", code, " err=", GetLastError());
      return(false);
   }

   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   // highestTicket — find the key, then the colon, then read digits.
   highestTicket = ParseJsonInt(body, "highestTicket");

   // syncMode — dashboard controls EA behavior remotely. Defaults to "full"
   // if missing from the response (older server build) so the EA stays
   // backwards-compatible.
   syncMode = ParseJsonString(body, "syncMode");
   if(StringLen(syncMode) == 0) syncMode = "full";

   // openTickets — extract whatever's between [ and ] after "openTickets":[
   ArrayResize(openTickets, 0);
   int arrStart = StringFind(body, "\"openTickets\"");
   if(arrStart >= 0)
   {
      int lb = StringFind(body, "[", arrStart);
      int rb = (lb >= 0) ? StringFind(body, "]", lb) : -1;
      if(lb >= 0 && rb > lb)
      {
         string inside = StringSubstr(body, lb + 1, rb - lb - 1);
         // Split on commas. Each element is a bare integer (no quotes).
         string parts[];
         int n = StringSplit(inside, ',', parts);
         for(int i = 0; i < n; i++)
         {
            string trimmed = parts[i];
            StringTrimLeft(trimmed); StringTrimRight(trimmed);
            if(StringLen(trimmed) == 0) continue;
            int tkt = (int)StringToInteger(trimmed);
            if(tkt > 0) AppendInt(openTickets, tkt);
         }
      }
   }

   return(true);
}

// Pull the quoted string that follows a JSON key. Returns "" if missing.
string ParseJsonString(string body, string key)
{
   string needle = "\"" + key + "\"";
   int idx = StringFind(body, needle);
   if(idx < 0) return("");
   int colon = StringFind(body, ":", idx + StringLen(needle));
   if(colon < 0) return("");
   int q1 = StringFind(body, "\"", colon + 1);
   if(q1 < 0) return("");
   int q2 = StringFind(body, "\"", q1 + 1);
   if(q2 < 0) return("");
   return(StringSubstr(body, q1 + 1, q2 - q1 - 1));
}

// Pull the integer that follows a JSON key from a flat response. Good enough
// for the shape /api/trades/mt4/state emits — no nested objects to worry about.
int ParseJsonInt(string body, string key)
{
   string needle = "\"" + key + "\"";
   int idx = StringFind(body, needle);
   if(idx < 0) return(0);
   int colon = StringFind(body, ":", idx + StringLen(needle));
   if(colon < 0) return(0);
   int len = StringLen(body);
   string num = "";
   bool started = false;
   for(int i = colon + 1; i < len; i++)
   {
      ushort c = StringGetCharacter(body, i);
      if(!started && (c == ' ' || c == '\t')) continue;
      if((c >= '0' && c <= '9') || (c == '-' && !started))
      {
         num = num + ShortToString(c);
         started = true;
      }
      else if(started)
      {
         break;
      }
   }
   if(StringLen(num) == 0) return(0);
   return((int)StringToInteger(num));
}

//+------------------------------------------------------------------+
//| For each open ticket in MT4 that the server doesn't know is open,|
//| POST a fresh open event. Covers "trade fired while EA was off".  |
//+------------------------------------------------------------------+
void ReconcileOpensAgainstServer(const int &openTicketsOnServer[])
{
   int posted = 0;
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      int ticket = OrderTicket();
      if(ContainsInt(openTicketsOnServer, ticket)) continue;

      PostOpenEvent(ticket, "reconcile");
      posted++;
   }
   if(posted > 0) Print("[ElistasJournal] Reconcile — posted ", posted, " open events the server was missing.");
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
//| Main poll loop — every PollMillis we diff open orders + history  |
//+------------------------------------------------------------------+
void OnTimer()
{
   DetectNewOpens();
   DetectModifications();
   DetectClosed();
   lastPollTime = TimeCurrent();
}

//+------------------------------------------------------------------+
//| Build the snapshot of currently-open tickets                     |
//+------------------------------------------------------------------+
void RebuildOpenSnapshot()
{
   ArrayResize(knownOpenTickets, 0);
   ArrayResize(knownOpenSL, 0);
   ArrayResize(knownOpenTP, 0);
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      AppendInt(knownOpenTickets, OrderTicket());
      AppendDouble(knownOpenSL, OrderStopLoss());
      AppendDouble(knownOpenTP, OrderTakeProfit());
   }
}

//+------------------------------------------------------------------+
//| Detect newly-opened orders (in open list but not in snapshot)    |
//+------------------------------------------------------------------+
void DetectNewOpens()
{
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      int ticket = OrderTicket();
      if(ContainsInt(knownOpenTickets, ticket)) continue;

      // New ticket — post an open event
      PostOpenEvent(ticket, "realtime");
      AppendInt(knownOpenTickets, ticket);
      AppendDouble(knownOpenSL, OrderStopLoss());
      AppendDouble(knownOpenTP, OrderTakeProfit());

      if(SendScreenshots) PostScreenshot(ticket, "entry");
   }
}

//+------------------------------------------------------------------+
//| Detect SL / TP modifications on currently-open orders            |
//|                                                                  |
//| For each known open ticket we compare the live SL / TP against   |
//| the values we remembered last poll. If they differ we POST a     |
//| modify event with BOTH old and new prices — the server logs the  |
//| change to TradeModification and backfills initialSlPrice on the  |
//| Trade row if it's still null.                                    |
//+------------------------------------------------------------------+
void DetectModifications()
{
   int len = ArraySize(knownOpenTickets);
   for(int i = 0; i < len; i++)
   {
      int ticket = knownOpenTickets[i];
      if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES)) continue;

      double curSL = OrderStopLoss();
      double curTP = OrderTakeProfit();
      double oldSL = knownOpenSL[i];
      double oldTP = knownOpenTP[i];

      // Tolerance covers float jitter — MT4 sometimes returns values that
      // diverge by 0.5 of a point even when nothing was actually changed.
      double tol = SymbolPipTolerance(OrderSymbol());
      bool slChanged = MathAbs(curSL - oldSL) > tol;
      bool tpChanged = MathAbs(curTP - oldTP) > tol;

      if(slChanged || tpChanged)
      {
         PostModifyEvent(ticket,
                         slChanged ? oldSL : -1.0, slChanged ? curSL : -1.0,
                         tpChanged ? oldTP : -1.0, tpChanged ? curTP : -1.0,
                         slChanged, tpChanged);
         if(slChanged) knownOpenSL[i] = curSL;
         if(tpChanged) knownOpenTP[i] = curTP;
      }
   }
}

// Half a pip — enough to absorb broker-side rounding without missing a real
// SL move. JPY / metals use their own pip scale.
double SymbolPipTolerance(string symbol)
{
   double pip = StringFind(symbol, "JPY") >= 0 ? 0.01
              : StringFind(symbol, "XAU") == 0 ? 0.1
              : StringFind(symbol, "XAG") == 0 ? 0.01
              : 0.0001;
   return(pip / 2.0);
}

//+------------------------------------------------------------------+
//| Detect closed orders (in snapshot but no longer open)            |
//+------------------------------------------------------------------+
void DetectClosed()
{
   int len = ArraySize(knownOpenTickets);
   for(int i = len - 1; i >= 0; i--)
   {
      int ticket = knownOpenTickets[i];
      if(IsTicketStillOpen(ticket)) continue;

      // Ticket is no longer open — find it in history and post the close event
      if(OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY))
      {
         PostCloseEvent(ticket, "realtime");
         if(SendScreenshots) PostScreenshot(ticket, "close");
      }
      RemoveAt(knownOpenTickets, i);
      RemoveAtDouble(knownOpenSL, i);
      RemoveAtDouble(knownOpenTP, i);
   }
}

bool IsTicketStillOpen(int ticket)
{
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderTicket() == ticket) return(true);
   }
   return(false);
}

//+------------------------------------------------------------------+
//| Sweep history on init — catch trades made while terminal was off |
//|                                                                  |
//| CatchupHistoryDays semantics:                                    |
//|   0       → sweep ALL history the broker exposes (default — full |
//|              first-run backfill so balance reconciles end-to-end)|
//|   N > 0   → sweep only trades closed within the last N days      |
//|                                                                  |
//| Safe to run repeatedly: /api/trades/mt4 upserts by               |
//| (accountId, ticket), so duplicate POSTs are no-ops.              |
//+------------------------------------------------------------------+
// Incremental catchup: posts only history rows whose ticket is strictly greater
// than `sinceTicket`. Returns the largest ticket seen (caller persists it as
// the watermark for the next run). When called with sinceTicket=0 this acts
// like a full sweep — which is what a fresh install or ForceFullResweep
// produces.
int SweepHistoryCatchupSince(int sinceTicket)
{
   bool   sweepAll = (CatchupHistoryDays <= 0);
   datetime cutoff = sweepAll ? 0 : (TimeCurrent() - CatchupHistoryDays * 86400);
   int    total    = OrdersHistoryTotal();
   int    posted   = 0;
   int    skipped  = 0;
   int    maxTicket = sinceTicket;

   Print("[ElistasJournal] Catchup sweep starting — ",
         (sinceTicket > 0 ? StringConcatenate("incremental from ticket #", sinceTicket, "+") : "full"),
         " · ", (sweepAll ? "ALL history" : StringConcatenate("last ", CatchupHistoryDays, "d")),
         " · ", total, " history rows");

   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) { skipped++; continue; }
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) { skipped++; continue; }
      if(!sweepAll && OrderCloseTime() < cutoff) { skipped++; continue; }

      int ticket = OrderTicket();
      // The whole point of incremental: stop replaying tickets we already POSTed.
      if(ticket <= sinceTicket) { skipped++; continue; }

      // Post both open and close events — API upserts by (accountId, ticket)
      // so even if this row sneaks through twice it's a no-op.
      PostOpenEvent(ticket, "catchup");
      PostCloseEvent(ticket, "catchup");
      posted++;
      if(ticket > maxTicket) maxTicket = ticket;

      // Progress log every 50 trades so a multi-year backfill doesn't look hung.
      if(posted % 50 == 0)
         Print("[ElistasJournal] Catchup progress: ", posted, " posted, ", (i + 1), "/", total, " scanned");

      // Tiny throttle on big backfills — keeps Vercel from rate-limiting and
      // lets the terminal stay responsive. Skip when small.
      if(posted > 50) Sleep(40);
   }
   Print("[ElistasJournal] Catchup done — ", posted, " posted, ", skipped, " skipped (pre-watermark, non-trades, or pre-cutoff). Max ticket now ", maxTicket);
   return(maxTicket);
}

//+------------------------------------------------------------------+
//| Post an "open" event for the currently-selected order            |
//+------------------------------------------------------------------+
void PostOpenEvent(int ticket, string source)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
      if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY))
         return;

   string symbol = OrderSymbol();
   double pipVal = MarketInfo(symbol, MODE_TICKVALUE);  // value of one tick on 1 lot in account ccy
   double tickSz = MarketInfo(symbol, MODE_TICKSIZE);
   // pipValuePerLot = value of one pip on 1 lot. tickValue is value per tick — multiply by pip/tick ratio.
   double pip = StringFind(symbol, "JPY") >= 0 ? 0.01 : 0.0001;
   double pipValuePerLot = (tickSz > 0) ? pipVal * (pip / tickSz) : pipVal;

   string body = StringConcatenate(
      "{",
      "\"event\":\"open\",",
      "\"ticket\":", IntegerToString(ticket), ",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      "\"symbol\":\"", symbol, "\",",
      "\"orderType\":", IntegerToString(OrderType()), ",",
      "\"lotSize\":", DoubleToString(OrderLots(), 2), ",",
      "\"entryPrice\":", DoubleToString(OrderOpenPrice(), 5), ",",
      "\"slPrice\":", DoubleToString(OrderStopLoss(), 5), ",",
      "\"tpPrice\":", DoubleToString(OrderTakeProfit(), 5), ",",
      "\"openTimeUtc\":\"", TimeToIsoUtc(OrderOpenTime()), "\",",
      "\"accountBalance\":", DoubleToString(AccountBalance(), 2), ",",
      "\"accountEquity\":", DoubleToString(AccountEquity(), 2), ",",
      "\"pipValuePerLot\":", DoubleToString(pipValuePerLot, 4), ",",
      "\"broker\":\"", accountBroker, "\",",
      "\"comment\":\"", OrderComment(), "\",",
      "\"source\":\"", source, "\"",
      "}"
   );
   PostJson("/api/trades/mt4", body);
}

//+------------------------------------------------------------------+
//| Post a "close" event for the currently-selected order            |
//+------------------------------------------------------------------+
void PostCloseEvent(int ticket, string source)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY)) return;

   string body = StringConcatenate(
      "{",
      "\"event\":\"close\",",
      "\"ticket\":", IntegerToString(ticket), ",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      "\"closePrice\":", DoubleToString(OrderClosePrice(), 5), ",",
      "\"closeTimeUtc\":\"", TimeToIsoUtc(OrderCloseTime()), "\",",
      "\"commission\":", DoubleToString(OrderCommission(), 2), ",",
      "\"swap\":", DoubleToString(OrderSwap(), 2), ",",
      "\"profitCcy\":", DoubleToString(OrderProfit(), 2), ",",
      "\"source\":\"", source, "\"",
      "}"
   );
   PostJson("/api/trades/mt4", body);
}

//+------------------------------------------------------------------+
//| Post a "modify" event with old + new SL/TP                       |
//|                                                                  |
//| Only the fields that actually changed are sent. `includeSL` /    |
//| `includeTP` flags say which side moved — the others are omitted  |
//| from the JSON entirely so the server can write a clean audit row |
//| and (when initialSlPrice is null) backfill from oldSL.           |
//+------------------------------------------------------------------+
void PostModifyEvent(int ticket,
                     double oldSL, double newSL,
                     double oldTP, double newTP,
                     bool includeSL, bool includeTP)
{
   string parts = "";
   if(includeSL)
   {
      parts = parts
            + "\"slPrice\":"    + DoubleToString(newSL, 5) + ","
            + "\"oldSlPrice\":" + DoubleToString(oldSL, 5) + ",";
   }
   if(includeTP)
   {
      parts = parts
            + "\"tpPrice\":"    + DoubleToString(newTP, 5) + ","
            + "\"oldTpPrice\":" + DoubleToString(oldTP, 5) + ",";
   }

   string body = StringConcatenate(
      "{",
      "\"event\":\"modify\",",
      "\"ticket\":", IntegerToString(ticket), ",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      parts,
      "\"source\":\"realtime\"",
      "}"
   );
   PostJson("/api/trades/mt4", body);
}

//+------------------------------------------------------------------+
//| Take a screenshot of the current chart and POST it               |
//+------------------------------------------------------------------+
void PostScreenshot(int ticket, string phase)
{
   string filename = StringConcatenate("elistas_", ticket, "_", phase, ".png");
   if(!WindowScreenShot(filename, ScreenshotW, ScreenshotH))
   {
      Print("[ElistasJournal] WindowScreenShot failed for ticket ", ticket);
      return;
   }

   // Build multipart/form-data body
   string boundary = "----ElistasMT4Boundary";
   int fh = FileOpen(filename, FILE_BIN|FILE_READ);
   if(fh == INVALID_HANDLE)
   {
      Print("[ElistasJournal] Cannot reopen screenshot file ", filename);
      return;
   }
   int fileSize = (int)FileSize(fh);
   uchar fileBytes[];
   ArrayResize(fileBytes, fileSize);
   FileReadArray(fh, fileBytes, 0, fileSize);
   FileClose(fh);

   string header = "--" + boundary + "\r\n"
                 + "Content-Disposition: form-data; name=\"ticket\"\r\n\r\n"
                 + IntegerToString(ticket) + "\r\n"
                 + "--" + boundary + "\r\n"
                 + "Content-Disposition: form-data; name=\"phase\"\r\n\r\n"
                 + phase + "\r\n"
                 + "--" + boundary + "\r\n"
                 + "Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n"
                 + "Content-Type: image/png\r\n\r\n";
   string footer = "\r\n--" + boundary + "--\r\n";

   uchar headerB[]; StringToCharArray(header, headerB, 0, StringLen(header), CP_UTF8);
   uchar footerB[]; StringToCharArray(footer, footerB, 0, StringLen(footer), CP_UTF8);

   uchar body[];
   int total = ArraySize(headerB) + ArraySize(fileBytes) + ArraySize(footerB);
   ArrayResize(body, total);
   int pos = 0;
   for(int i = 0; i < ArraySize(headerB); i++) body[pos++] = headerB[i];
   for(int i = 0; i < ArraySize(fileBytes); i++) body[pos++] = fileBytes[i];
   for(int i = 0; i < ArraySize(footerB); i++) body[pos++] = footerB[i];

   string url     = ApiBase + "/api/trades/mt4/screenshot";
   string headers = "Authorization: Bearer " + ApiKey + "\r\n"
                  + "Content-Type: multipart/form-data; boundary=" + boundary + "\r\n";
   char  result[]; string resultHeaders;
   int code = WebRequest("POST", url, headers, 8000, body, result, resultHeaders);
   if(VerboseLog) Print("[ElistasJournal] screenshot POST ticket=", ticket, " phase=", phase, " code=", code);
}

//+------------------------------------------------------------------+
//| POST a JSON body to the dashboard                                |
//+------------------------------------------------------------------+
void PostJson(string path, string jsonBody)
{
   string url     = ApiBase + path;
   string headers = "Authorization: Bearer " + ApiKey + "\r\n"
                  + "Content-Type: application/json\r\n";
   uchar  bodyB[]; StringToCharArray(jsonBody, bodyB, 0, StringLen(jsonBody), CP_UTF8);
   char   result[]; string resultHeaders;

   ResetLastError();
   int code = WebRequest("POST", url, headers, 5000, bodyB, result, resultHeaders);
   if(code == -1)
   {
      Print("[ElistasJournal] WebRequest error ", GetLastError(),
            " — add '", ApiBase, "' to Allowed URLs in Options.");
   }
   else if(VerboseLog)
   {
      Print("[ElistasJournal] ", path, " status=", code, " body=", jsonBody);
   }
}

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
string TimeToIsoUtc(datetime t)
{
   datetime utc = t - (TimeLocal() - TimeGMT());  // approximate: server time → UTC
   return(TimeToString(utc, TIME_DATE|TIME_SECONDS) + "Z");
}

void AppendInt(int &arr[], int v)
{
   int n = ArraySize(arr);
   ArrayResize(arr, n + 1);
   arr[n] = v;
}

bool ContainsInt(const int &arr[], int v)
{
   for(int i = 0; i < ArraySize(arr); i++) if(arr[i] == v) return(true);
   return(false);
}

void RemoveAt(int &arr[], int idx)
{
   int n = ArraySize(arr);
   for(int i = idx; i < n - 1; i++) arr[i] = arr[i + 1];
   ArrayResize(arr, n - 1);
}

void AppendDouble(double &arr[], double v)
{
   int n = ArraySize(arr);
   ArrayResize(arr, n + 1);
   arr[n] = v;
}

void RemoveAtDouble(double &arr[], int idx)
{
   int n = ArraySize(arr);
   for(int i = idx; i < n - 1; i++) arr[i] = arr[i + 1];
   ArrayResize(arr, n - 1);
}
