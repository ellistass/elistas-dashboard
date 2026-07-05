//+------------------------------------------------------------------+
//|                                              ElistasJournal.mq4 |
//|                              Auto-log MT4 trades to the dashboard|
//|                                                          v2.00  |
//|  WHY v2                                                          |
//|  ------                                                          |
//|  v1 hung the terminal: OnInit swept the whole account history    |
//|  with TWO blocking WebRequests per trade (thousands of calls on  |
//|  first run), screenshots posted synchronously mid-detection, and |
//|  every event was its own HTTP round-trip.                        |
//|                                                                  |
//|  v2 never does bulk HTTP work inline:                            |
//|  • ALL events (opens / closes / modifies / balance / catchup)    |
//|    are appended to an in-memory QUEUE as JSON fragments.         |
//|  • Each timer tick sends AT MOST ONE batched POST                |
//|    ({"events":[...]}, up to BatchSize per request — the API      |
//|    already accepts batches) and at most one screenshot upload.   |
//|  • OnInit does exactly one HTTP call (the /state fetch). The     |
//|    history catchup only ENQUEUES — a 2,000-trade backfill        |
//|    drains in ~80 requests spread across ticks instead of 4,000   |
//|    blocking calls up front.                                      |
//|  • Failed posts re-queue with exponential-ish backoff, so a      |
//|    Vercel hiccup can't stall the chart.                          |
//|  • One pass over OrdersTotal() per tick detects opens+closes     |
//|    together (v1 rescanned the open list per known ticket, O(n²)).|
//|                                                                  |
//|  NEW in v2                                                       |
//|  ---------                                                       |
//|  • Close events carry accountBalance/accountEquity → dashboard   |
//|    balance updates the moment a trade settles.                   |
//|  • Periodic "balance" heartbeat keeps equity live between trades.|
//|                                                                  |
//|  SETUP (unchanged)                                               |
//|  -----                                                           |
//|  • Tools → Options → Expert Advisors → Allow WebRequest for:     |
//|      https://elistas-dashboard.vercel.app                        |
//|  • Drag onto any chart, set ApiKey. Watches the whole account.   |
//+------------------------------------------------------------------+
#property strict
#property copyright "Elistas"
#property version   "2.00"

//--- Inputs
input string  ApiBase            = "https://elistas-dashboard.vercel.app";
input string  ApiKey             = "REPLACE_WITH_ACCOUNT_API_KEY";  // per-account bearer token
input bool    SendScreenshots    = true;    // capture chart on open/close
input int     ScreenshotW        = 1024;
input int     ScreenshotH        = 576;
input int     CatchupHistoryDays = 0;       // 0 = ALL history the broker exposes
input bool    ForceFullResweep   = false;   // true once to re-enqueue everything
input int     PollMillis         = 2000;    // tick frequency
input int     BatchSize          = 25;      // max events per POST
input int     BalanceHeartbeatSec = 300;    // push balance/equity every N seconds (0 = off)
input bool    VerboseLog         = false;

//--- Open-position snapshot (parallel arrays)
int      knownOpenTickets[];
double   knownOpenSL[];
double   knownOpenTP[];

//--- Event queue — each entry is one complete event JSON object (no brackets)
string   eventQueue[];

//--- Screenshot queue (parallel arrays)
int      shotTickets[];
string   shotPhases[];

//--- Backoff after failed posts: skip this many ticks before retrying
int      backoffTicks   = 0;
int      failStreak     = 0;

datetime lastBalancePost = 0;
double   lastPostedEquity = -1;
string   accountBroker   = "";

