/**
 * Wilder's smoothed RSI(14).
 * Uses the 14 most recent trading-day closes from the provided array.
 * @param {number[]} closes - array of closing prices, oldest first, min 15
 * @returns {number} RSI 0-100
 */
function calcRSI(closes) {
  if (!closes || closes.length < 15) {
    throw new Error('RSI requires at least 15 closing prices');
  }
  // Take last 15 closes → 14 changes
  const recent = closes.slice(-15);
  const changes = recent.slice(1).map((c, i) => c - recent[i]);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));

  // Initial 14-period averages
  let avgGain = gains.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  let avgLoss = losses.slice(0, 14).reduce((a, b) => a + b, 0) / 14;

  // Wilder's smoothing for any additional periods
  for (let i = 14; i < changes.length; i++) {
    avgGain = (avgGain * 13 + gains[i]) / 14;
    avgLoss = (avgLoss * 13 + losses[i]) / 14;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/**
 * Composite health score.
 * @param {{ rsi: number, ltp: number, dma50?: number, dma200?: number, plPct: number, pe?: number }} p
 * @returns {'Healthy'|'Neutral'|'Weak'}
 */
function calcHealth({ rsi, ltp, dma50, dma200, plPct, pe }) {
  const isWeak =
    rsi < 35 ||
    (dma200 != null && ltp < dma200) ||
    plPct < -10;

  if (isWeak) return 'Weak';

  const isHealthy =
    rsi >= 40 && rsi <= 65 &&
    (dma50 != null && ltp > dma50);

  return isHealthy ? 'Healthy' : 'Neutral';
}

/**
 * Compute today's P&L from a Yahoo Finance quote object.
 * @param {object} quote - Yahoo Finance quote with regularMarketPrice + regularMarketPreviousClose
 * @param {number} qty
 * @returns {{ ltp, prevClose, todayPL, todayPLPct }}
 */
function calcTodayPLFromQuote(quote, qty) {
  const ltp = quote.regularMarketPrice || 0;
  const prevClose = quote.regularMarketPreviousClose || ltp;
  const todayPL = Math.round((ltp - prevClose) * qty * 100) / 100;
  const todayPLPct = prevClose > 0
    ? Math.round(((ltp - prevClose) / prevClose) * 10000) / 100
    : 0;
  return { ltp, prevClose, todayPL, todayPLPct };
}

module.exports = { calcRSI, calcHealth, calcTodayPLFromQuote };
