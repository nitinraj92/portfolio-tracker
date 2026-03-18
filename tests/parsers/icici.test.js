const parse = require('../../parsers/icici');

const REAL_FILE = '/Users/nitinraj/Documents/Wealth_management/portifolio-data/8504242478_Eqportfolio.csv';

test('returns array of ETF holdings', () => {
  const etfs = parse(REAL_FILE);
  expect(Array.isArray(etfs)).toBe(true);
  expect(etfs.length).toBeGreaterThan(0);
});

test('recognises ICICIGOLD (already full name in file)', () => {
  const etfs = parse(REAL_FILE);
  const syms = etfs.map(e => e.symbol);
  expect(syms).toContain('ICICIGOLD');
});

test('recognises ICICIALPLV', () => {
  const etfs = parse(REAL_FILE);
  const syms = etfs.map(e => e.symbol);
  expect(syms).toContain('ICICIALPLV');
});

test('symbol map works for short codes', () => {
  // Just verify the map exists in the module — test by parsing and checking no short codes remain
  const etfs = parse(REAL_FILE);
  etfs.forEach(e => {
    expect(['ICIGOL', 'ICIA30', 'ICIPSE']).not.toContain(e.symbol);
  });
});

test('todayPL derived from pct change', () => {
  const etfs = parse(REAL_FILE);
  etfs.forEach(e => {
    expect(typeof e.todayPL).toBe('number');
    expect(typeof e.prevClose).toBe('number');
    expect(e.prevClose).toBeGreaterThan(0);
  });
});

test('each ETF has required fields', () => {
  const etfs = parse(REAL_FILE);
  const e = etfs[0];
  expect(e).toHaveProperty('symbol');
  expect(e).toHaveProperty('qty');
  expect(e).toHaveProperty('avgCost');
  expect(e).toHaveProperty('ltp');
  expect(e).toHaveProperty('todayPL');
  expect(e).toHaveProperty('category');
  expect(e.source).toBe('icici');
});
