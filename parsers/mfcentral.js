const XLSX = require('xlsx');

const PAN_MAP = {
  'BNXPG7344E': 'nitin',
  'BPCPR7121F': 'indumati',
};

function inferPlan(schemeName) {
  const n = String(schemeName || '').toLowerCase();
  if (n.includes('direct plan') || n.includes('direct growth') || n.includes('-direct')) return 'Direct';
  if (n.includes('regular plan') || n.includes('regular growth') || n.includes('-regular') || n.includes('regular')) return 'Regular';
  return 'Unknown';
}

function detectPAN(wb) {
  // Always use first sheet for PAN detection (metadata rows)
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  for (const row of rows.slice(0, 12)) {
    for (const cell of row) {
      const val = String(cell).trim();
      if (PAN_MAP[val]) return PAN_MAP[val];
    }
  }
  return 'unknown';
}

function parseRows(rows) {
  return rows
    .filter(row => {
      const invested = Number(row['Invested Value']) || 0;
      const units = Number(row['Units']) || 0;
      return invested > 0 && units > 0;
    })
    .map(row => {
      const scheme = String(row['Scheme Name'] || '').trim();
      const invested = Number(row['Invested Value']) || 0;
      const currentValue = Number(row['Current Value']) || 0;
      const plAbsolute = Number(row['Returns']) || 0;
      const units = Number(row['Units']) || 0;
      const plan = inferPlan(scheme);
      const nav = units > 0 ? currentValue / units : 0;

      return {
        scheme,
        plan,
        units: Math.round(units * 1000) / 1000,
        invested: Math.round(invested * 100) / 100,
        currentValue: Math.round(currentValue * 100) / 100,
        plAbsolute: Math.round(plAbsolute * 100) / 100,
        plPct: invested > 0 ? Math.round((plAbsolute / invested) * 10000) / 100 : 0,
        nav: Math.round(nav * 10000) / 10000,
        prevNav: null,
        todayPL: 0,
        schemeCode: null,
      };
    });
}

function parse(filePath) {
  const wb = XLSX.readFile(filePath);
  const holder = detectPAN(wb);

  // For data parsing: use 'Portfolio Details' sheet if it exists (Indumati XLSX), else first sheet
  const sheetName = wb.SheetNames.includes('Portfolio Details') ? 'Portfolio Details' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // Header is at row 12 (1-indexed) = 0-indexed row 11 — skip first 11 metadata rows
  const range = XLSX.utils.decode_range(ws['!ref']);
  range.s.r = 11;
  ws['!ref'] = XLSX.utils.encode_range(range);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });

  return { holder, holdings: parseRows(rows) };
}

module.exports = parse;
