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
  const mfSIPs  = (sips.mf || []).filter(s => s.status === 'active').reduce((a, s) => a + s.amount, 0);
  const etfZSIPs = (sips.etf_zerodha || []).filter(s => s.status === 'active').reduce((a, s) => a + s.qty * 220, 0);
  const etfISIPs = (sips.etf_icici || []).filter(s => s.status === 'active').reduce((a, s) => a + s.amount, 0);
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
