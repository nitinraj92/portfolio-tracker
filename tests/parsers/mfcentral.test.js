const parse = require('../../parsers/mfcentral');

const NITIN_CSV = '/Users/nitinraj/Documents/Wealth_management/portifolio-data/cas_detailed_report_2026_03_18_142615.csv';
const INDUMATI_XLSX = '/Users/nitinraj/Documents/Wealth_management/portifolio-data/cas_detailed_report_2026_03_18_143904.xlsx';

test('Nitin CSV detected by PAN', () => {
  const result = parse(NITIN_CSV);
  expect(result.holder).toBe('nitin');
});

test('Indumati XLSX detected by PAN', () => {
  const result = parse(INDUMATI_XLSX);
  expect(result.holder).toBe('indumati');
});

test('returns holdings array with required fields', () => {
  const { holdings } = parse(NITIN_CSV);
  expect(Array.isArray(holdings)).toBe(true);
  expect(holdings.length).toBeGreaterThan(0);
  const h = holdings[0];
  expect(h).toHaveProperty('scheme');
  expect(h).toHaveProperty('units');
  expect(h).toHaveProperty('invested');
  expect(h).toHaveProperty('currentValue');
  expect(h).toHaveProperty('plAbsolute');
  expect(h).toHaveProperty('plan');
});

test('skips zero-balance schemes', () => {
  const { holdings } = parse(NITIN_CSV);
  holdings.forEach(h => {
    expect(h.units).toBeGreaterThan(0);
    expect(h.invested).toBeGreaterThan(0);
  });
});

test('infers plan from scheme name', () => {
  const { holdings } = parse(NITIN_CSV);
  holdings.forEach(h => {
    expect(['Direct', 'Regular', 'Unknown']).toContain(h.plan);
  });
  const directCount = holdings.filter(h => h.plan === 'Direct').length;
  expect(directCount).toBeGreaterThan(0);
});

test('plAbsolute is a number', () => {
  const { holdings } = parse(NITIN_CSV);
  holdings.forEach(h => expect(typeof h.plAbsolute).toBe('number'));
});
