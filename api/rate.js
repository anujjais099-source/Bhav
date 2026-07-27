/**
 * /api/rate  —  Vercel serverless function   (file: api/rate.js)
 *
 * Field names confirmed against goldpricez's live response:
 *   gram_in_inr        international gold, INR per gram (no duty/GST)
 *   ounce_price_usd    spot USD per troy ounce
 *   usd_to_inr         exchange rate
 *
 * Note: goldpricez wraps its JSON inside a JSON *string*, so the body
 * needs parsing twice. That is handled in parseBody() below.
 */

const GOLD_URL = process.env.GOLD_URL
  || 'https://goldpricez.com/api/rates/currency/inr/measure/gram';

// Set this in Vercel once you find their silver endpoint in the docs.
const SILVER_URL = process.env.SILVER_URL || '';

const API_KEY = process.env.GOLD_API_KEY || '';

/* Government numbers — change in Vercel → Settings → Environment Variables */
const DUTY = Number(process.env.DUTY_PCT ?? 15) / 100;
const GST = Number(process.env.GST_PCT ?? 3) / 100;
const GOLD_PREMIUM = Number(process.env.GOLD_PREMIUM ?? 0);
const SILVER_PREMIUM = Number(process.env.SILVER_PREMIUM ?? 0);

const OZ_TO_G = 31.1035;

/* ------------------------------------------------------------------ */

async function call(url) {
  const res = await fetch(url, {
    headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  return { status: res.status, body: await res.text() };
}

/** goldpricez returns JSON encoded inside a JSON string. Parse until object. */
function parseBody(body) {
  let out = body;
  for (let i = 0; i < 3; i++) {
    if (typeof out !== 'string') break;
    try { out = JSON.parse(out); } catch { break; }
  }
  return (out && typeof out === 'object') ? out : null;
}

const num = v => {
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** duty + GST + your local premium turns a spot price into a shop rate */
const landed = (perGram, premium) => perGram * (1 + DUTY) * (1 + GST) + premium;

/* ------------------------------------------------------------------ */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!API_KEY) {
    return res.status(500).json({ error: 'missing_key', message: 'Set GOLD_API_KEY in Vercel.' });
  }

  try {
    const goldRes = await call(GOLD_URL);
    const silverRes = SILVER_URL ? await call(SILVER_URL) : null;

    const gold = parseBody(goldRes.body);
    const silver = silverRes ? parseBody(silverRes.body) : null;

    if (req.query?.debug) {
      return res.status(200).json({
        goldStatus: goldRes.status,
        goldParsed: gold,
        silverStatus: silverRes?.status ?? 'not configured',
        silverParsed: silver,
      });
    }

    const goldSpotPerGram = num(gold?.gram_in_inr);
    if (!goldSpotPerGram) {
      return res.status(502).json({
        error: 'parse_failed',
        message: 'gram_in_inr missing from provider response.',
        hint: 'Check /api/rate?debug=1',
      });
    }

    // Silver: same field name if their silver endpoint mirrors the gold one.
    const silverSpotPerGram = num(silver?.gram_in_inr);

    const g = landed(goldSpotPerGram, GOLD_PREMIUM);
    const s = silverSpotPerGram ? landed(silverSpotPerGram, SILVER_PREMIUM) : null;
    const r = n => Math.round(n * 100) / 100;

    /* One upstream call per minute serves every visitor and every widget.
       stale-while-revalidate keeps the last number alive for 5 more
       minutes if goldpricez goes down — never show a blank rate. */
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
      international: {
        goldUsdPerOz: num(gold?.ounce_price_usd),
        usdInr: num(gold?.usd_to_inr),
        goldUsdPerGram: num(gold?.gram_in_usd),
        providerUpdatedGmt: gold?.gmt_ounce_price_usd_updated ?? null,
      },
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
