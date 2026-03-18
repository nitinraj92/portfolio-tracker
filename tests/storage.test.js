const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.PORTFOLIO_PATH = path.join(os.tmpdir(), `portfolio-test-${Date.now()}.json`);
const db = require('../storage/db');

afterEach(() => {
  if (fs.existsSync(process.env.PORTFOLIO_PATH)) {
    fs.unlinkSync(process.env.PORTFOLIO_PATH);
  }
});

test('read returns default structure when file missing', () => {
  const data = db.read();
  expect(data).toHaveProperty('stocks');
  expect(data.stocks).toEqual([]);
  expect(data).toHaveProperty('lastUpdated');
});

test('write then read roundtrips data', () => {
  const data = db.read();
  data.stocks = [{ symbol: 'TEST', qty: 10 }];
  db.write(data);
  const result = db.read();
  expect(result.stocks).toHaveLength(1);
  expect(result.stocks[0].symbol).toBe('TEST');
});

test('setTimestamp updates lastUpdated for a source', () => {
  db.setTimestamp('zerodha');
  const data = db.read();
  expect(data.lastUpdated.zerodha).toBeTruthy();
  expect(new Date(data.lastUpdated.zerodha).getTime()).toBeLessThanOrEqual(Date.now());
});

test('addUploadHistory appends entry and keeps last 20', () => {
  for (let i = 0; i < 22; i++) {
    db.addUploadHistory({ source: 'zerodha', filename: `file${i}.xlsx`, changes: {} });
  }
  const data = db.read();
  expect(data.upload_history.length).toBe(20);
  expect(data.upload_history[19].filename).toBe('file21.xlsx');
});
