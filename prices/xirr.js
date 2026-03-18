const XIRRLib = require('xirr');

/**
 * Generate monthly cash flows from startDate to today.
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
 * Compute XIRR for a portfolio section.
 *
 * Uses actualInvested (from CAS) as ground truth for total capital deployed.
 * Spreads that amount evenly over the investment period (from earliest SIP start_date
 * to today) to generate monthly cash flows — this is more accurate than using
 * theoretical SIP amounts which diverge from reality due to lump sums, step-ups,
 * and exact timing differences.
 *
 * @param {Array<{amount, start_date, status}>} sips
 * @param {number} currentValue - total current value of all holdings
 * @param {number} actualInvested - actual total invested from CAS (ground truth)
 * @returns {number} XIRR as % p.a. (e.g. 11.3 = 11.3%)
 */
function computeSectionXIRR(sips, currentValue, actualInvested) {
  if (!sips || sips.length === 0 || currentValue <= 0) return 0;

  const activeSips = sips.filter(s => s.status === 'active' && s.amount > 0);
  if (activeSips.length === 0) return 0;

  // Find the earliest SIP start date
  const datesWithStart = activeSips.filter(s => s.start_date).map(s => new Date(s.start_date));
  if (datesWithStart.length === 0) return 0;

  const startDate = new Date(Math.min(...datesWithStart.map(d => d.getTime())));
  const now = new Date();

  // Months elapsed since first SIP
  const months = (now.getFullYear() - startDate.getFullYear()) * 12
               + (now.getMonth() - startDate.getMonth());
  if (months <= 0) return 0;

  // Use actual invested if provided (CAS ground truth), else fall back to SIP total
  const totalInvested = (actualInvested && actualInvested > 0)
    ? actualInvested
    : activeSips.reduce((sum, s) => {
        const d = s.start_date ? new Date(s.start_date) : startDate;
        const m = Math.max(1, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
        return sum + s.amount * m;
      }, 0);

  // Spread total invested evenly as monthly flows from startDate to today
  const monthlyAmount = totalInvested / months;
  const flows = generateCashFlows(monthlyAmount, startDate);
  if (flows.length === 0) return 0;

  flows.push({ amount: currentValue, when: new Date() });

  try {
    const rate = XIRRLib(flows);
    return Math.round(rate * 10000) / 100;
  } catch {
    return 0;
  }
}

/**
 * Compute combined XIRR across multiple sections (e.g. Nitin + Indumati combined).
 */
function computeCombinedXIRR(sections) {
  // sections: array of { sips, currentValue, actualInvested, startDate }
  // Find overall start date, combine all flows
  const allFlows = [];
  let totalCurrentValue = 0;

  for (const sec of sections) {
    const { sips, currentValue, actualInvested } = sec;
    if (!sips || sips.length === 0 || currentValue <= 0) continue;

    const activeSips = sips.filter(s => s.status === 'active' && s.amount > 0);
    if (activeSips.length === 0) continue;

    const datesWithStart = activeSips.filter(s => s.start_date).map(s => new Date(s.start_date));
    if (datesWithStart.length === 0) continue;

    const startDate = new Date(Math.min(...datesWithStart.map(d => d.getTime())));
    const now = new Date();
    const months = (now.getFullYear() - startDate.getFullYear()) * 12
                 + (now.getMonth() - startDate.getMonth());
    if (months <= 0) continue;

    const totalInv = (actualInvested && actualInvested > 0) ? actualInvested
      : activeSips.reduce((sum, s) => {
          const d = s.start_date ? new Date(s.start_date) : startDate;
          const m = Math.max(1, (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth()));
          return sum + s.amount * m;
        }, 0);

    const monthlyAmount = totalInv / months;
    allFlows.push(...generateCashFlows(monthlyAmount, startDate));
    totalCurrentValue += currentValue;
  }

  if (allFlows.length === 0 || totalCurrentValue <= 0) return 0;
  allFlows.push({ amount: totalCurrentValue, when: new Date() });

  try {
    const rate = XIRRLib(allFlows);
    return Math.round(rate * 10000) / 100;
  } catch {
    return 0;
  }
}

module.exports = { computeSectionXIRR, computeCombinedXIRR, generateCashFlows };
