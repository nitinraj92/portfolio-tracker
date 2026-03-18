// portfolio-tracker/tests/integration.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');

// Use a temp file to avoid writing to real portfolio.json
process.env.PORTFOLIO_PATH = path.join(os.tmpdir(), 'portfolio-integration-' + Date.now() + '.json');

const db = require('../storage/db');
const parseZerodha = require('../parsers/zerodha');
const parseICICI = require('../parsers/icici');
const parseMFCentral = require('../parsers/mfcentral');

const ZERODHA_FILE = '/Users/nitinraj/Documents/Wealth_management/holdings-FXD037.xlsx';
const ICICI_FILE   = '/Users/nitinraj/Documents/Wealth_management/portifolio-data/8504242478_Eqportfolio.csv';
const NITIN_MF     = '/Users/nitinraj/Documents/Wealth_management/portifolio-data/cas_detailed_report_2026_03_18_142615.csv';
const INDUMATI_MF  = '/Users/nitinraj/Documents/Wealth_management/portifolio-data/cas_detailed_report_2026_03_18_143904.xlsx';

afterAll(() => {
  if (fs.existsSync(process.env.PORTFOLIO_PATH)) {
    fs.unlinkSync(process.env.PORTFOLIO_PATH);
  }
});

test('Zerodha parse: 14 stocks and 5 ETFs', () => {
  const { stocks, etfs } = parseZerodha(ZERODHA_FILE);
  expect(stocks.length).toBe(14);
  expect(etfs.length).toBe(5);
});

test('ICICI parse: 3 ETFs', () => {
  const etfs = parseICICI(ICICI_FILE);
  expect(etfs.length).toBe(3);
});

test('MFCentral Nitin: detected + active holdings', () => {
  const { holder, holdings } = parseMFCentral(NITIN_MF);
  expect(holder).toBe('nitin');
  expect(holdings.length).toBeGreaterThan(0);
  holdings.forEach(h => {
    expect(h.invested).toBeGreaterThan(0);
    expect(h.units).toBeGreaterThan(0);
  });
});

test('MFCentral Indumati: detected + active holdings', () => {
  const { holder, holdings } = parseMFCentral(INDUMATI_MF);
  expect(holder).toBe('indumati');
  expect(holdings.length).toBeGreaterThan(0);
});

test('full pipeline: store all 4 sources in db and read back', () => {
  const { stocks, etfs: zEtfs } = parseZerodha(ZERODHA_FILE);
  const iEtfs = parseICICI(ICICI_FILE);
  const { holder: h1, holdings: mfNitin } = parseMFCentral(NITIN_MF);
  const { holder: h2, holdings: mfIndu } = parseMFCentral(INDUMATI_MF);

  const data = db.read();
  data.stocks = stocks;
  data.etfs = [...zEtfs, ...iEtfs];
  data.mf_nitin = mfNitin;
  data.mf_indumati = mfIndu;
  db.write(data);

  const loaded = db.read();
  expect(loaded.stocks.length).toBe(stocks.length);
  expect(loaded.etfs.length).toBe(zEtfs.length + iEtfs.length);
  expect(loaded.mf_nitin.length).toBeGreaterThan(0);
  expect(loaded.mf_indumati.length).toBeGreaterThan(0);
});

test('no symbol overlap between stocks and ETFs', () => {
  const { stocks, etfs } = parseZerodha(ZERODHA_FILE);
  const stockSymbols = new Set(stocks.map(s => s.symbol));
  etfs.forEach(e => {
    expect(stockSymbols.has(e.symbol)).toBe(false);
  });
});

test('total MF invested > 800000', () => {
  const { holdings: mfNitin } = parseMFCentral(NITIN_MF);
  const { holdings: mfIndu } = parseMFCentral(INDUMATI_MF);
  const total = [...mfNitin, ...mfIndu].reduce((s, h) => s + h.invested, 0);
  expect(total).toBeGreaterThan(800000);
});
