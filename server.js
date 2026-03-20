'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('./storage/db');
const parseZerodha = require('./parsers/zerodha');
const parseICICI = require('./parsers/icici');
const parseMFCentral = require('./parsers/mfcentral');
const parseZerodhaPnL = require('./parsers/zerodha_pnl');
const { refreshPrices, fetchQuote, fetchHistorical } = require('./prices/stocks');
const { refreshMFPrices, lookupSchemeCode } = require('./prices/mf');
const { computeSectionXIRR, computeCombinedXIRR } = require('./prices/xirr');
const { calcRSI, calcHealth } = require('./prices/technicals');

const ETF_CATEGORIES = {
  'India Equity':    ['MIDQ50ADD', 'MODEFENCE', 'ICICIALPLV'],
  'International':   ['MON100', 'MAHKTECH', 'MASPTOP50'],
  'Precious Metals': ['ICICIGOLD', 'ICICISILVE'],
};

const app = express();

// Save uploaded files permanently to data_sources/ with original filename
const DATA_SOURCES_DIR = path.join(__dirname, 'data_sources');
if (!require('fs').existsSync(DATA_SOURCES_DIR)) require('fs').mkdirSync(DATA_SOURCES_DIR);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DATA_SOURCES_DIR),
    filename:    (req, file, cb) => cb(null, file.originalname),
  })
});

