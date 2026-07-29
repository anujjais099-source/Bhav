/**
 * Gold & Silver rate API
 * ----------------------
 * One file, zero dependencies. Node 18+ (needs global fetch).
 *
 *   node server.js
 *   → http://localhost:3000/api/rate
 *
 * What it does:
 *   1. Fetches international spot price ONCE per REFRESH_MS, no matter how
 *      many people are looking at your site.
 *   2. Applies duty + GST + your premium to get the Indian rate.
 *   3. Serves it as JSON with CORS on, so your page and your widget can read it.
 *   4. If the upstream API is down, keeps serving the last good price
 *      marked stale — a rate board must never go blank.
 *
 * Your API key lives here on the server and NEVER goes to the browser.
 */

const http = require('node:http');

/* ------------------------------------------------------------------ */
/* CONFIG — set these as environment variables in production           */
/* ------------------------------------------------------------------ */

const PORT = process.env.PORT || 3000;

const API_KEY = process.env.GOLD_API_KEY || '';

// Match this to your API plan's limit.
//   60_000  (1 min)  ≈ 43,000 calls/month — fine for goldpricez free tier
//   900_000 (15 min) ≈ 2,900 calls/month  — for smaller tiers
const REFRESH_MS = Number(process.env.REFRESH_MS || 60_000);

// These are the numbers that change with government notifications.
// Move them into a database when you build an admin page.
const RATES = {
  duty: Number(process.env.DUTY_PCT ?? 15) / 100,   // 15% since 13 May 2026
  gst: Number(process.env.GST_PCT ?? 3) / 100,      // 3% on bullion
  goldPremiumPerGram: Number(process.env.GOLD_PREMIUM ?? 0),
  silverPremiumPerGram: Number(process.env.SILVER_PREMIUM ?? 0),
};

const OZ_TO_G = 31.1035;

/* ------------------------------------------------------------------ */
/* UPSTREAM — swap this one function to change data provider           */
/* ------------------------------------------------------------------ */

/**
 * Must return: { goldUsdOz, silverUsdOz, usdInr }
 *
 * Field names below are a starting point — open your provider's docs,
 * log the raw response once, and adjust the mapping. This is the ONLY
 * place that knows which provider you use.
 */
async function fetchUpstream() {
  const url =
    `https://api.metals.dev/v1/latest?api_key=${API_KEY}&currency=USD&unit=toz`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);

  const data = await res.json();

  const goldUsdOz = Number(data?.metals?.gold);
  const silverUsdOz = Number(data?.metals?.silver);
  const usdInr = Number(data?.currencies?.INR);

  if (!goldUsdOz || !silverUsdOz || !usdInr) {
    throw new Error('upstream returned unexpected shape: ' + JSON.stringify(data).slice(0, 300));
  }
  return { goldUsdOz, silverUsdOz, usdInr };
}

/* ------------------------------------------------------------------ */
/* THE FORMULA — the whole product lives here                          */
/* ------------------------------------------------------------------ */

function perGramInr(usdPerOz, usdInr, premium) {
  return (usdPerOz / OZ_TO_G) * usdInr * (1 + RATES.duty) * (1 + RATES.gst) + premium;
}

function computeRate(feed) {
  const gold999 = perGramInr(feed.goldUsdOz, feed.usdInr, RATES.goldPremiumPerGram);
  const silver999 = perGramInr(feed.silverUsdOz, feed.usdInr, RATES.silverPremiumPerGram);

  const r = n => Math.round(n * 100) / 100;

  return {
    indicative: true,
    currency: 'INR',
    gold: {
      per10g999: r(gold999 * 10),
      per10g916: r(gold999 * 10 * 0.916),
      per10g750: r(gold999 * 10 * 0.750),
      perGram999: r(gold999),
    },
    silver: {
      perKg999: r(silver999 * 1000),
      per10g999: r(silver999 * 10),
      perGram999: r(silver999),
    },
    international: {
      goldUsdPerOz: r(feed.goldUsdOz),
      silverUsdPerOz: r(feed.silverUsdOz),
      usdInr: r(feed.usdInr),
    },
    assumptions: {
      importDutyPct: RATES.duty * 100,
      gstPct: RATES.gst * 100,
      goldPremiumPerGram: RATES.goldPremiumPerGram,
      silverPremiumPerGram: RATES.silverPremiumPerGram,
    },
  };
}

/* ------------------------------------------------------------------ */
/* CACHE — lazy refresh, survives server sleep on free hosting         */
/* ------------------------------------------------------------------ */

let cache = { payload: null, fetchedAt: 0 };
let inFlight = null;   // stops 50 simultaneous visitors causing 50 API calls

async function getRate() {
  const age = Date.now() - cache.fetchedAt;

  if (cache.payload && age < REFRESH_MS) {
    return { ...cache.payload, stale: false, ageSeconds: Math.round(age / 1000) };
  }

  if (!inFlight) {
    inFlight = fetchUpstream()
      .then(feed => {
        cache = { payload: computeRate(feed), fetchedAt: Date.now() };
        console.log('[rate] refreshed', cache.payload.gold.per10g999);
      })
      .catch(err => {
        console.error('[rate] upstream failed:', err.message);
      })
      .finally(() => { inFlight = null; });
  }

  await inFlight;

  if (!cache.payload) return null;

  const finalAge = Date.now() - cache.fetchedAt;
  return {
    ...cache.payload,
    stale: finalAge >= REFRESH_MS,      // served old data, upstream is down
    ageSeconds: Math.round(finalAge / 1000),
  };
}

/* ------------------------------------------------------------------ */
/* SERVER                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  // Widgets run on other people's websites, so CORS must be open.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const path = new URL(req.url, 'http://x').pathname;

  if (path === '/health') {
    res.writeHead(200).end(JSON.stringify({ ok: true, cachedAt: cache.fetchedAt }));
    return;
  }

  if (path === '/api/rate') {
    const rate = await getRate();

    if (!rate) {
      res.writeHead(503).end(JSON.stringify({
        error: 'rate_unavailable',
        message: 'Price feed is not responding. Try again shortly.',
      }));
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=30');
    res.writeHead(200).end(JSON.stringify({
      ...rate,
      updatedAt: new Date(cache.fetchedAt).toISOString(),
    }));
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`Rate API on http://localhost:${PORT}/api/rate`);
  if (!API_KEY) console.warn('WARNING: GOLD_API_KEY is empty — upstream calls will fail.');
  getRate();   // warm the cache at startup
});
