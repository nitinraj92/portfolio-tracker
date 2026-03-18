'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('./storage/db');
const parseZerodha = require('./parsers/zerodha');
const parseICICI = require('./parsers/icici');
const parseMFCentral = require('./parsers/mfcentral');
const { refreshPrices, fetchQuote, fetchHistorical } = require('./prices/stocks');
const { refreshMFPrices, lookupSchemeCode } = require('./prices/mf');
const { computeSectionXIRR } = require('./prices/xirr');
const { calcRSI, calcHealth } = require('./prices/technicals');

const ETF_CATEGORIES = {
  'India Equity':    ['MIDQ50ADD', 'MODEFENCE', 'ICICIALPLV'],
  'International':   ['MON100', 'MAHKTECH', 'MASPTOP50'],
  'Precious Metals': ['ICICIGOLD', 'ICICISILVE'],
};

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ─────────────────────────────────────────────────────────

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay(); // 0=Sun,6=Sat
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 555 && mins <= 930; // 9:15 to 15:30
}

function calcPortfolioSummary(data) {
  const { stocks = [], etfs = [], mf_nitin = [], mf_indumati = [], sips = {}, assumptions = {} } = data;

  const stocksInv   = stocks.reduce((s, h) => s + (h.avgCost || 0) * h.qty, 0);
  const stocksVal   = stocks.reduce((s, h) => s + (h.ltp || 0) * h.qty, 0);
  const stocksToday = stocks.reduce((s, h) => s + (h.todayPL || 0), 0);

  const etfsInv   = etfs.reduce((s, h) => s + (h.avgCost || 0) * h.qty, 0);
  const etfsVal   = etfs.reduce((s, h) => s + (h.ltp || 0) * h.qty, 0);
  const etfsToday = etfs.reduce((s, h) => s + (h.todayPL || 0), 0);

  const mfNitinInv   = mf_nitin.reduce((s, h) => s + (h.invested || 0), 0);
  const mfNitinVal   = mf_nitin.reduce((s, h) => s + (h.currentValue || (h.nav || 0) * h.units || 0), 0);
  const mfNitinToday = mf_nitin.reduce((s, h) => s + (h.todayPL || 0), 0);

  const mfInduInv   = mf_indumati.reduce((s, h) => s + (h.invested || 0), 0);
  const mfInduVal   = mf_indumati.reduce((s, h) => s + (h.currentValue || (h.nav || 0) * h.units || 0), 0);
  const mfInduToday = mf_indumati.reduce((s, h) => s + (h.todayPL || 0), 0);

  const totalInvested = stocksInv + etfsInv + mfNitinInv + mfInduInv;
  const totalValue    = stocksVal + etfsVal + mfNitinVal + mfInduVal;
  const totalPL       = totalValue - totalInvested;
  const totalTodayPL  = stocksToday + etfsToday + mfNitinToday + mfInduToday;

  // XIRR per MF section
  const nitinSIPs = (sips.mf || []).filter(s => s.holder === 'nitin' && s.status === 'active');
  const induSIPs  = (sips.mf || []).filter(s => s.holder === 'indumati' && s.status === 'active');
  const nitinXIRR = computeSectionXIRR(nitinSIPs, mfNitinVal);
  const induXIRR  = computeSectionXIRR(induSIPs, mfInduVal);

  // Monthly SIPs total
  const mfSIPs = (sips.mf || []).filter(s => s.status === 'active').reduce((a, s) => a + s.amount, 0);

  // ETF Zerodha: qty × actual LTP from holdings (or stored amount if available)
  const etfPriceMap = {};
  etfs.forEach(e => { etfPriceMap[e.symbol] = e.ltp || e.avgCost || 0; });
  const etfZSIPs = (sips.etf_zerodha || []).filter(s => s.status === 'active').reduce((a, s) => {
    if (s.amount) return a + s.amount; // use stored amount if set
    const price = etfPriceMap[s.symbol] || 0;
    return a + (s.qty || 0) * price;
  }, 0);

  // ETF ICICI: use amount directly (or qty × price if amount missing)
  const etfISIPs = (sips.etf_icici || []).filter(s => s.status === 'active').reduce((a, s) => {
    if (s.amount) return a + s.amount;
    const price = etfPriceMap[s.symbol] || 0;
    return a + (s.qty || 0) * price;
  }, 0);

  const monthlySIPs = mfSIPs + etfZSIPs + etfISIPs + (assumptions.monthlyStockBudget || 0);

  const r = n => Math.round(n * 100) / 100;

  return {
    totalInvested: r(totalInvested),
    totalValue: r(totalValue),
    totalPL: r(totalPL),
    totalPLPct: totalInvested > 0 ? r((totalPL / totalInvested) * 100) : 0,
    totalTodayPL: r(totalTodayPL),
    monthlySIPs: r(monthlySIPs),
    segments: {
      stocks:      { invested: r(stocksInv),   value: r(stocksVal),   pl: r(stocksVal - stocksInv),   todayPL: r(stocksToday) },
      etfs:        { invested: r(etfsInv),     value: r(etfsVal),     pl: r(etfsVal - etfsInv),       todayPL: r(etfsToday) },
      mf_nitin:    { invested: r(mfNitinInv),  value: r(mfNitinVal),  pl: r(mfNitinVal - mfNitinInv), todayPL: r(mfNitinToday), xirr: nitinXIRR },
      mf_indumati: { invested: r(mfInduInv),   value: r(mfInduVal),   pl: r(mfInduVal - mfInduInv),   todayPL: r(mfInduToday),  xirr: induXIRR },
    },
  };
}