// Extract file metadata (statement dates) from uploaded Zerodha/CAS files
function extractFileMetadata(filePath, sourceType) {
  const XLSX = require('xlsx');
  try {
    const wb   = XLSX.readFile(filePath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (sourceType === 'zerodha') {
      // Row 11 (0-indexed 10): "Equity Holdings Statement as on 2026-03-18"
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const cell = String(rows[i][1] || rows[i][0] || '');
        if (/equity holdings statement/i.test(cell)) return { label: cell.trim() };
      }
    }
    if (sourceType === 'realized_pnl') {
      // Row 11 (0-indexed 10): "P&L Statement for Equity from 2025-04-01 to 2026-03-18"
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const cell = String(rows[i][1] || rows[i][0] || '');
        if (/p&l statement/i.test(cell)) return { label: cell.trim() };
      }
    }
    if (sourceType === 'mfcentral') {
      // Rows 6-7: From Date / To Date
      let fromDate = '', toDate = '';
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const key = String(rows[i][0] || rows[i][1] || '').trim();
        const val = String(rows[i][1] || rows[i][2] || '').trim();
        if (/from date/i.test(key)) fromDate = val;
        if (/to date/i.test(key))   toDate   = val;
      }
      if (fromDate && toDate) return { fromDate, toDate, label: 'CAS from ' + fromDate + ' to ' + toDate };
    }
  } catch {}
  return null;
}

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
  const { stocks = [], etfs = [], mf_nitin = [], mf_indumati = [], sips = {}, assumptions = {}, realized_pnl = {} } = data;

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

  const realizedPLAmt = realized_pnl.totalRealizedPL || 0;
  const totalInvested = stocksInv + etfsInv + mfNitinInv + mfInduInv;
  const totalValue    = stocksVal + etfsVal + mfNitinVal + mfInduVal;
  const totalPL       = totalValue - totalInvested;
  const totalTodayPL  = stocksToday + etfsToday + mfNitinToday + mfInduToday;

  // XIRR per MF section — pass actual invested from CAS as ground truth
  const nitinSIPs = (sips.mf || []).filter(s => s.holder === 'nitin' && s.status === 'active');
  const induSIPs  = (sips.mf || []).filter(s => s.holder === 'indumati' && s.status === 'active');
  const nitinXIRR = computeSectionXIRR(nitinSIPs, mfNitinVal, mfNitinInv);
  const induXIRR  = computeSectionXIRR(induSIPs,  mfInduVal,  mfInduInv);

  // Combined XIRR across all MFs
  const combinedMFXIRR = computeCombinedXIRR([
    { sips: nitinSIPs, currentValue: mfNitinVal, actualInvested: mfNitinInv },
    { sips: induSIPs,  currentValue: mfInduVal,  actualInvested: mfInduInv  },
  ]);

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

  const unrealizedPL  = r(totalPL);
  const realizedPL    = r(realizedPLAmt);
  const grandTotalPL  = r(unrealizedPL + realizedPL);
  const grandTotalPct = totalInvested > 0 ? r((grandTotalPL / totalInvested) * 100) : 0;

  // "Net Invested" = total deployed minus what's been returned via realized gains
  const netInvested = r(totalInvested - realizedPLAmt);

  return {
    totalInvested: netInvested,
    totalValue: r(totalValue),
    unrealizedPL,
    unrealizedPLPct: totalInvested > 0 ? r((unrealizedPL / totalInvested) * 100) : 0,
    realizedPL,
    realizedWinners: realized_pnl.winners || 0,
    realizedLosers:  realized_pnl.losers  || 0,
    realizedCount:   (realized_pnl.entries || []).length,
    grandTotalPL,
    grandTotalPct,
    totalTodayPL: r(totalTodayPL),
    monthlySIPs:  r(monthlySIPs),
    segments: {
      stocks: {
        invested:   r(stocksInv),
        value:      r(stocksVal),
        pl:         r(stocksVal - stocksInv),               // unrealized
        realizedPL: r(realizedPLAmt),                       // realized (stocks only)
        totalPL:    r(stocksVal - stocksInv + realizedPLAmt), // combined
        todayPL:    r(stocksToday),
      },
      etfs:        { invested: r(etfsInv),    value: r(etfsVal),    pl: r(etfsVal - etfsInv),       todayPL: r(etfsToday) },
      mf_nitin:    { invested: r(mfNitinInv), value: r(mfNitinVal), pl: r(mfNitinVal - mfNitinInv), todayPL: r(mfNitinToday), xirr: nitinXIRR },
      mf_indumati: { invested: r(mfInduInv),  value: r(mfInduVal),  pl: r(mfInduVal - mfInduInv),   todayPL: r(mfInduToday),  xirr: induXIRR },
      mf_combined: {
        invested: r(mfNitinInv + mfInduInv),
        value:    r(mfNitinVal + mfInduVal),
        pl:       r((mfNitinVal + mfInduVal) - (mfNitinInv + mfInduInv)),
        todayPL:  r(mfNitinToday + mfInduToday),
        xirr:     combinedMFXIRR,
      },
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
    const meta = extractFileMetadata(req.file.path, 'zerodha');
    const data = db.read();
    const prevICICIEtfs = data.etfs.filter(e => e.source === 'icici');
    data.stocks = stocks;
    data.etfs = [...prevICICIEtfs, ...zEtfs];
    if (!data.source_metadata) data.source_metadata = {};
    data.source_metadata.zerodha = meta;
    db.write(data);
    db.setTimestamp('zerodha');
    const diff = { stocks: { updated: stocks.length }, etfs: { updated: zEtfs.length } };
    db.addUploadHistory({ source: 'zerodha', filename: req.file.originalname, changes: diff });
    // File already saved to data_sources/ by multer — no unlink needed
    res.json({ success: true, diff, meta });
  } catch (err) {
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
    db.addUploadHistory({ source: 'icici', filename: req.file.originalname, changes: diff });
    res.json({ success: true, diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/mfcentral', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { holder, holdings } = parseMFCentral(req.file.path);
    const meta = extractFileMetadata(req.file.path, 'mfcentral');
    const data = db.read();
    if (!data.source_metadata) data.source_metadata = {};
    if (holder === 'nitin') {
      data.mf_nitin = holdings;
      data.source_metadata.mfcentral_nitin = meta;
      db.write(data);
      db.setTimestamp('mfcentral_nitin');
    } else if (holder === 'indumati') {
      data.mf_indumati = holdings;
      data.source_metadata.mfcentral_indumati = meta;
      db.write(data);
      db.setTimestamp('mfcentral_indumati');
    } else {
      return res.status(400).json({ error: 'Could not detect holder from PAN in file' });
    }
    const diff = { holder, updated: holdings.length };
    db.addUploadHistory({ source: 'mfcentral_' + holder, filename: req.file.originalname, changes: diff });
    res.json({ success: true, diff, meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prices/refresh', async (req, res) => {
  try {
    const data = db.read();
    data.stocks = await refreshPrices(data.stocks);
    data.etfs = await refreshPrices(data.etfs);
    // Pass mf_scheme_codes by reference so lookups persist into data.mf_scheme_codes
    // and are saved in the single db.write() below
    data.mf_nitin    = await refreshMFPrices(data.mf_nitin,    data.mf_scheme_codes);
    data.mf_indumati = await refreshMFPrices(data.mf_indumati, data.mf_scheme_codes);
    data.lastUpdated.prices = new Date().toISOString();
    db.write(data); // Single write — stocks/etfs/mf all correct, scheme codes persisted
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

// POST /api/upload/realized-pnl — upload Zerodha Tax P&L XLSX (supports multiple uploads, aggregated)
app.post('/api/upload/realized-pnl', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const parsed = parseZerodhaPnL(req.file.path);
    const data = db.read();

    // Merge with existing entries (by symbol) — allows uploading multiple P&L files
    const existing = data.realized_pnl?.entries || [];
    const existingMap = {};
    existing.forEach(e => { existingMap[e.symbol] = e; });

    // Merge: add new entries, update existing ones
    parsed.entries.forEach(e => {
      if (existingMap[e.symbol]) {
        // Add to existing symbol's values
        existingMap[e.symbol].qty += e.qty;
        existingMap[e.symbol].buyValue  = Math.round((existingMap[e.symbol].buyValue  + e.buyValue)  * 100) / 100;
        existingMap[e.symbol].sellValue = Math.round((existingMap[e.symbol].sellValue + e.sellValue) * 100) / 100;
        existingMap[e.symbol].realizedPL = Math.round((existingMap[e.symbol].realizedPL + e.realizedPL) * 100) / 100;
      } else {
        existingMap[e.symbol] = { ...e };
      }
    });

    const merged = Object.values(existingMap);
    const totalRealizedPL  = Math.round(merged.reduce((s, e) => s + e.realizedPL, 0) * 100) / 100;
    const totalBuyValue    = Math.round(merged.reduce((s, e) => s + e.buyValue, 0) * 100) / 100;
    const totalSellValue   = Math.round(merged.reduce((s, e) => s + e.sellValue, 0) * 100) / 100;
    const winners          = merged.filter(e => e.realizedPL > 0).length;
    const losers           = merged.filter(e => e.realizedPL < 0).length;

    const meta = extractFileMetadata(req.file.path, 'realized_pnl');
    if (!data.source_metadata) data.source_metadata = {};
    data.source_metadata.realized_pnl = meta;
    data.realized_pnl = { entries: merged, totalRealizedPL, totalBuyValue, totalSellValue, winners, losers };
    db.write(data);
    db.setTimestamp('realized_pnl');

    const diff = { symbols: parsed.entries.length, totalRealizedPL: parsed.totalRealizedPL };
    db.addUploadHistory({ source: 'realized_pnl', filename: req.file.originalname, changes: diff });
    // File saved to data_sources/ — no unlink
    res.json({ success: true, diff, totalRealizedPL, winners, losers, totalSymbols: merged.length, meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/flush/realized-pnl — clear only realized P&L data
app.post('/api/flush/realized-pnl', (req, res) => {
  const data = db.read();
  data.realized_pnl = { entries: [], totalRealizedPL: 0, totalBuyValue: 0, totalSellValue: 0, winners: 0, losers: 0 };
  data.lastUpdated.realized_pnl = null;
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Portfolio Tracker running at http://localhost:' + PORT);
    scheduleRefresh();
  });
}

module.exports = app;
