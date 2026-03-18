// parsers/zerodha_pnl.js
// Parses Zerodha Tax P&L XLSX (Equity sheet)
// Header is at row 38 (0-indexed: 37). Columns:
// Symbol, ISIN, Quantity, Buy Value, Sell Value, Realized P&L, Realized P&L Pct.,
// Previous Closing Price, Open Quantity, Open Quantity Type, Open Value,
// Unrealized P&L, Unrealized P&L Pct.

const XLSX = require('xlsx');

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Equity'];
  if (!ws) throw new Error('No "Equity" sheet found in file');

  // Set range to start at header row (0-indexed row 37)
  const range = XLSX.utils.decode_range(ws['!ref']);
  range.s.r = 37;
  ws['!ref'] = XLSX.utils.encode_range(range);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });

  const entries = rows
    .filter(row => row['Symbol'] && String(row['Symbol']).trim())
    .map(row => ({
      symbol:       String(row['Symbol']).trim(),
      isin:         String(row['ISIN'] || '').trim(),
      qty:          Number(row['Quantity']) || 0,
      buyValue:     Math.round((Number(row['Buy Value']) || 0) * 100) / 100,
      sellValue:    Math.round((Number(row['Sell Value']) || 0) * 100) / 100,
      realizedPL:   Math.round((Number(row['Realized P&L']) || 0) * 100) / 100,
      realizedPct:  Math.round((Number(row['Realized P&L Pct.']) || 0) * 100) / 100,
      openQty:      Number(row['Open Quantity']) || 0,
    }));

  const totalRealizedPL  = Math.round(entries.reduce((s, e) => s + e.realizedPL, 0) * 100) / 100;
  const totalBuyValue    = Math.round(entries.reduce((s, e) => s + e.buyValue, 0) * 100) / 100;
  const totalSellValue   = Math.round(entries.reduce((s, e) => s + e.sellValue, 0) * 100) / 100;
  const winners          = entries.filter(e => e.realizedPL > 0).length;
  const losers           = entries.filter(e => e.realizedPL < 0).length;

  return { entries, totalRealizedPL, totalBuyValue, totalSellValue, winners, losers };
}

module.exports = parse;
