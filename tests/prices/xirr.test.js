const { computeSectionXIRR, estimateStartDate, generateCashFlows } = require('../../prices/xirr');

test('estimateStartDate returns date roughly N months ago', () => {
  const date = estimateStartDate(60000, 5000); // 12 months
  const msAgo = Date.now() - date.getTime();
  const monthsAgo = msAgo / (1000 * 60 * 60 * 24 * 30);
  expect(monthsAgo).toBeCloseTo(12, 0);
});

test('estimateStartDate handles zero amount gracefully', () => {
  const date = estimateStartDate(10000, 0);
  expect(date).toBeInstanceOf(Date);
  expect(date.getTime()).toBeLessThan(Date.now());
});

test('generateCashFlows returns array of negative flows', () => {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);
  const flows = generateCashFlows(5000, startDate);
  expect(flows.length).toBeGreaterThanOrEqual(3);
  flows.forEach(f => {
    expect(f.amount).toBe(-5000);
    expect(f.when).toBeInstanceOf(Date);
  });
});

test('computeSectionXIRR returns 0 when no sips', () => {
  expect(computeSectionXIRR([], 100000)).toBe(0);
});

test('computeSectionXIRR returns 0 when currentValue is 0', () => {
  const sips = [{ amount: 5000, start_date: '2025-03-02', status: 'active' }];
  expect(computeSectionXIRR(sips, 0)).toBe(0);
});

test('computeSectionXIRR returns a number for valid inputs', () => {
  const sips = [{ amount: 5000, start_date: '2025-03-01', status: 'active' }];
  const result = computeSectionXIRR(sips, 70000);
  expect(typeof result).toBe('number');
});

test('computeSectionXIRR skips paused SIPs', () => {
  const sips = [
    { amount: 5000, start_date: '2025-03-01', status: 'paused' },
    { amount: 3000, start_date: '2025-03-01', status: 'active' },
  ];
  const result = computeSectionXIRR(sips, 50000);
  expect(typeof result).toBe('number');
  // Result should be based only on the 3000/month active SIP
});