//+------------------------------------------------------------------+
//| Init — ONE http call (state fetch), everything else enqueued     |
//+------------------------------------------------------------------+
int OnInit()
{
   accountBroker = AccountCompany();
   Print("[ElistasJournal v2] Starting for MT4 account ", AccountNumber(), " (", accountBroker, ")");

   RebuildOpenSnapshot();

   string cacheKey = "ElistasJournal_LastSeenTicket_" + IntegerToString(AccountNumber());
   if(ForceFullResweep && GlobalVariableCheck(cacheKey))
   {
      GlobalVariableDel(cacheKey);
      Print("[ElistasJournal] ForceFullResweep=true — local watermark cleared.");
   }

   // Server is authoritative for "what do you already have" — see /state route.
   int serverHighest = -1;
   int openServer[];  ArrayResize(openServer, 0);
   string syncMode = "full";
   bool serverOk = FetchServerState(serverHighest, openServer, syncMode);

   if(syncMode == "off")
   {
      Print("[ElistasJournal] syncMode=off — EA paused for this account. Flip the dashboard toggle and reload the chart to re-enable.");
      return(INIT_SUCCEEDED);   // no timer → fully dormant
   }

   int sinceTicket;
   if(serverOk)
   {
      sinceTicket = ForceFullResweep ? 0 : serverHighest;
      GlobalVariableSet(cacheKey, (double)serverHighest);
      Print("[ElistasJournal] Server state: syncMode=", syncMode,
            " highestTicket=", serverHighest, " openCount=", ArraySize(openServer));
   }
   else if(GlobalVariableCheck(cacheKey))
   {
      sinceTicket = (int)GlobalVariableGet(cacheKey);
      Print("[ElistasJournal] Server fetch failed — cached watermark #", sinceTicket);
   }
   else
   {
      sinceTicket = 0;
      Print("[ElistasJournal] Server fetch failed AND no cache — will enqueue everything.");
   }

   // Catchup: ENQUEUE ONLY. No HTTP here — the timer drains the queue in
   // batches. This is the fix for the v1 init hang.
   if(syncMode == "full")
   {
      int newMax = EnqueueHistoryCatchupSince(sinceTicket);
      if(newMax > sinceTicket) GlobalVariableSet(cacheKey, (double)newMax);
   }
   else
      Print("[ElistasJournal] syncMode=realtime-only — history catchup skipped.");

   // Positions open in MT4 that the server doesn't know about → enqueue opens.
   if(serverOk) ReconcileOpensAgainstServer(openServer);

   // First balance heartbeat so the dashboard shows live equity immediately.
   EnqueueBalanceEvent();

   EventSetMillisecondTimer(PollMillis);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { EventKillTimer(); }

//+------------------------------------------------------------------+
//| Timer tick: detect (cheap, no HTTP) → flush (bounded HTTP)       |
//+------------------------------------------------------------------+
void OnTimer()
{
   DetectOpensAndCloses();   // single pass over OrdersTotal()
   DetectModifications();
   MaybeEnqueueBalance();

   // Bounded network work per tick: one event batch + one screenshot, max.
   if(backoffTicks > 0) { backoffTicks--; return; }
   FlushEventQueue();
   FlushOneScreenshot();
}

//+------------------------------------------------------------------+
//| Detection — one pass builds current opens, diffs both directions |
//+------------------------------------------------------------------+
void DetectOpensAndCloses()
{
   // Snapshot current open market orders
   int curTickets[]; double curSL[]; double curTP[];
   ArrayResize(curTickets, 0); ArrayResize(curSL, 0); ArrayResize(curTP, 0);
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      AppendInt(curTickets, OrderTicket());
      AppendDouble(curSL, OrderStopLoss());
      AppendDouble(curTP, OrderTakeProfit());
   }

   // New opens: in current, not in known
   for(int c = 0; c < ArraySize(curTickets); c++)
   {
      int t = curTickets[c];
      if(ContainsInt(knownOpenTickets, t)) continue;
      EnqueueOpenEvent(t, "realtime");
      AppendInt(knownOpenTickets, t);
      AppendDouble(knownOpenSL, curSL[c]);
      AppendDouble(knownOpenTP, curTP[c]);
      if(SendScreenshots) EnqueueScreenshot(t, "entry");
   }

   // Closes: in known, not in current
   for(int k = ArraySize(knownOpenTickets) - 1; k >= 0; k--)
   {
      int t = knownOpenTickets[k];
      if(ContainsInt(curTickets, t)) continue;
      if(OrderSelect(t, SELECT_BY_TICKET, MODE_HISTORY))
      {
         EnqueueCloseEvent(t, "realtime");
         if(SendScreenshots) EnqueueScreenshot(t, "close");
      }
      RemoveAt(knownOpenTickets, k);
      RemoveAtDouble(knownOpenSL, k);
      RemoveAtDouble(knownOpenTP, k);
   }
}

