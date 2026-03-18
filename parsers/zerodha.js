const XLSX = require('xlsx');

const ETF_CATEGORIES = {
  'India Equity':    ['MIDQ50ADD', 'MODEFENCE', 'ICICIALPLV'],
  'International':   ['MON100', 'MAHKTECH', 'MASPTOP50'],
  'Precious Metals': ['ICICIGOLD', 'ICICISILVE'],
};

function getCategory(symbol) {
  for (const [cat, syms] of Object.entries(ETF_CATEGORIES)) {
    if (syms.includes(symbol)) return cat;
  }
  return 'Other';
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Equity'];

  // Header at row 23 (0-indexed: 22) — skip metadata rows
  const range = XLSX.utils.decode_range(ws['!ref']);
  range.s.r = 22;
  ws['!ref'] = XLSX.utils.encode_range(range);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });

  const stocks = [];
  const etfs = [];

  for (const row of rows) {
    const rawSymbol = String(row['Symbol'] || '').trim();
    if (!rawSymbol) continue;

    const symbol = rawSymbol.replace(/-E$/, '');
    const qty = Number(row['Quantity Available']) || 0;
    if (qty === 0) continue;

    const avgCost = Number(row['Average Price']) || 0;
    const prevClose = Number(row['Previous Closing Price']) || 0;
    const unrealizedPct = Number(row['Unrealized P&L Pct.']) || 0;
    // LTP derived from prevClose and unrealized pct is more accurate
    const ltp = prevClose > 0 ? Math.round(prevClose * (1 + unrealizedPct / 100) * 100) / 100 : Math.round(avgCost * 100) / 100;

    // todayPL uses rounded ltp so it's consistent with the stored ltp value
    const todayPL = Math.round((ltp - prevClose) * qty * 100) / 100;
    const todayPLPct = prevClose > 0 ? Math.round(((ltp - prevClose) / prevClose) * 10000) / 100 : 0;
    const plAbsolute = Math.round((ltp - avgCost) * qty * 100) / 100;
    const plPct = avgCost > 0 ? Math.round(((ltp - avgCost) / avgCost) * 10000) / 100 : 0;

    const isin = String(row['ISIN'] || '').trim();
    const sector = String(row['Sector'] || '').trim();
    const isETF = sector === 'ETF' || isin.startsWith('INF');

    const holding = {
      symbol,
      qty,
      avgCost: Math.round(avgCost * 100) / 100,
      ltp: Math.round(ltp * 100) / 100,
      prevClose: Math.round(prevClose * 100) / 100,
      todayPL,
      todayPLPct,
      plAbsolute,
      plPct,
      isin,
      sector,
      source: 'zerodha',
    };

    if (isETF) {
      etfs.push({ ...holding, category: getCategory(symbol) });
    } else {
      stocks.push(holding);
    }
  }

  return { stocks, etfs };
}

module.exports = parse;
