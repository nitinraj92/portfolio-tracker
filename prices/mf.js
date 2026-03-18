const fetch = require('node-fetch');
const db = require('../storage/db');

const MFAPI_BASE = 'https://api.mfapi.in/mf';

async function lookupSchemeCode(schemeName) {
  try {
    const url = MFAPI_BASE + '/search?q=' + encodeURIComponent(schemeName);
    const res = await fetch(url);
    const results = await res.json();
    if (results && results.length > 0) {
      return { schemeCode: String(results[0].schemeCode), schemeName: results[0].schemeName };
    }
  } catch (err) {
    console.warn('[prices/mf] Lookup failed for "' + schemeName + '": ' + err.message);
  }
  return null;
}

async function fetchNAV(schemeCode) {
  try {
    const res = await fetch(MFAPI_BASE + '/' + schemeCode);
    const json = await res.json();
    const data = json.data;
    if (!data || data.length < 2) return null;
    const nav = parseFloat(data[0].nav);
    const prevNav = parseFloat(data[1].nav);
    if (isNaN(nav) || isNaN(prevNav)) return null;
    return { nav, prevNav };
  } catch (err) {
    console.warn('[prices/mf] NAV fetch failed for ' + schemeCode + ': ' + err.message);
    return null;
  }
}

async function refreshMFPrices(holdings) {
  const data = db.read();
  const results = [];

  for (const h of holdings) {
    let schemeCode = h.schemeCode || data.mf_scheme_codes[h.scheme];

    // Auto-lookup if missing
    if (!schemeCode) {
      const found = await lookupSchemeCode(h.scheme);
      if (found) {
        schemeCode = found.schemeCode;
        data.mf_scheme_codes[h.scheme] = schemeCode;
        console.log('[prices/mf] Found scheme code for "' + h.scheme + '": ' + schemeCode);
      } else {
        console.warn('[prices/mf] No scheme code found for "' + h.scheme + '" — skipping NAV');
        results.push(h);
        continue;
      }
    }

    const navData = await fetchNAV(schemeCode);
    if (!navData) {
      results.push({ ...h, schemeCode });
      continue;
    }

    const { nav, prevNav } = navData;
    const todayPL = Math.round((nav - prevNav) * h.units * 100) / 100;
    const todayPLPct = prevNav > 0
      ? Math.round(((nav - prevNav) / prevNav) * 10000) / 100
      : 0;
    const currentValue = Math.round(nav * h.units * 100) / 100;
    const plAbsolute = Math.round((currentValue - h.invested) * 100) / 100;
    const plPct = h.invested > 0
      ? Math.round((plAbsolute / h.invested) * 10000) / 100
      : 0;

    results.push({
      ...h,
      schemeCode,
      nav: Math.round(nav * 10000) / 10000,
      prevNav: Math.round(prevNav * 10000) / 10000,
      todayPL,
      todayPLPct,
      currentValue,
      plAbsolute,
      plPct,
    });

    await new Promise(r => setTimeout(r, 200));
  }

  // Persist any newly discovered scheme codes
  const fresh = db.read();
  fresh.mf_scheme_codes = { ...fresh.mf_scheme_codes, ...data.mf_scheme_codes };
  db.write(fresh);

  return results;
}

module.exports = { refreshMFPrices, lookupSchemeCode, fetchNAV };