//+------------------------------------------------------------------+
//| SL/TP modify detection — unchanged logic, enqueue instead of post|
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

      double tol = SymbolPipTolerance(OrderSymbol());
      bool slChanged = MathAbs(curSL - oldSL) > tol;
      bool tpChanged = MathAbs(curTP - oldTP) > tol;

      if(slChanged || tpChanged)
      {
         EnqueueModifyEvent(ticket,
                            slChanged ? oldSL : -1.0, slChanged ? curSL : -1.0,
                            tpChanged ? oldTP : -1.0, tpChanged ? curTP : -1.0,
                            slChanged, tpChanged);
         if(slChanged) knownOpenSL[i] = curSL;
         if(tpChanged) knownOpenTP[i] = curTP;
      }
   }
}

double SymbolPipTolerance(string symbol)
{
   double pip = StringFind(symbol, "JPY") >= 0 ? 0.01
              : StringFind(symbol, "XAU") == 0 ? 0.1
              : StringFind(symbol, "XAG") == 0 ? 0.01
              : 0.0001;
   return(pip / 2.0);
}

//+------------------------------------------------------------------+
//| Balance heartbeat — keeps dashboard equity live between trades   |
//+------------------------------------------------------------------+
void MaybeEnqueueBalance()
{
   if(BalanceHeartbeatSec <= 0) return;
   if(TimeCurrent() - lastBalancePost < BalanceHeartbeatSec) return;
   // Skip if equity hasn't moved a cent — no point posting noise.
   if(MathAbs(AccountEquity() - lastPostedEquity) < 0.01 && lastPostedEquity >= 0)
   {
      lastBalancePost = TimeCurrent();   // still reset the clock
      return;
   }
   EnqueueBalanceEvent();
}

void EnqueueBalanceEvent()
{
   string ev = StringConcatenate(
      "{\"event\":\"balance\",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      "\"accountBalance\":", DoubleToString(AccountBalance(), 2), ",",
      "\"accountEquity\":", DoubleToString(AccountEquity(), 2),
      "}");
   Enqueue(ev);
   lastBalancePost   = TimeCurrent();
   lastPostedEquity  = AccountEquity();
}

//+------------------------------------------------------------------+
//| History catchup — ENQUEUE ONLY, zero HTTP                        |
//+------------------------------------------------------------------+
int EnqueueHistoryCatchupSince(int sinceTicket)
{
   bool     sweepAll = (CatchupHistoryDays <= 0);
   datetime cutoff   = sweepAll ? 0 : (TimeCurrent() - CatchupHistoryDays * 86400);
   int      total    = OrdersHistoryTotal();
   int      queued   = 0;
   int      maxTicket = sinceTicket;

   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      if(!sweepAll && OrderCloseTime() < cutoff) continue;
      int ticket = OrderTicket();
      if(ticket <= sinceTicket) continue;

      EnqueueOpenEvent(ticket, "catchup");
      EnqueueCloseEvent(ticket, "catchup");
      queued++;
      if(ticket > maxTicket) maxTicket = ticket;
   }
   if(queued > 0)
      Print("[ElistasJournal] Catchup: ", queued, " trades queued (",
            queued * 2, " events) — draining ~", BatchSize, "/request in the background.");
   return(maxTicket);
}

void ReconcileOpensAgainstServer(const int &openTicketsOnServer[])
{
   int queued = 0;
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      int ticket = OrderTicket();
      if(ContainsInt(openTicketsOnServer, ticket)) continue;
      EnqueueOpenEvent(ticket, "reconcile");
      queued++;
   }
   if(queued > 0) Print("[ElistasJournal] Reconcile — queued ", queued, " open events the server was missing.");
}

