/**
 * /api/rate  —  Vercel serverless function
 *
 * File location:  bhav/api/rate.js
 *
 * FIRST THING TO DO after deploying:
 *   open  https://your-site.vercel.app/api/rate?debug=1
 * That prints the raw response from the price API so you can see the
 * exact field names. Then fix parseUpstream() below to match.
 * Your API key is never included in that output.
 */

const OZ_TO_G = 31.1035;

/* Government numbers — change these in Vercel → Settings → Environment
   Variables when a notification lands. No code edit, no redeploy needed. */
const DUTY = Number(process.env.DUTY_PCT ?? 15) / 100;   // 15% since 13 May 2026
const GST = Number(process.env.GST_PCT ?? 3) / 100;      // 3% on bullion
const GOLD_PREMIUM = Number(process.env.GOLD_PREMIUM ?? 0);    // ₹ per gram
const SILVER_PREMIUM = Number(process.env.SILVER_PREMIUM ?? 0); // ₹ per gram

const API_KEY = process.env.GOLD_API_KEY || '';

/* ------------------------------------------------------------------ */
/* 1. WHERE THE DATA COMES FROM                                        */
/* ------------------------------------------------------------------ */

function upstreamUrl() {
  // Copy the exact URL from your provider's dashboard into this env var,
  // including their key placeholder. Keeping it in an env var means you can
  // switch providers without touching code.
  if (process.env.UPSTREAM_URL) {
    return process.env.UPSTREAM_URL.replace('{KEY}', API_KEY);
  }
  // Fallback example — replace with your provider's real endpoint.
  return `https://api.metals.dev/v1/latest?api_key=${API_KEY}&currency=USD&unit=toz`;
}

/* ------------------------------------------------------------------ */
/* 2. READING THEIR SHAPE — the part you will adjust                   */
/* ------------------------------------------------------------------ */

/**
 * Turn whatever the provider sends into: { goldInrPerGram, silverInrPerGram }
 *
 * Two shapes are handled. Delete the one that doesn't apply once you've
 * seen the debug output.
 */
function parseUpstream(data) {
  // Shape A — provider already gives prices in INR per gram
  const goldInrDirect = num(data?.gold_inr_gram ?? data?.rates?.gold);
  const silverInrDirect = num(data?.silver_inr_gram ?? data?.rates?.silver);

  if (goldInrDirect && silverInrDirect) {
    return {
      goldInrPerGram: goldInrDirect,
      silverInrPerGram: silverInrDirect,
      international: { note: 'provider returned INR directly' },
    };
  }

  // Shape B — provider gives USD per troy ounce plus an INR conversion
  const goldUsdOz = num(data?.metals?.gold ?? data?.gold);
  const silverUsdOz = num(data?.metals?.silver ?? data?.silver);
  const usdInr = num(data?.currencies?.INR ?? data?.rates?.INR);

  if (goldUsdOz && silverUsdOz && usdInr) {
    return {
      goldInrPerGram: (goldUsdOz / OZ_TO_G) * usdInr,
      silverInrPerGram: (silverUsdOz / OZ_TO_G) * usdInr,
      international: { goldUsdPerOz: goldUsdOz, silverUsdPerOz: silverUsdOz, usdInr },
    };
  }

  throw new Error('Could not find price fields. Open /api/rate?debug=1 and update parseUpstream().');
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ------------------------------------------------------------------ */
/* 3. THE FORMULA                                                      */
/* ------------------------------------------------------------------ */

function landedPerGram(basePerGram, premium) {
  return basePerGram * (1 + DUTY) * (1 + GST) + premium;
}

/* ------------------------------------------------------------------ */
/* 4. HANDLER                                                          */
/* ------------------------------------------------------------------ */

module.exports = async (req, res) => {
  // Widgets run on other people's sites, so CORS stays open.
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!API_KEY) {
    return res.status(500).json({
      error: 'missing_key',
      message: 'Set GOLD_API_KEY in Vercel → Settings → Environment Variables.',
    });
  }

  try {
    const upstream = await fetch(upstreamUrl(), { signal: AbortSignal.timeout(8000) });
    const text = await upstream.text();

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Provider did not return JSON: ' + text.slice(0, 200)); }

    // Debug view — shows their raw shape, never your key.
    if (req.query?.debug) {
      return res.status(200).json({ upstreamStatus: upstream.status, raw: data });
    }

    if (!upstream.ok) throw new Error('Provider returned ' + upstream.status);

    const base = parseUpstream(data);

    const gold = landedPerGram(base.goldInrPerGram, GOLD_PREMIUM);
    const silver = landedPerGram(base.silverInrPerGram, SILVER_PREMIUM);
    const r = n => Math.round(n * 100) / 100;

    /* Vercel's CDN holds this for 60 seconds and serves it to everyone,
       so one API call covers every visitor. stale-while-revalidate keeps
       serving the old number for 5 more minutes if the provider goes down —
       a rate board must never go blank. */
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({
      indicative: true,
      currency: 'INR',
      gold: {
        per10g999: r(gold * 10),
        per10g916: r(gold * 10 * 0.916),
        per10g750: r(gold * 10 * 0.750),
        perGram999: r(gold),
      },
      silver: {
        perKg999: r(silver * 1000),
        per10g999: r(silver * 10),
        perGram999: r(silver),
      },
      international: base.international,
      assumptions: {
        importDutyPct: DUTY * 100,
        gstPct: GST * 100,
        goldPremiumPerGram: GOLD_PREMIUM,
        silverPremiumPerGram: SILVER_PREMIUM,
      },
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(502).json({
      error: 'upstream_failed',
      message: err.message,
      hint: 'Try /api/rate?debug=1 to see what the provider actually sent.',
    });
  }
};