// ─── Routes ──────────────────────────────────────────────────────────

app.get('/api/portfolio', (req, res) => {
  const data = db.read();
  const summary = calcPortfolioSummary(data);
  res.json({ ...data, summary, marketOpen: isMarketOpen() });
});

app.post('/api/upload/zerodha', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { stocks, etfs: zEtfs } = parseZerodha(req.file.path);
    const data = db.read();
    const prevICICIEtfs = data.etfs.filter(e => e.source === 'icici');
    data.stocks = stocks;
    data.etfs = [...prevICICIEtfs, ...zEtfs];
    db.write(data);
    db.setTimestamp('zerodha');
    const diff = { stocks: { updated: stocks.length }, etfs: { updated: zEtfs.length } };
    db.addUploadHistory({ source: 'zerodha', filename: req.file.originalname || req.file.filename, changes: diff });
    try { fs.unlinkSync(req.file.path); } catch {}
    res.json({ success: true, diff });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/icici', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const etfs = parseICICI(req.file.path);
    const data = db.read();
    const prevZEtfs = data.etfs.filter(e => e.source === 'zerodha');
    data.etfs = [...prevZEtfs, ...etfs];
    db.write(data);
    db.setTimestamp('icici');
    const diff = { etfs: { updated: etfs.length } };
    db.addUploadHistory({ source: 'icici', filename: req.file.originalname || req.file.filename, changes: diff });
    try { fs.unlinkSync(req.file.path); } catch {}
    res.json({ success: true, diff });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/mfcentral', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { holder, holdings } = parseMFCentral(req.file.path);
    const data = db.read();
    if (holder === 'nitin') {
      data.mf_nitin = holdings;
      db.write(data);
      db.setTimestamp('mfcentral_nitin');
    } else if (holder === 'indumati') {
      data.mf_indumati = holdings;
      db.write(data);
      db.setTimestamp('mfcentral_indumati');
    } else {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'Could not detect holder from PAN in file' });
    }
    const diff = { holder, updated: holdings.length };
    db.addUploadHistory({ source: 'mfcentral_' + holder, filename: req.file.originalname || req.file.filename, changes: diff });
    try { fs.unlinkSync(req.file.path); } catch {}
    res.json({ success: true, diff });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prices/refresh', async (req, res) => {
  try {
    const data = db.read();
    data.stocks = await refreshPrices(data.stocks);
    data.etfs = await refreshPrices(data.etfs);
    data.mf_nitin = await refreshMFPrices(data.mf_nitin);
    data.mf_indumati = await refreshMFPrices(data.mf_indumati);
    data.lastUpdated.prices = new Date().toISOString();
    db.write(data);
    res.json({ success: true, refreshedAt: data.lastUpdated.prices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/technicals/:symbol', async (req, res) => {
  const { symbol } = req.params;
  try {
    const [quote, closes] = await Promise.all([
      fetchQuote(symbol),
      fetchHistorical(symbol),
    ]);
    const rsi = (closes && closes.length >= 15) ? calcRSI(closes) : null;
    const data = db.read();
    const holding = data.stocks.find(s => s.symbol === symbol) || {};
    const health = rsi
      ? calcHealth({ rsi, ltp: quote?.regularMarketPrice, dma50: quote?.fiftyDayAverage, dma200: quote?.twoHundredDayAverage, plPct: holding.plPct || 0 })
      : 'Neutral';
    res.json({ symbol, rsi, health, quote });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mf/lookup', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name query param required' });
  const result = await lookupSchemeCode(name);
  res.json(result || { error: 'Not found' });
});

