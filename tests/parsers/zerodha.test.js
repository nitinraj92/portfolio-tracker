const path = require('path');
const parse = require('../../parsers/zerodha');

const REAL_FILE = '/Users/nitinraj/Documents/Wealth_management/holdings-FXD037.xlsx';

test('returns stocks and etfs arrays', () => {
  const result = parse(REAL_FILE);
  expect(result).toHaveProperty('stocks');
  expect(result).toHaveProperty('etfs');
  expect(Array.isArray(result.stocks)).toBe(true);
  expect(Array.isArray(result.etfs)).toBe(true);
});

test('stocks have required fields', () => {
  const { stocks } = parse(REAL_FILE);
  expect(stocks.length).toBeGreaterThan(0);
  const s = stocks[0];
  expect(s).toHaveProperty('symbol');
  expect(s).toHaveProperty('qty');
  expect(s).toHaveProperty('avgCost');
  expect(s).toHaveProperty('prevClose');
  expect(s).toHaveProperty('todayPL');
  expect(s).toHaveProperty('isin');
  expect(s).toHaveProperty('sector');
  expect(s.source).toBe('zerodha');
});

test('ETFs are separated from stocks', () => {
  const { stocks, etfs } = parse(REAL_FILE);
  const stockSymbols = stocks.map(s => s.symbol);
  const etfSymbols = etfs.map(e => e.symbol);
  expect(stockSymbols).toContain('HDFCBANK');
  expect(etfSymbols).toContain('MON100');
  expect(stockSymbols).not.toContain('MON100');
  expect(etfSymbols).not.toContain('HDFCBANK');
});

test('strips -E suffix from ETF symbols', () => {
  const { etfs } = parse(REAL_FILE);
  etfs.forEach(e => expect(e.symbol).not.toMatch(/-E$/));
});

test('todayPL is (ltp - prevClose) * qty', () => {
  const { stocks } = parse(REAL_FILE);
  stocks.forEach(s => {
    const expected = (s.ltp - s.prevClose) * s.qty;
    expect(s.todayPL).toBeCloseTo(expected, 1);
  });
});
