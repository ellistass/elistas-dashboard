"use strict";exports.id=334,exports.ids=[334],exports.modules={247:(e,r,t)=>{t.d(r,{S:()=>n,e:()=>i});let a=`You are the RFDM (Relative Flow Divergence Model) scoring engine for a forex trader based in Lagos, Nigeria (WAT = GMT+1).

Your job: analyse the raw market data provided and score 10 currencies, then build a 9-pair trading matrix.

## CURRENCIES TO SCORE
USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, NOK, SEK

## SCORING RULES (apply these EXACTLY)

### 1. Fundamentals Pillar (weight: 1.5\xd7)
- For every economic release in the calendar:
  - Identify which currency it belongs to
  - Compare actual vs forecast (or actual vs previous if no forecast)
  - BEAT (actual better than expected): +1.5 to that currency
  - MISS (actual worse than expected): −1.5 to that currency
  - HIGH impact events: multiply by 1.5 (so +2.25 / −2.25)
  - "Better" means: for growth/employment/spending → higher is better; for unemployment/jobless claims → lower is better

### 2. Price Performance Pillar (weight: 1.5\xd7)
- From the forex performance table (% change per pair today):
  - If a pair like EUR/USD is UP: EUR gets +1.0, USD gets −0.5
  - If a pair like EUR/USD is DOWN: EUR gets −1.0, USD gets +0.5
  - Apply for every pair the currency appears in
  - Scale: per 0.1% move = \xb10.5 contribution (cap at \xb13.0 per currency)

### 3. Standard Deviation / Price Surprises Pillar (weight: 0.8\xd7)
- From std dev / price surprise data:
  - Std dev > 0 for a pair: +0.8 to the base currency (unusually strong)
  - Std dev < 0 for a pair: −0.8 to the base currency (unusually weak)
  - This measures how unusual today's move is vs 20-day history

### 4. Futures Pillar (weight: 0.5\xd7) — only if futures data provided
  - Futures UP: +0.5 to that currency
  - Futures DOWN: −0.5 to that currency

### Final score = sum of all pillar contributions

## RANKING
- Sort all currencies by score descending
- Top 3 = strongest currencies
- Bottom 3 = weakest currencies

## 9-PAIR MATRIX
- Cross every Top 3 currency with every Bottom 3 currency
- For each crossing, find the real forex pair (e.g. if GBP is strong and NZD is weak → GBP/NZD Long)
- Divergence = |strongScore − weakScore|

## SETUP GRADES
- A+ = divergence ≥ 8.0 → full risk
- B = divergence ≥ 5.0 → half risk
- C = divergence ≥ 2.5 → watch only
- Skip = divergence < 2.5

## DIVERGENCE WARNINGS (critical — detect these)
- If a currency has POSITIVE fundamentals (data beat) but NEGATIVE price performance → "Smart money distributing — do NOT trade in the direction of fundamentals"
- Flag these explicitly in divergenceWarnings array

## SESSION WINDOWS (for session field)
- Tokyo: 1am–7am WAT → AUD/JPY, NZD/JPY pairs
- London: 8am–11am WAT → GBP, EUR pairs (prime window)
- Pre-NY: 1pm–2pm WAT → watch H4 pools
- New York: 3pm–6pm WAT → USD pairs (prime window)

## KNOWN FOREX PAIRS (use these exact formats)
USD/JPY, EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/CAD, USD/CHF,
EUR/GBP, EUR/JPY, GBP/JPY, AUD/JPY, NZD/JPY, EUR/AUD, GBP/AUD,
EUR/CAD, GBP/CHF, CAD/JPY, CHF/JPY, GBP/NZD, EUR/NZD, AUD/NZD,
AUD/CAD, NZD/CAD, NZD/CHF, AUD/CHF, CAD/CHF, USD/NOK, EUR/NOK,
USD/SEK, EUR/SEK

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no explanation, no code fences). Use this exact structure:
{
  "scores": [
    {
      "currency": "GBP",
      "total": 5.5,
      "fundamental": 3.0,
      "price": 1.5,
      "stddev": 1.0,
      "notes": ["Retail Sales +0.7% vs 0.0% — massive beat"],
      "tag": "Retail Sales massive beat"
    }
  ],
  "top3": ["GBP", "JPY", "EUR"],
  "bottom3": ["NZD", "CAD", "USD"],
  "pairs9": [
    {
      "pair": "GBP/NZD",
      "direction": "Long",
      "strong": "GBP",
      "weak": "NZD",
      "strongScore": 5.5,
      "weakScore": -3.0,
      "divergence": 8.5,
      "grade": "A+",
      "session": ["London", "New York"],
      "reason": "GBP retail massive beat vs NZD credit card miss"
    }
  ],
  "priority1": {
    "pair": "GBP/NZD",
    "direction": "Long",
    "divergence": 8.5,
    "grade": "A+",
    "reason": "GBP retail massive beat vs NZD double miss"
  },
  "divergenceWarnings": [],
  "date": "2026-04-24"
}

IMPORTANT: Include ALL 10 currencies in the scores array (even if score is 0). Sort scores by total descending. Every currency must appear.`,o=[process.env.ANTHROPIC_MODEL,"claude-sonnet-4-20250514","claude-3-7-sonnet-latest","claude-3-5-haiku-20241022"].filter(e=>!!e);async function n(e){let r;let t=process.env.ANTHROPIC_API_KEY;if(!t)throw Error("ANTHROPIC_API_KEY not set");let n="";if("auto"===e.mode){if(e.perfMap&&Object.keys(e.perfMap).length>0){for(let[r,t]of(n+=`## FOREX PERFORMANCE (auto-fetched from Barchart)
Average % change per currency today:
`,Object.entries(e.perfMap).sort((e,r)=>r[1]-e[1])))n+=`${r}: ${t>0?"+":""}${t.toFixed(4)}%
`;n+="\n"}if(e.calendarEvents&&e.calendarEvents.length>0){for(let r of(n+=`## ECONOMIC CALENDAR (auto-fetched from ForexFactory)
`,e.calendarEvents)){let e=r.actual?`Actual: ${r.actual} | Forecast: ${r.forecast||"n/a"} | Previous: ${r.previous||"n/a"}`:`Not yet released | Forecast: ${r.forecast||"n/a"}`;n+=`[${r.country}] [${r.impact}] ${r.title} — ${e}
`}n+="\n"}}if(("manual"===e.mode||""===n.trim())&&(e.calendar&&(n+=`## ECONOMIC CALENDAR (pasted)
${e.calendar}

`),e.perf&&(n+=`## FOREX PERFORMANCE TABLE (pasted)
${e.perf}

`),e.stddev&&(n+=`## STANDARD DEVIATION / PRICE SURPRISES (pasted)
${e.stddev}

`),e.futures&&(n+=`## FUTURES PERFORMANCE (pasted)
${e.futures}

`)),!n.trim())throw Error("No market data provided — either paste data manually or wait for auto-fetch");n+=`
Today's date: ${new Date().toISOString().split("T")[0]}
Current time (WAT): ${new Date().toLocaleTimeString("en-GB",{timeZone:"Africa/Lagos",hour:"2-digit",minute:"2-digit"})}

Score all 10 currencies using the RFDM rules and return the JSON.`;let i=null,s="";for(let e of o){let r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":t,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:e,max_tokens:4096,system:a,messages:[{role:"user",content:n}]})});if(r.ok){i=await r.json();break}let o=await r.text();if(s=`Claude API error ${r.status}: ${o}`,!(404===r.status&&o.includes('"type":"not_found_error"')&&o.includes('"message":"model:')))throw Error(s)}if(!i)throw Error(s||"Claude API error: no supported model available");let c=i.content?.[0]?.text||"",l=c.trim();l.startsWith("```")&&(l=l.replace(/^```(?:json)?\n?/,"").replace(/\n?```$/,""));try{r=JSON.parse(l)}catch(e){throw console.error("Claude returned invalid JSON:",c.substring(0,500)),Error("Claude returned invalid JSON — scoring failed")}return function(e){let r=e.scores.map(e=>({cur:e.currency,score:e.total,fundamental:e.fundamental,pricePerf:e.price,stdDev:e.stddev,tag:e.tag,notes:e.notes})).sort((e,r)=>r.score-e.score),t=r.filter(r=>e.top3.includes(r.cur)).slice(0,3),a=r.filter(r=>e.bottom3.includes(r.cur)).slice(0,3);for(;t.length<3&&r.length>t.length;){let e=r.find(e=>!t.some(r=>r.cur===e.cur)&&!a.some(r=>r.cur===e.cur));if(e)t.push(e);else break}for(;a.length<3&&r.length>a.length;){let e=[...r].reverse().find(e=>!t.some(r=>r.cur===e.cur)&&!a.some(r=>r.cur===e.cur));if(e)a.push(e);else break}let o=e.pairs9[0]||{pair:e.priority1?.pair||"N/A",direction:e.priority1?.direction||"Long",strong:e.top3[0]||"",weak:e.bottom3[0]||"",strongScore:t[0]?.score||0,weakScore:a[0]?.score||0,divergence:e.priority1?.divergence||0,grade:e.priority1?.grade||"C",session:["London","New York"],reason:e.priority1?.reason||""};return{top3:t,bottom3:a,pairs9:e.pairs9,priority1:o,allScores:r,divergenceWarnings:e.divergenceWarnings||[],generatedAt:new Date}}(r)}function i(e,r){let{top3:t,bottom3:a,priority1:o,pairs9:n,divergenceWarnings:i}=e,s=new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}),c=t.map((e,r)=>`${r+1}. ${e.cur} ${e.score>0?"+":""}${e.score.toFixed(1)} — ${e.tag}`).join("\n"),l=a.map((e,r)=>`${r+1}. ${e.cur} ${e.score>0?"+":""}${e.score.toFixed(1)} — ${e.tag}`).join("\n"),u=n.filter(e=>"A+"===e.grade).map(e=>`${e.pair} ${e.direction}`).join(", "),d=n.filter(e=>"B"===e.grade).map(e=>`${e.pair} ${e.direction}`).join(", "),p=`🎯 *RFDM Alert — ${r} Session*
📅 ${s}
🤖 Scored by Claude AI

`;return p+=`*Strongest (Top 3)*
${c}

*Weakest (Bottom 3)*
${l}

`,o&&(p+=`*Priority Setup*
📊 ${o.pair} ${o.direction} — Divergence: ${o.divergence.toFixed(1)} (${o.grade})
${o.reason}

`),(u||d)&&(p+=`*Graded Setups*
`,u&&(p+=`✅ A+: ${u}
`),d&&(p+=`⚡ B: ${d}
`),p+="\n"),i.length>0&&(p+=`*⚠️ Divergence Warnings*
${i.map(e=>`→ ${e}`).join("\n")}

`),p+=`*Reminder*
→ Wait for H1 candle to fully close
→ Declare Model A or B before entry
→ Minimum R:R 1:2
→ No entries 30min after session open`}},464:(e,r,t)=>{t.d(r,{db:()=>o});var a=t(3524);let o=globalThis.prisma||new a.PrismaClient},6927:(e,r,t)=>{t.d(r,{md:()=>l});let a=["EUR/USD","GBP/USD","AUD/USD","NZD/USD","USD/JPY"],o=null;async function n(e,r,t){let a=new URLSearchParams({function:"FX_DAILY",from_symbol:e,to_symbol:r,outputsize:"compact",apikey:t}),o=await fetch(`https://www.alphavantage.co/query?${a}`,{headers:{Accept:"application/json"},cache:"no-store"});if(!o.ok)throw Error(`Alpha Vantage fetch failed for ${e}/${r}: ${o.status} ${o.statusText}`);let n=await o.json();if(n["Error Message"])throw Error(`Alpha Vantage rejected ${e}/${r}: ${n["Error Message"]}`);if(n.Note||n.Information)throw Error(`Alpha Vantage limit hit for ${e}/${r}: ${n.Note||n.Information}`);let i=n["Time Series FX (Daily)"];if(!i)throw Error(`Alpha Vantage returned no FX series for ${e}/${r}`);let s=function(e){let r=Object.keys(e).sort().reverse();return r.length<2?null:[r[0],r[1]]}(i);if(!s)throw Error(`Alpha Vantage returned insufficient FX history for ${e}/${r}`);let[c,l]=s,u=Number(i[c]?.["4. close"]),d=Number(i[l]?.["4. close"]);if(!Number.isFinite(u)||!Number.isFinite(d)||0===d)throw Error(`Alpha Vantage returned invalid close data for ${e}/${r}`);return(u-d)/d*100}async function i(){let e=function(){let e=Number(process.env.ALPHA_VANTAGE_CACHE_TTL_MINUTES||360);return!Number.isFinite(e)||e<=0?216e5:6e4*e}();if(o&&Date.now()-o.fetchedAt.getTime()<e)return o.perfMap;let r=process.env.ALPHA_VANTAGE_API_KEY;if(!r||"your-key-here"===r)throw Error("ALPHA_VANTAGE_API_KEY not set");let t=[];try{for(let[e,o]of function(){let e=process.env.ALPHA_VANTAGE_FX_PAIRS?.trim();return(e?e.split(",").map(e=>e.trim().toUpperCase()).filter(Boolean):[...a]).map(e=>{let[r,t]=e.split("/");return r&&t&&3===r.length&&3===t.length?[r,t]:null}).filter(e=>!!e)}()){let a=await n(e,o,r);t.push({base:e,quote:o,percentChange:a})}}catch(e){if(o)return o.perfMap;throw e}let i=function(e){let r={};for(let{base:t,quote:a,percentChange:o}of e)r[t]||(r[t]={sum:0,count:0}),r[a]||(r[a]={sum:0,count:0}),r[t].sum+=o,r[t].count++,r[a].sum-=o,r[a].count++;let t={};for(let[e,{sum:a,count:o}]of Object.entries(r))o>0&&(t[e]=a/o);return t}(t);return o={fetchedAt:new Date,perfMap:i},i}let s=new Set(["USD","EUR","GBP","JPY","CAD","AUD","NZD","CHF","NOK","SEK"]);async function c(){let e=await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json",{headers:{Accept:"application/json","User-Agent":"Mozilla/5.0"},cache:"no-store"});if(!e.ok)throw Error(`ForexFactory fetch failed: ${e.status}`);let r=await e.json(),t=new Date().toISOString().split("T")[0];return r.filter(e=>!!s.has(e.country)&&new Date(e.date).toISOString().split("T")[0]===t).map(e=>({title:e.title,country:e.country,date:e.date,impact:["High","Medium","Low","Holiday"].includes(e.impact)?e.impact:"Low",forecast:e.forecast||null,previous:e.previous||null,actual:e.actual||null}))}async function l(){let e=[],r={},t=[],[a,o]=await Promise.allSettled([i(),c()]);return"fulfilled"===a.status?r=a.value:e.push(`Performance fetch failed: ${a.reason?.message||"Unknown error"}`),"fulfilled"===o.status?t=o.value:e.push(`Calendar fetch failed: ${o.reason?.message||"Unknown error"}`),{perfMap:r,calEvents:t,fetchedAt:new Date,errors:e}}},9833:(e,r,t)=>{t.d(r,{T:()=>a});async function a(e){let r=process.env.TELEGRAM_BOT_TOKEN,t=process.env.TELEGRAM_CHAT_ID;if(!r||!t)return console.error("Telegram env vars not set"),!1;try{let a=await fetch(`https://api.telegram.org/bot${r}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:t,text:e,parse_mode:"Markdown",disable_web_page_preview:!0})});return(await a.json()).ok}catch(e){return console.error("Telegram send error:",e),!1}}}};