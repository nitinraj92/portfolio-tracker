const XLSX = require('xlsx');

const SYMBOL_MAP = {
  'ICIGOL': 'ICICIGOLD',
  'ICIA30': 'ICICIALPLV',
  'ICIPSE': 'ICICISILVE',
};

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
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });

  return rows
    .filter(row => {
      // Handle BOM and trailing spaces in column name
      const sym = Object.entries(row)
        .find(([k]) => k.trim().replace(/^\uFEFF/, '') === 'Stock Symbol');
      if (!sym) return false;
      return String(sym[1] || '').trim().length > 0;
    })
    .map(row => {
      // Normalize keys by trimming and removing BOM
      const normalizedRow = {};
      for (const [k, v] of Object.entries(row)) {
        normalizedRow[k.trim().replace(/^\uFEFF/, '')] = v;
      }

      const rawSymbol = String(normalizedRow['Stock Symbol']).trim();
      const symbol = SYMBOL_MAP[rawSymbol] || rawSymbol;
      const qty = Number(normalizedRow['Qty']) || 0;
      const avgCost = Number(normalizedRow['Avg.Price']) || 0;
      const ltp = Number(normalizedRow['LTP']) || 0;
      const pctChange = Number(normalizedRow['% change over prev close']) || 0;
      const prevClose = pctChange !== 0 ? ltp / (1 + pctChange / 100) : ltp;
      const todayPL = Math.round((ltp - prevClose) * qty * 100) / 100;
      const todayPLPct = Math.round(pctChange * 100) / 100;
      const plAbsolute = Math.round((ltp - avgCost) * qty * 100) / 100;
      const plPct = avgCost > 0 ? Math.round(((ltp - avgCost) / avgCost) * 10000) / 100 : 0;

      return {
        symbol,
        qty,
        avgCost: Math.round(avgCost * 100) / 100,
        ltp: Math.round(ltp * 100) / 100,
        prevClose: Math.round(prevClose * 100) / 100,
        todayPL,
        todayPLPct,
        plAbsolute,
        plPct,
        category: getCategory(symbol),
        source: 'icici',
      };
    });
}

module.exports = parse;
