const { execFile } = require('child_process');
const path = require('path');
const db = require('../storage/db');
const { calcRSI, calcHealth } = require('./technicals');

const PYTHON = process.env.PYTHON_PATH || 'python3';
const SCRIPT = path.join(__dirname, 'fetch_prices.py');

/**
 * Call the Python yfinance script with a batch of holdings.
 * Returns a map of symbol → price data.
 */
function fetchPricesBatch(holdings) {
  return new Promise((resolve) => {
    const input = holdings.map(h => ({
      symbol: h.symbol,
      avgCost: h.avgCost || null,
      exchange: h.exchange || null,
    }));

    const child = execFile(PYTHON, [SCRIPT], { timeout: 600000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn('[prices/stocks] Python fetch error:', err.message);
        return resolve({});
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        console.warn('[prices/stocks] JSON parse error:', e.message);
        resolve({});
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

/**
 * Refresh live prices for a batch of stock/ETF holdings via Python yfinance.
 * Uses stored prevClose (from XLSX upload) for today's P&L — more reliable.
 * Stores which exchange (NSE/BSE) worked for each symbol.
 */
async function refreshPrices(holdings) {
  if (!holdings || holdings.length === 0) return holdings;

  console.log('[prices/stocks] Fetching', holdings.length, 'symbols via Python yfinance...');
  const priceMap = await fetchPricesBatch(holdings);

  return holdings.map(holding => {
    const data = priceMap[holding.symbol];
    if (!data || !data.price) {
      console.warn('[prices/stocks] No data for', holding.symbol, '— keeping existing');
      return holding;
    }

    const ltp = data.price;
    // Use freshly fetched prevClose (yesterday's actual close) for today's P&L.
    // Falls back to XLSX upload value only if yfinance didn't return prevClose.
    const prevClose = data.prevClose || holding.prevClose || ltp;
    const todayPL = Math.round((ltp - prevClose) * holding.qty * 100) / 100;
    const todayPLPct = prevClose > 0 ? Math.round(((ltp - prevClose) / prevClose) * 10000) / 100 : 0;

    let rsi = null;
    let health = holding.health || 'Neutral';
    try {
      if (data.closes && data.closes.length >= 15) {
        rsi = calcRSI(data.closes);
        health = calcHealth({
          rsi,
          ltp,
          dma50:  data.dma50,
          dma200: data.dma200,
          plPct:  holding.avgCost > 0 ? ((ltp - holding.avgCost) / holding.avgCost) * 100 : 0,
          pe:     data.pe,
        });
      }
    } catch (e) {}

    return {
      ...holding,
      exchange:    data.exchange,
      ltp:         Math.round(ltp * 100) / 100,
      prevClose,
      todayPL,
      todayPLPct,
      plAbsolute:  Math.round((ltp - holding.avgCost) * holding.qty * 100) / 100,
      plPct:       holding.avgCost > 0 ? Math.round(((ltp - holding.avgCost) / holding.avgCost) * 10000) / 100 : 0,
      dma50:       data.dma50   || null,
      dma200:      data.dma200  || null,
      week52High:  data.week52High || null,
      week52Low:   data.week52Low  || null,
      pe:             data.pe            || null,
      sectorPe:       data.sectorPe      || null,
      eps:            data.eps           || null,
      roe:            data.roe           || null,
      roce:           data.roce          || null,
      netMargin:      data.netMargin     || null,
      debtEquity:     data.debtEquity    || null,
      marketCap:      data.marketCap     || null,
      beta:           data.beta          || null,
      bookValue:      data.bookValue     || null,
      dividendYield:  data.dividendYield || null,
      analystTarget:  data.analystTarget || null,
      rsi,
      trend:     data.dma50 ? (ltp > data.dma50 ? 'Bullish' : 'Bearish') : null,
      volume:    data.volume    || null,
      avgVolume: data.avgVolume || null,
      health,
    };
  });
}

/**
 * Fetch a single quote (for /api/technicals/:symbol endpoint).
 */
async function fetchQuote(symbol) {
  const data = db.read();
  const holding = [...(data.stocks||[]), ...(data.etfs||[])].find(h => h.symbol === symbol) || {};
  const result = await fetchPricesBatch([{ symbol, avgCost: holding.avgCost, exchange: holding.exchange }]);
  return result[symbol] || null;
}

/**
 * Fetch historical closes for a symbol (used by /api/technicals/:symbol).
 */
async function fetchHistorical(symbol) {
  const data = db.read();
  const holding = [...(data.stocks||[]), ...(data.etfs||[])].find(h => h.symbol === symbol) || {};
  const result = await fetchPricesBatch([{ symbol, avgCost: holding.avgCost, exchange: holding.exchange }]);
  return (result[symbol] && result[symbol].closes) || [];
}

module.exports = { refreshPrices, fetchQuote, fetchHistorical };
