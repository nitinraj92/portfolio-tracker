const yahooFinance = require('yahoo-finance2').default;
const db = require('../storage/db');
const { calcRSI, calcHealth, calcTodayPLFromQuote } = require('./technicals');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchQuote(symbol) {
  // Try NSE first (.NS), fall back to BSE (.BO) — some stocks are BSE-only
  for (const suffix of ['.NS', '.BO']) {
    const ticker = symbol + suffix;
    try {
      const q = await yahooFinance.quote(ticker);
      // Sanity check: regularMarketPrice must be present and > 0
      if (q && q.regularMarketPrice > 0) return q;
    } catch (err) {
      // Try next suffix
    }
  }
  console.warn('[prices/stocks] Could not fetch quote for ' + symbol + ' on NSE or BSE');
  return null;
}

async function fetchHistorical(symbol) {
  const data = db.read();
  const cached = data.price_history_cache[symbol];
  const now = Date.now();

  if (cached && cached.fetchedAt && (now - new Date(cached.fetchedAt).getTime()) < CACHE_TTL_MS) {
    return cached.closes;
  }

  const ticker = symbol + '.NS';
  const period1 = new Date(now - 35 * 24 * 60 * 60 * 1000);
  try {
    const history = await yahooFinance.historical(ticker, { period1, interval: '1d' });
    const closes = history.map(h => h.close).filter(c => c != null && !isNaN(c));
    // Update cache
    const fresh = db.read();
    fresh.price_history_cache[symbol] = { closes, fetchedAt: new Date().toISOString() };
    db.write(fresh);
    return closes;
  } catch (err) {
    console.warn('[prices/stocks] Failed historical for ' + ticker + ': ' + err.message);
    return cached ? cached.closes : [];
  }
}

async function refreshPrices(holdings) {
  const results = [];
  for (const holding of holdings) {
    const quote = await fetchQuote(holding.symbol);
    if (!quote) {
      results.push(holding);
      continue;
    }

    const ltp = quote.regularMarketPrice || holding.ltp;
    // Use prevClose from the uploaded XLSX (reliable exchange data) not Yahoo's
    // regularMarketPreviousClose (can be wrong for some NSE symbols)
    const prevClose = holding.prevClose || quote.regularMarketPreviousClose || ltp;
    const todayPL = Math.round((ltp - prevClose) * holding.qty * 100) / 100;
    const todayPLPct = prevClose > 0 ? Math.round(((ltp - prevClose) / prevClose) * 10000) / 100 : 0;

    const closes = await fetchHistorical(holding.symbol);

    let rsi = null;
    let health = 'Neutral';
    try {
      if (closes.length >= 15) {
        rsi = calcRSI(closes);
        health = calcHealth({
          rsi,
          ltp,
          dma50: quote.fiftyDayAverage || null,
          dma200: quote.twoHundredDayAverage || null,
          plPct: holding.avgCost > 0 ? ((ltp - holding.avgCost) / holding.avgCost) * 100 : 0,
          pe: quote.trailingPE || null,
        });
      }
    } catch (e) {
      // RSI failed — leave as Neutral
    }

    const updated = {
      ...holding,
      ltp,
      prevClose,
      todayPL,
      todayPLPct,
      plAbsolute: Math.round((ltp - holding.avgCost) * holding.qty * 100) / 100,
      plPct: holding.avgCost > 0
        ? Math.round(((ltp - holding.avgCost) / holding.avgCost) * 10000) / 100
        : 0,
      dma50: quote.fiftyDayAverage || null,
      dma200: quote.twoHundredDayAverage || null,
      week52High: quote.fiftyTwoWeekHigh || null,
      week52Low: quote.fiftyTwoWeekLow || null,
      pe: quote.trailingPE || null,
      debtToEquity: null,       // not available in quote endpoint
      promoterHolding: null,    // not available in quote endpoint
      fiiHolding: null,         // not available in quote endpoint
      marketCap: quote.marketCap || null,
      rsi,
      trend: quote.fiftyDayAverage
        ? (ltp > quote.fiftyDayAverage ? 'Bullish' : 'Bearish')
        : null,
      health,
    };

    results.push(updated);
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

module.exports = { refreshPrices, fetchQuote, fetchHistorical };