app.get('/api/settings', (req, res) => {
  const data = db.read();
  res.json({ sips: data.sips, assumptions: data.assumptions });
});

app.post('/api/settings', (req, res) => {
  const data = db.read();
  if (req.body.sips) data.sips = req.body.sips;
  if (req.body.assumptions) data.assumptions = req.body.assumptions;
  db.write(data);
  res.json({ success: true });
});

// GET /api/export — download portfolio as Excel (.xlsx) with 3 sheets
app.get('/api/export', (req, res) => {
  const XLSX = require('xlsx');
  const data = db.read();

  const r = n => Math.round((n || 0) * 100) / 100;

  // Sheet 1: Stocks
  const stockRows = data.stocks.map(h => ({
    Symbol: h.symbol,
    Sector: h.sector || '',
    Qty: h.qty,
    'Avg Cost': r(h.avgCost),
    LTP: r(h.ltp),
    'Invested (₹)': r(h.avgCost * h.qty),
    'Value (₹)': r(h.ltp * h.qty),
    'P&L (₹)': r(h.plAbsolute),
    'P&L %': r(h.plPct),
    "Today P&L (₹)": r(h.todayPL),
    RSI: h.rsi || '',
    Health: h.health || '',
  }));
  const stocksInv = data.stocks.reduce((s, h) => s + (h.avgCost || 0) * h.qty, 0);
  const stocksVal = data.stocks.reduce((s, h) => s + (h.ltp || 0) * h.qty, 0);
  stockRows.push({
    Symbol: 'TOTAL', Sector: '', Qty: '', 'Avg Cost': '',
    LTP: '', 'Invested (₹)': r(stocksInv), 'Value (₹)': r(stocksVal),
    'P&L (₹)': r(stocksVal - stocksInv),
    'P&L %': stocksInv > 0 ? r((stocksVal - stocksInv) / stocksInv * 100) : 0,
    "Today P&L (₹)": r(data.stocks.reduce((s, h) => s + (h.todayPL || 0), 0)),
    RSI: '', Health: '',
  });

  // Sheet 2: ETFs
  const etfRows = data.etfs.map(h => ({
    Symbol: h.symbol,
    Category: h.category || '',
    Qty: h.qty,
    'Avg Cost': r(h.avgCost),
    'NAV/LTP': r(h.ltp),
    'Invested (₹)': r((h.avgCost || 0) * h.qty),
    'Value (₹)': r((h.ltp || 0) * h.qty),
    'P&L (₹)': r(h.plAbsolute),
    'P&L %': r(h.plPct),
    "Today P&L (₹)": r(h.todayPL),
    Source: h.source || '',
  }));
  const etfsInv = data.etfs.reduce((s, h) => s + (h.avgCost || 0) * h.qty, 0);
  const etfsVal = data.etfs.reduce((s, h) => s + (h.ltp || 0) * h.qty, 0);
  etfRows.push({
    Symbol: 'TOTAL', Category: '', Qty: '', 'Avg Cost': '',
    'NAV/LTP': '', 'Invested (₹)': r(etfsInv), 'Value (₹)': r(etfsVal),
    'P&L (₹)': r(etfsVal - etfsInv),
    'P&L %': etfsInv > 0 ? r((etfsVal - etfsInv) / etfsInv * 100) : 0,
    "Today P&L (₹)": r(data.etfs.reduce((s, h) => s + (h.todayPL || 0), 0)),
    Source: '',
  });

  // Sheet 3: Mutual Funds (combined)
  const allMF = [
    ...data.mf_nitin.map(h => ({ ...h, holder: 'Nitin' })),
    ...data.mf_indumati.map(h => ({ ...h, holder: 'Indumati' })),
  ];
  const mfRows = allMF.map(h => {
    const val = h.currentValue || (h.nav || 0) * h.units;
    return {
      Holder: h.holder,
      Scheme: h.scheme,
      Plan: h.plan || '',
      Units: h.units,
      'NAV': r(h.nav),
      'Invested (₹)': r(h.invested),
      'Value (₹)': r(val),
      'P&L (₹)': r(h.plAbsolute),
      'P&L %': r(h.plPct),
      "Today P&L (₹)": r(h.todayPL),
    };
  });
  const mfInv = allMF.reduce((s, h) => s + (h.invested || 0), 0);
  const mfVal = allMF.reduce((s, h) => s + (h.currentValue || (h.nav || 0) * h.units || 0), 0);
  mfRows.push({
    Holder: 'TOTAL', Scheme: '', Plan: '', Units: '',
    NAV: '', 'Invested (₹)': r(mfInv), 'Value (₹)': r(mfVal),
    'P&L (₹)': r(mfVal - mfInv),
    'P&L %': mfInv > 0 ? r((mfVal - mfInv) / mfInv * 100) : 0,
    "Today P&L (₹)": r(allMF.reduce((s, h) => s + (h.todayPL || 0), 0)),
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), 'Stocks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(etfRows), 'ETFs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mfRows), 'Mutual Funds');

  const date = new Date().toISOString().slice(0, 10);
  const filename = 'portfolio-' + date + '.xlsx';
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/flush — clear all holdings, keep SIPs/assumptions/scheme codes
app.post('/api/flush', (req, res) => {
  const data = db.read();
  data.stocks = [];
  data.etfs = [];
  data.mf_nitin = [];
  data.mf_indumati = [];
  data.price_history_cache = {};
  data.upload_history = [];
  data.lastUpdated = { zerodha: null, icici: null, mfcentral_nitin: null, mfcentral_indumati: null, prices: null };
  // Keep: sips, assumptions, mf_scheme_codes
  db.write(data);
  res.json({ success: true, message: 'All holdings cleared. SIPs and assumptions preserved.' });
});

// ─── Auto-refresh ─────────────────────────────────────────────────────

let refreshTimer = null;

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!isMarketOpen()) return;
    console.log('[server] Auto-refreshing prices...');
    try {
      const data = db.read();
      data.stocks = await refreshPrices(data.stocks);
      data.etfs = await refreshPrices(data.etfs);
      data.lastUpdated.prices = new Date().toISOString();
      db.write(data);
    } catch (err) {
      console.error('[server] Auto-refresh error:', err.message);
    }
  }, 60 * 1000);
}

// ─── Start ─────────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Portfolio Tracker running at http://localhost:' + PORT);
    scheduleRefresh();
  });
}

module.exports = app;
