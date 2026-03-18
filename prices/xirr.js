const XIRRLib = require('xirr');

/**
 * Estimate SIP start date from total invested and monthly amount.
 */
function estimateStartDate(totalInvested, monthlyAmount) {
  if (!monthlyAmount || monthlyAmount <= 0) {
    return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  }
  const months = Math.round(totalInvested / monthlyAmount);
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

/**
 * Generate monthly SIP cash flows from startDate to today.
 * Each flow is a negative amount (outflow).
 */
function generateCashFlows(monthlyAmount, startDate) {
  const flows = [];
  const now = new Date();
  const current = new Date(startDate);

  while (current <= now) {
    flows.push({ amount: -monthlyAmount, when: new Date(current) });
    current.setMonth(current.getMonth() + 1);
  }
  return flows;
}

/**
 * Compute XIRR for a section (e.g. Nitin's MFs, Indumati's MFs, ETFs).
 * @param {Array<{amount: number, start_date?: string, status: string}>} sips
 * @param {number} currentValue - total current value of all holdings in this section
 * @returns {number} XIRR as % (e.g. 11.3 means 11.3% p.a.)
 */
function computeSectionXIRR(sips, currentValue) {
  if (!sips || sips.length === 0 || currentValue <= 0) return 0;

  const activeSips = sips.filter(s => s.status === 'active' && s.amount > 0);
  if (activeSips.length === 0) return 0;

  const allFlows = [];

  for (const sip of activeSips) {
    const startDate = sip.start_date
      ? new Date(sip.start_date)
      : estimateStartDate(currentValue, sip.amount);
    const flows = generateCashFlows(sip.amount, startDate);
    allFlows.push(...flows);
  }

  if (allFlows.length === 0) return 0;

  // Terminal positive cash flow = current value today
  allFlows.push({ amount: currentValue, when: new Date() });

  try {
    const rate = XIRRLib(allFlows);
    return Math.round(rate * 10000) / 100; // convert to % with 2dp
  } catch {
    return 0;
  }
}

module.exports = { computeSectionXIRR, estimateStartDate, generateCashFlows };
