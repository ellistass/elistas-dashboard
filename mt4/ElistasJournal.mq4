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
input int     PollMillis    = 2000;                          // diff frequency
input bool    VerboseLog    = false;

//--- Internal state — known open tickets, and the most recent history ticket we've processed
int      knownOpenTickets[];
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

   // Catch up on any history the dashboard might be missing
   SweepHistoryCatchup();

   EventSetMillisecondTimer(PollMillis);
   return(INIT_SUCCEEDED);
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
   DetectClosed();
   lastPollTime = TimeCurrent();
}

//+------------------------------------------------------------------+
//| Build the snapshot of currently-open tickets                     |
//+------------------------------------------------------------------+
void RebuildOpenSnapshot()
{
   ArrayResize(knownOpenTickets, 0);
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      AppendInt(knownOpenTickets, OrderTicket());
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

      if(SendScreenshots) PostScreenshot(ticket, "entry");
   }
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
void SweepHistoryCatchup()
{
   bool   sweepAll = (CatchupHistoryDays <= 0);
   datetime cutoff = sweepAll ? 0 : (TimeCurrent() - CatchupHistoryDays * 86400);
   int    total    = OrdersHistoryTotal();
   int    posted   = 0;
   int    skipped  = 0;

   Print("[ElistasJournal] Catchup sweep starting — ",
         (sweepAll ? "ALL history" : StringConcatenate("last ", CatchupHistoryDays, "d")),
         " · ", total, " history rows");

   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) { skipped++; continue; }
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) { skipped++; continue; }
      if(!sweepAll && OrderCloseTime() < cutoff) { skipped++; continue; }

      // Post both open and close events — API upserts by ticket so it's safe
      PostOpenEvent(OrderTicket(), "catchup");
      PostCloseEvent(OrderTicket(), "catchup");
      posted++;

      // Progress log every 50 trades so a multi-year backfill doesn't look hung.
      if(posted % 50 == 0)
         Print("[ElistasJournal] Catchup progress: ", posted, " posted, ", (i + 1), "/", total, " scanned");

      // Tiny throttle on big backfills — keeps Vercel from rate-limiting and
      // lets the terminal stay responsive. Skip when small.
      if(sweepAll && posted > 50) Sleep(40);
   }
   Print("[ElistasJournal] Catchup done — ", posted, " posted, ", skipped, " skipped (non-trades or pre-cutoff)");
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
