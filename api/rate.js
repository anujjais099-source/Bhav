/**
 * /api/rate  —  Vercel serverless function   (file: api/rate.js)
 *
 * goldpricez wants the key in a header, not in the URL. That is why
 * opening their endpoint in a browser returns "Invalid API key" —
 * a browser address bar cannot send headers. This can.
 *
 * After deploying, open:  /api/rate?debug=1
 * That prints their raw response so we can finish the parser.
 */

const GOLD_URL = process.env.GOLD_URL
  || 'https://goldpricez.com/api/rates/currency/inr/measure/gram';

const SILVER_URL = process.env.SILVER_URL || '';   // set once you find their silver endpoint

const API_KEY = process.env.GOLD_API_KEY || '';

/* Government numbers — edit in Vercel → Settings → Environment Variables */
const DUTY = Number(process.env.DUTY_PCT ?? 15) / 100;
const GST = Number(process.env.GST_PCT ?? 3) / 100;
const GOLD_PREMIUM = Number(process.env.GOLD_PREMIUM ?? 0);
const SILVER_PREMIUM = Number(process.env.SILVER_PREMIUM ?? 0);

/* ------------------------------------------------------------------ */

async function call(url) {
  const res = await fetch(url, {
    headers: {
      'X-API-KEY': API_KEY,        // goldpricez's documented header
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: null, text: text.slice(0, 300) }; }
}

/**
 * Their field names are not confirmed yet, so this hunts for the first
 * numeric value whose key mentions gold/silver and a purity.
 * Once you see the debug output, replace this with a direct lookup.
 */
function findPrice(obj, mustInclude) {
  if (!obj || typeof obj !== 'object') return null;
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase();
    if (mustInclude.every(word => k.includes(word))) {
      const n = Number(String(value).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

const landed = (perGram, premium) => perGram * (1 + DUTY) * (1 + GST) + premium;

/* ------------------------------------------------------------------ */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!API_KEY) {
    return res.status(500).json({ error: 'missing_key', message: 'Set GOLD_API_KEY in Vercel.' });
  }

  try {
    const gold = await call(GOLD_URL);
    const silver = SILVER_URL ? await call(SILVER_URL) : null;

    if (req.query?.debug) {
      return res.status(200).json({
        goldStatus: gold.status,
        goldRaw: gold.data ?? gold.text,
        silverStatus: silver?.status ?? 'not configured',
        silverRaw: silver ? (silver.data ?? silver.text) : null,
      });
    }

    // 24k gold, per gram, already in INR
    const goldBase = findPrice(gold.data, ['24']) ?? findPrice(gold.data, ['gold']);
    const silverBase = silver ? (findPrice(silver.data, ['silver']) ?? findPrice(silver.data, ['999'])) : null;

    if (!goldBase) {
      return res.status(502).json({
        error: 'parse_failed',
        message: 'Could not find the gold price field.',
        hint: 'Open /api/rate?debug=1 and send me what it prints.',
      });
    }

    const g = landed(goldBase, GOLD_PREMIUM);
    const s = silverBase ? landed(silverBase, SILVER_PREMIUM) : null;
    const r = n => Math.round(n * 100) / 100;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({
      indicative: true,
      currency: 'INR',
      gold: {
        per10g999: r(g * 10),
        per10g916: r(g * 10 * 0.916),
        per10g750: r(g * 10 * 0.750),
        perGram999: r(g),
      },
      silver: s ? {
        perKg999: r(s * 1000),
        per10g999: r(s * 10),
        perGram999: r(s),
      } : null,
      assumptions: {
        importDutyPct: DUTY * 100,
        gstPct: GST * 100,
        goldPremiumPerGram: GOLD_PREMIUM,
        silverPremiumPerGram: SILVER_PREMIUM,
      },
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(502).json({ error: 'upstream_failed', message: err.message });
  }
};
