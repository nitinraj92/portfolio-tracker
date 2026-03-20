const fetch = require('node-fetch');
const MFAPI_BASE = 'https://api.mfapi.in/mf';

/**
 * Search mfapi.in for a scheme, matching plan type (Direct/Regular) and Growth option.
 * Returns { schemeCode, schemeName } or null.
 */
async function lookupSchemeCode(schemeName, plan) {
  try {
    // Strip plan/growth words to get core fund name for search
    const core = schemeName
      .replace(/direct\s+plan/gi, '')
      .replace(/regular\s+plan/gi, '')
      .replace(/-\s*growth/gi, '')
      .replace(/growth\s+option/gi, '')
      .replace(/growth\s+plan/gi, '')
      .replace(/\(erstwhile[^)]*\)/gi, '')
      .replace(/\(formerly[^)]*\)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Use first 5 meaningful words as search query
    const query = core.split(/\s+/).slice(0, 5).join(' ');
    const url = MFAPI_BASE + '/search?q=' + encodeURIComponent(query);
    const res = await fetch(url);
    let results = await res.json();
    if (!results || results.length === 0) return null;

    // Filter by plan type if known
    if (plan === 'Direct') {
      const direct = results.filter(r => /direct/i.test(r.schemeName));
      if (direct.length > 0) results = direct;
    } else if (plan === 'Regular') {
      const regular = results.filter(r => /regular/i.test(r.schemeName));
      if (regular.length > 0) results = regular;
    }

    // Prefer Growth option over IDCW/Dividend
    const growth = results.filter(r => {
      const n = r.schemeName.toLowerCase();
      return n.includes('growth') || (!n.includes('idcw') && !n.includes('dividend') && !n.includes('payout'));
    });
    if (growth.length > 0) results = growth;

    return { schemeCode: String(results[0].schemeCode), schemeName: results[0].schemeName };
  } catch (err) {
    console.warn('[prices/mf] Lookup failed for "' + schemeName + '": ' + err.message);
    return null;
  }
}

/**
 * Fetch latest + previous NAV for a scheme code.
 * Returns { nav, prevNav } or null.
 */
async function fetchNAV(schemeCode) {
  try {
    const res = await fetch(MFAPI_BASE + '/' + schemeCode);
    const json = await res.json();
    const data = json.data;
    if (!data || data.length < 2) return null;
    const nav     = parseFloat(data[0].nav);
    const prevNav = parseFloat(data[1].nav);
    if (isNaN(nav) || isNaN(prevNav)) return null;
    return { nav, prevNav };
  } catch (err) {
    console.warn('[prices/mf] NAV fetch failed for ' + schemeCode + ': ' + err.message);
    return null;
  }
}

/**
 * Refresh NAVs for an array of MF holdings.
 * schemeCodesMap is passed by reference from server.js so scheme codes persist
 * without a mid-refresh db.write() that would overwrite updated stock prices.
 */
async function refreshMFPrices(holdings, schemeCodesMap) {
  const results = [];

  for (const h of holdings) {
    let schemeCode = h.schemeCode || schemeCodesMap[h.scheme];

    if (!schemeCode) {
      const found = await lookupSchemeCode(h.scheme, h.plan);
      if (found) {
        schemeCode = found.schemeCode;
      } else {
        console.warn('[prices/mf] No scheme code for "' + h.scheme + '" — skipping NAV');
        results.push(h);
        continue;
      }
    }

    const navData = await fetchNAV(schemeCode);
    if (!navData) {
      results.push({ ...h, schemeCode });
      continue;
    }

    // Sanity check: compare NAV × units against INVESTED (stable CAS value, never corrupted).
    // For any real fund, currentValue / invested should be between 0.4 and 3.0
    // (40% loss to 200% gain max). If outside that range, scheme code is wrong fund.
    if (h.invested && h.invested > 0 && h.units && h.units > 0) {
      const implied = navData.nav * h.units;
      const ratio   = implied / h.invested;
      if (ratio < 0.40 || ratio > 3.0) {
        console.warn('[prices/mf] REJECTED code ' + schemeCode + ' for "' + h.scheme + '" — implied ₹' + Math.round(implied) + ' vs invested ₹' + Math.round(h.invested) + ' (ratio ' + ratio.toFixed(2) + ')');
        results.push(h); // keep existing data
        continue;
      }
    }

    // Persist scheme code only after sanity check passes
    schemeCodesMap[h.scheme] = schemeCode;

    const { nav, prevNav } = navData;
    const todayPL     = Math.round((nav - prevNav) * h.units * 100) / 100;
    const todayPLPct  = prevNav > 0 ? Math.round(((nav - prevNav) / prevNav) * 10000) / 100 : 0;
    const currentValue = Math.round(nav * h.units * 100) / 100;
    const plAbsolute  = Math.round((currentValue - h.invested) * 100) / 100;
    const plPct       = h.invested > 0 ? Math.round((plAbsolute / h.invested) * 10000) / 100 : 0;

    results.push({
      ...h,
      schemeCode,
      nav:        Math.round(nav     * 10000) / 10000,
      prevNav:    Math.round(prevNav * 10000) / 10000,
      todayPL,
      todayPLPct,
      currentValue,
      plAbsolute,
      plPct,
    });

    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

module.exports = { refreshMFPrices, lookupSchemeCode, fetchNAV };
