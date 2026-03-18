const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.PORTFOLIO_PATH ||
  path.join(__dirname, '..', 'data', 'portfolio.json');

const DEFAULT = {
  lastUpdated: { zerodha: null, icici: null, mfcentral_nitin: null, mfcentral_indumati: null, prices: null, realized_pnl: null },
  realized_pnl: { entries: [], totalRealizedPL: 0, totalBuyValue: 0, totalSellValue: 0, winners: 0, losers: 0 },
  stocks: [], etfs: [], mf_nitin: [], mf_indumati: [],
  mf_scheme_codes: {}, price_history_cache: {}, upload_history: [],
  sips: { mf: [], etf_zerodha: [], etf_icici: [] },
  assumptions: { mfEtfCagr: 12, stocksCagr: 15, monthlyStockBudget: 4000 }
};

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}

function write(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function setTimestamp(source) {
  const data = read();
  data.lastUpdated[source] = new Date().toISOString();
  write(data);
}

function addUploadHistory(entry) {
  const data = read();
  data.upload_history.push({ ...entry, uploadedAt: new Date().toISOString() });
  if (data.upload_history.length > 20) data.upload_history.shift();
  write(data);
}

module.exports = { read, write, setTimestamp, addUploadHistory };