//+------------------------------------------------------------------+
//| Event builders — JSON fragments pushed onto the queue            |
//+------------------------------------------------------------------+
void EnqueueOpenEvent(int ticket, string source)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
      if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY))
         return;

   string symbol = OrderSymbol();
   double pipVal = MarketInfo(symbol, MODE_TICKVALUE);
   double tickSz = MarketInfo(symbol, MODE_TICKSIZE);
   double pip    = StringFind(symbol, "JPY") >= 0 ? 0.01 : 0.0001;
   double pipValuePerLot = (tickSz > 0) ? pipVal * (pip / tickSz) : pipVal;

   string ev = StringConcatenate(
      "{\"event\":\"open\",",
      "\"ticket\":", IntegerToString(ticket), ",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      "\"symbol\":\"", JsonEscape(symbol), "\",",
      "\"orderType\":", IntegerToString(OrderType()), ",",
      "\"lotSize\":", DoubleToString(OrderLots(), 2), ",",
      "\"entryPrice\":", DoubleToString(OrderOpenPrice(), 5), ",",
      "\"slPrice\":", DoubleToString(OrderStopLoss(), 5), ",",
      "\"tpPrice\":", DoubleToString(OrderTakeProfit(), 5), ",",
      "\"openTimeUtc\":\"", TimeToIsoUtc(OrderOpenTime()), "\",",
      "\"accountBalance\":", DoubleToString(AccountBalance(), 2), ",",
      "\"accountEquity\":", DoubleToString(AccountEquity(), 2), ",",
      "\"pipValuePerLot\":", DoubleToString(pipValuePerLot, 4), ",",
      "\"broker\":\"", JsonEscape(accountBroker), "\",",
      "\"comment\":\"", JsonEscape(OrderComment()), "\",",
      "\"source\":\"", source, "\"",
      "}");
   Enqueue(ev);
}

void EnqueueCloseEvent(int ticket, string source)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY)) return;

   string ev = StringConcatenate(
      "{\"event\":\"close\",",
      "\"ticket\":", IntegerToString(ticket), ",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      "\"closePrice\":", DoubleToString(OrderClosePrice(), 5), ",",
      "\"closeTimeUtc\":\"", TimeToIsoUtc(OrderCloseTime()), "\",",
      "\"commission\":", DoubleToString(OrderCommission(), 2), ",",
      "\"swap\":", DoubleToString(OrderSwap(), 2), ",",
      "\"profitCcy\":", DoubleToString(OrderProfit(), 2), ",",
      "\"accountBalance\":", DoubleToString(AccountBalance(), 2), ",",
      "\"accountEquity\":", DoubleToString(AccountEquity(), 2), ",",
      "\"source\":\"", source, "\"",
      "}");
   Enqueue(ev);
}

void EnqueueModifyEvent(int ticket,
                        double oldSL, double newSL,
                        double oldTP, double newTP,
                        bool includeSL, bool includeTP)
{
   string parts = "";
   if(includeSL)
      parts = parts + "\"slPrice\":" + DoubleToString(newSL, 5) + ","
                    + "\"oldSlPrice\":" + DoubleToString(oldSL, 5) + ",";
   if(includeTP)
      parts = parts + "\"tpPrice\":" + DoubleToString(newTP, 5) + ","
                    + "\"oldTpPrice\":" + DoubleToString(oldTP, 5) + ",";

   string ev = StringConcatenate(
      "{\"event\":\"modify\",",
      "\"ticket\":", IntegerToString(ticket), ",",
      "\"accountNumber\":", IntegerToString(AccountNumber()), ",",
      parts,
      "\"source\":\"realtime\"",
      "}");
   Enqueue(ev);
}

//+------------------------------------------------------------------+
//| Queue plumbing                                                   |
//+------------------------------------------------------------------+
void Enqueue(string ev)
{
   int n = ArraySize(eventQueue);
   ArrayResize(eventQueue, n + 1);
   eventQueue[n] = ev;
}

// Send at most ONE batched POST per tick. On failure the batch goes back to
// the FRONT of the queue (order preserved — opens must land before closes)
// and we back off: 2, 4, 8 … up to 30 ticks.
void FlushEventQueue()
{
   int n = ArraySize(eventQueue);
   if(n == 0) { failStreak = 0; return; }

   int count = (int)MathMin(n, BatchSize);
   string body = "{\"events\":[";
   for(int i = 0; i < count; i++)
   {
      if(i > 0) body = body + ",";
      body = body + eventQueue[i];
   }
   body = body + "]}";

   int code = PostJson("/api/trades/mt4", body);
   if(code == 200)
   {
      // Drop the sent events off the front
      for(int j = 0; j < n - count; j++) eventQueue[j] = eventQueue[j + count];
      ArrayResize(eventQueue, n - count);
      failStreak = 0;
      if(VerboseLog || n - count > 0)
         Print("[ElistasJournal] Flushed ", count, " events, ", (n - count), " still queued.");
   }
   else
   {
      failStreak++;
      backoffTicks = (int)MathMin(30, MathPow(2, failStreak));
      Print("[ElistasJournal] Batch POST failed (code=", code, ") — retrying in ", backoffTicks, " ticks. Queue=", n);
   }
}

