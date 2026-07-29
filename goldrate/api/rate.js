/**
 * /api/rate  —  Vercel serverless function   (file: api/rate.js)
 *
 * Three free, no-key sources, fetched in parallel:
 *   gold-api.com/price/XAU   gold spot, USD per troy ounce
 *   gold-api.com/price/XAG   silver spot, USD per troy ounce
 *   open.er-api.com          USD -> INR (updates once every ~24h;
 *                            fine here since duty/GST/premium already
 *                            dominate the final number)
 *
 * Field names confirmed live on 2026-07-28:
 *   gold-api.com   -> { price: <number USD/oz>, updatedAt }
 *   open.er-api.com -> { rates: { INR: <number> } }
 */

const GOLD_URL = process.env.GOLD_URL || 'https://api.gold-api.com/price/XAU';
const SILVER_URL = process.env.SILVER_URL || 'https://api.gold-api.com/price/XAG';
const FX_URL = process.env.FX_URL || 'https://open.er-api.com/v6/latest/USD';

/* Government numbers — change in Vercel → Settings → Environment Variables */
const DUTY = Number(process.env.DUTY_PCT ?? 15) / 100;
const GST = Number(process.env.GST_PCT ?? 0) / 100;
const GOLD_PREMIUM = Number(process.env.GOLD_PREMIUM ?? -116);
const SILVER_PREMIUM = Number(process.env.SILVER_PREMIUM ?? 0);

const OZ_TO_G = 31.1035;

/* ------------------------------------------------------------------ */

async function call(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null, caller handles it */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** duty + GST + your local premium turns a spot price into a shop rate */
const landed = (perGram, premium) => perGram * (1 + DUTY) * (1 + GST) + premium;

/* ------------------------------------------------------------------ */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const [goldRes, silverRes, fxRes] = await Promise.all([
      call(GOLD_URL),
      call(SILVER_URL),
      call(FX_URL),
    ]);

    if (req.query?.debug) {
      return res.status(200).json({
        goldStatus: goldRes.status, goldParsed: goldRes.json ?? goldRes.text,
        silverStatus: silverRes.status, silverParsed: silverRes.json ?? silverRes.text,
        fxStatus: fxRes.status, fxParsed: fxRes.json ?? fxRes.text,
      });
    }

    const goldUsdOz = num(goldRes.json?.price);
    const silverUsdOz = num(silverRes.json?.price);
    const usdInr = num(fxRes.json?.rates?.INR);

    if (!goldUsdOz || !usdInr) {
      return res.status(502).json({
        error: 'parse_failed',
        message: 'gold price or USD/INR rate missing from provider response.',
        hint: 'Check /api/rate?debug=1',
      });
    }

    const goldSpotPerGram = (goldUsdOz / OZ_TO_G) * usdInr;
    const silverSpotPerGram = silverUsdOz ? (silverUsdOz / OZ_TO_G) * usdInr : null;

    const g = landed(goldSpotPerGram, GOLD_PREMIUM);
    const s = silverSpotPerGram ? landed(silverSpotPerGram, SILVER_PREMIUM) : null;
    const r = n => Math.round(n * 100) / 100;

    /* One upstream call per minute serves every visitor and every widget.
       stale-while-revalidate keeps the last number alive for 5 more
       minutes if a provider goes down — never show a blank rate. */
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
        goldUsdPerOz: goldUsdOz,
        silverUsdPerOz: silverUsdOz,
        usdInr,
        goldUsdPerGram: r(goldUsdOz / OZ_TO_G),
        providerUpdatedGmt: goldRes.json?.updatedAt ?? null,
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