//+------------------------------------------------------------------+
//| Screenshot queue — capture is cheap, upload is heavy: one/tick,  |
//| and only when the event queue is fully drained (data first).     |
//+------------------------------------------------------------------+
void EnqueueScreenshot(int ticket, string phase)
{
   int n = ArraySize(shotTickets);
   ArrayResize(shotTickets, n + 1);
   ArrayResize(shotPhases, n + 1);
   shotTickets[n] = ticket;
   shotPhases[n]  = phase;
}

void FlushOneScreenshot()
{
   if(ArraySize(shotTickets) == 0) return;
   if(ArraySize(eventQueue) > 0) return;   // trade data takes priority

   int    ticket = shotTickets[0];
   string phase  = shotPhases[0];
   RemoveAt(shotTickets, 0);
   RemoveAtString(shotPhases, 0);

   PostScreenshot(ticket, phase);   // one blocking upload max per tick
}

void PostScreenshot(int ticket, string phase)
{
   string filename = StringConcatenate("elistas_", ticket, "_", phase, ".png");
   if(!WindowScreenShot(filename, ScreenshotW, ScreenshotH))
   {
      Print("[ElistasJournal] WindowScreenShot failed for ticket ", ticket);
      return;
   }

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
   FileDelete(filename);   // don't let screenshots pile up on disk

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
//| HTTP + server-state helpers                                      |
//+------------------------------------------------------------------+
int PostJson(string path, string jsonBody)
{
   string url     = ApiBase + path;
   string headers = "Authorization: Bearer " + ApiKey + "\r\n"
                  + "Content-Type: application/json\r\n";
   uchar  bodyB[]; StringToCharArray(jsonBody, bodyB, 0, StringLen(jsonBody), CP_UTF8);
   char   result[]; string resultHeaders;

   ResetLastError();
   int code = WebRequest("POST", url, headers, 5000, bodyB, result, resultHeaders);
   if(code == -1)
      Print("[ElistasJournal] WebRequest error ", GetLastError(),
            " — add '", ApiBase, "' to Allowed URLs in Options.");
   else if(VerboseLog)
      Print("[ElistasJournal] ", path, " status=", code);
   return(code);
}

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
   highestTicket = ParseJsonInt(body, "highestTicket");
   syncMode = ParseJsonString(body, "syncMode");
   if(StringLen(syncMode) == 0) syncMode = "full";

   ArrayResize(openTickets, 0);
   int arrStart = StringFind(body, "\"openTickets\"");
   if(arrStart >= 0)
   {
      int lb = StringFind(body, "[", arrStart);
      int rb = (lb >= 0) ? StringFind(body, "]", lb) : -1;
      if(lb >= 0 && rb > lb)
      {
         string inside = StringSubstr(body, lb + 1, rb - lb - 1);
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
         break;
   }
   if(StringLen(num) == 0) return(0);
   return((int)StringToInteger(num));
}

//+------------------------------------------------------------------+
//| Misc helpers                                                     |
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

// Escape quotes/backslashes/control chars so broker comments can't break the JSON.
string JsonEscape(string s)
{
   string out = "";
   int len = StringLen(s);
   for(int i = 0; i < len; i++)
   {
      ushort c = StringGetCharacter(s, i);
      if(c == '"' || c == '\\') out = out + "\\" + ShortToString(c);
      else if(c < 32) out = out + " ";
      else out = out + ShortToString(c);
   }
   return(out);
}

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

void RemoveAtString(string &arr[], int idx)
{
   int n = ArraySize(arr);
   for(int i = idx; i < n - 1; i++) arr[i] = arr[i + 1];
   ArrayResize(arr, n - 1);
}
