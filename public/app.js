// portfolio-tracker/public/app.js

// ── Sanitize (prevents XSS from scheme names / company names in uploaded files) ──
function sanitize(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── State ──────────────────────────────────────────────────────────────
let portfolio = null;
let settings  = null;
let wealthChart = null;
let countdown = 60;
let countdownTimer = null;
let stockCategory = {};

// ── API ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, opts);
  return r.json();
}

async function loadPortfolio() {
  portfolio = await api('GET', '/api/portfolio');
  renderDashboard();
  renderActiveTab();
}

async function loadSettings() {
  settings = await api('GET', '/api/settings');
  if (activeTab === 'settings') renderSettings();
}

async function loadStockCategory() {
  stockCategory = await api('GET', '/api/stock-category');
}

async function saveStockCategory() {
  if (!portfolio) return;
  const stocks = portfolio.stocks || [];
  const newCategory = {};
  stocks.forEach(h => {
    const sym = h.symbol;
    const pInput = document.querySelector('.sc-input[data-sym="' + sym + '"][data-field="primary"]');
    const sInput = document.querySelector('.sc-input[data-sym="' + sym + '"][data-field="secondary"]');
    const eInput = document.querySelector('.sc-exch[data-sym="' + sym + '"]');
    newCategory[sym] = {
      primary:   parseInt((pInput && pInput.value) || '0') || 0,
      secondary: parseInt((sInput && sInput.value) || '0') || 0,
      exchange:  (eInput && eInput.value) || 'NSE',
    };
  });
  const r = await api('POST', '/api/stock-category', newCategory);
  if (r.success) {
    stockCategory = newCategory;
    renderStocks();
    const btn = document.getElementById('sc-save-btn');
    if (btn) { btn.textContent = '✓ Saved'; setTimeout(() => { if (btn) btn.textContent = 'Save'; }, 1500); }
  }
}

async function triggerRefresh() {
  const btn = document.getElementById('btn-refresh');
  btn.textContent = '⟳ Refreshing...';
  btn.disabled = true;
  await api('POST', '/api/prices/refresh');
  await loadPortfolio();
  btn.textContent = '⟳ Refresh Now';
  btn.disabled = false;
}

async function clearRealizedPnL() {
  if (!confirm('Clear all Realized P&L data? You can re-upload your P&L files again.')) return;
  await api('POST', '/api/flush/realized-pnl');
  await loadPortfolio();
  renderSources();
}

async function flushData() {
  if (!confirm('This will clear ALL holdings (stocks, ETFs, mutual funds) and upload history.\nSIPs and assumptions will be preserved.\n\nAre you sure?')) return;
  const r = await api('POST', '/api/flush');
  if (r.success) { alert('All holdings cleared. You can now re-upload your files.'); await loadPortfolio(); renderSources(); }
}

// ── Format helpers ──────────────────────────────────────────────────────
const fmt    = n => '₹' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN');
const fmtD   = (n, d=2) => '₹' + Math.abs(n||0).toLocaleString('en-IN', { minimumFractionDigits:d, maximumFractionDigits:d });
const fmtPct = n => (n >= 0 ? '+' : '') + Number(n||0).toFixed(2) + '%';
const sign   = n => (n||0) >= 0 ? '+' : '-';
const plCls  = n => (n||0) >= 0 ? 'val-green' : 'val-red';
const dateFmt = iso => iso ? new Date(iso).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Never';
const isStale = iso => !iso || (Date.now() - new Date(iso).getTime()) > 24 * 60 * 60 * 1000;

function healthBadge(h) {
  const icon = h === 'Healthy' ? '🟢' : h === 'Weak' ? '🔴' : '🟡';
  const cls  = h === 'Healthy' ? 'health-healthy' : h === 'Weak' ? 'health-weak' : 'health-neutral';
  return '<span class="health-badge ' + cls + '">' + icon + ' ' + sanitize(h) + '</span>';
}

function week52Bar(ltp, low, high) {
  if (!low || !high || high <= low) return '';
  const pct = Math.min(100, Math.max(0, ((ltp - low) / (high - low)) * 100));
  const color = pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444';
  return '<div class="week52-wrap"><div class="week52-track"><div class="week52-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
    + '<div class="week52-label">₹' + Math.round(low).toLocaleString('en-IN') + '–₹' + Math.round(high).toLocaleString('en-IN') + '</div></div>';
}

function luBadge(iso, id) {
  const el = document.getElementById(id);
  if (!el) return;
  const stale = isStale(iso);
  el.textContent = (stale ? '⚠ ' : '') + dateFmt(iso);
  el.className = 'last-updated-badge' + (stale ? ' stale' : '');
}

// ── Tab switching ───────────────────────────────────────────────────────
let activeTab = 'stocks';
let mfActiveTab = 'nitin';

function switchMFTab(holder) {
  mfActiveTab = holder;
  renderMF();
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'" + tab + "'")) b.classList.add('active');
  });
  renderActiveTab();
}

function renderActiveTab() {
  if (!portfolio) return;
  const map = { stocks: renderStocks, etfs: renderETFs, mf: renderMF, sources: renderSources, wealth: renderWealth };
  if (map[activeTab]) map[activeTab]();
  if (activeTab === 'settings') {
    if (!settings) loadSettings(); else renderSettings();
    renderStockCategory();
  }
}

// ── Dashboard ───────────────────────────────────────────────────────────
function renderDashboard() {
  if (!portfolio) return;
  const { summary, lastUpdated, marketOpen } = portfolio;
  if (!summary) return;

  const ms = document.getElementById('market-status');
  ms.textContent = marketOpen ? '🟢 Market Open' : '🔴 Market Closed';
  ms.className = 'market-badge' + (marketOpen ? ' open' : '');

  const tvEl = document.getElementById('total-value');
  tvEl.textContent = fmt(summary.totalValue);

  document.getElementById('total-invested').textContent = 'Invested: ' + fmt(summary.totalInvested);

  // Unrealized P&L
  const plEl = document.getElementById('total-pl');
  const upl = summary.unrealizedPL || 0;
  plEl.textContent = sign(upl) + fmt(upl);
  plEl.className = 'card-value ' + plCls(upl);
  document.getElementById('total-pl-pct').textContent = '(' + fmtPct(summary.unrealizedPLPct || 0) + ')';

  // Total P&L (combined card: value + % + today as sub-line)
  const gtEl = document.getElementById('grand-total-pl');
  if (gtEl) {
    const gpl = summary.grandTotalPL || 0;
    gtEl.textContent = sign(gpl) + fmt(gpl) + ' (' + fmtPct(summary.grandTotalPct || 0) + ')';
    gtEl.className = 'card-value ' + plCls(gpl);
    const gtPct = document.getElementById('grand-total-pl-pct');
    if (gtPct) gtPct.textContent = '';
    const todaySub = document.getElementById('today-pl-sub');
    if (todaySub) {
      const tdpl = summary.totalTodayPL || 0;
      todaySub.textContent = 'Today: ' + sign(tdpl) + fmt(tdpl);
      todaySub.style.color = tdpl >= 0 ? 'var(--green)' : 'var(--red)';
    }
  }

  document.getElementById('monthly-sips').textContent = fmt(summary.monthlySIPs);

  const rpEl = document.getElementById('realized-pl');
  if (rpEl) {
    const rpl = summary.realizedPL || 0;
    rpEl.textContent = sign(rpl) + fmt(rpl);
    rpEl.className = 'card-value ' + plCls(rpl);
    const rpSub = document.getElementById('realized-pl-sub');
    if (rpSub && summary.realizedCount > 0) {
      rpSub.textContent = summary.realizedCount + ' closed · ' + summary.realizedWinners + 'W / ' + summary.realizedLosers + 'L';
    } else if (rpSub) {
      rpSub.textContent = 'No data — upload P&L file';
    }
  }

  const total = summary.totalValue || 1;
  const segs  = summary.segments || {};
  const mfVal = (segs.mf_nitin?.value || 0) + (segs.mf_indumati?.value || 0);
  const bars  = [
    { label: 'Mutual Funds', val: mfVal,                   color: '#6366f1' },
    { label: 'Stocks',       val: segs.stocks?.value || 0, color: '#f59e0b' },
    { label: 'ETFs',         val: segs.etfs?.value   || 0, color: '#22c55e' },
  ];
  document.getElementById('allocation-bars').innerHTML = bars.map(b => {
    const pct = ((b.val / total) * 100).toFixed(1);
    return '<div class="alloc-row">'
      + '<div class="alloc-label">' + sanitize(b.label) + '</div>'
      + '<div class="alloc-track"><div class="alloc-fill" style="width:' + pct + '%;background:' + b.color + '"></div></div>'
      + '<div class="alloc-pct">' + pct + '%</div></div>';
  }).join('');

  const segDefs = [
    { id: 'seg-stocks',   name: 'Stocks',        seg: segs.stocks },
    { id: 'seg-etfs',     name: 'ETFs',           seg: segs.etfs },
    { id: 'seg-mf-nitin', name: 'MF — Nitin',     seg: segs.mf_nitin },
    { id: 'seg-mf-indu',  name: 'MF — Indumati',  seg: segs.mf_indumati },
  ];
  segDefs.forEach(({ id, name, seg }) => {
    const el = document.getElementById(id);
    if (!el || !seg) return;
    const plPct = seg.invested ? (seg.pl / seg.invested * 100) : 0;

    const extraLines = '';

    el.innerHTML = '<div class="seg-name">' + sanitize(name) + '</div>'
      + '<div class="seg-pl ' + plCls(seg.pl) + '">' + sign(seg.pl) + fmt(seg.pl) + ' (' + fmtPct(plPct) + ')</div>'
      + '<div class="seg-today ' + plCls(seg.todayPL) + '">Today: ' + sign(seg.todayPL) + fmt(seg.todayPL) + '</div>'
      + extraLines
      + (seg.xirr != null ? '<div class="seg-xirr">XIRR ' + seg.xirr.toFixed(1) + '%</div>' : '');
  });

  luBadge(lastUpdated?.zerodha, 'lu-zerodha');
  luBadge(lastUpdated?.zerodha, 'lu-zerodha-etf');
  luBadge(lastUpdated?.icici, 'lu-icici');
  luBadge(lastUpdated?.mfcentral_nitin, 'lu-mf-nitin');
  luBadge(lastUpdated?.mfcentral_indumati, 'lu-mf-indu');
}

// ── Countdown ───────────────────────────────────────────────────────────
function startCountdown() {
  clearInterval(countdownTimer);
  countdown = 60;
  countdownTimer = setInterval(() => {
    countdown--;
    const el = document.getElementById('refresh-countdown');
    if (el) el.textContent = portfolio?.marketOpen ? ('Auto-refresh in ' + countdown + 's') : '';
    if (countdown <= 0) { countdown = 60; if (portfolio?.marketOpen) loadPortfolio(); }
  }, 1000);
}

// ── Stocks Tab ──────────────────────────────────────────────────────────
function renderStocks() {
  if (!portfolio) return;
  const stocks = portfolio.stocks || [];

  function getAccountQtys(h) {
    return stockCategory[h.symbol] || { primary: h.qty, secondary: 0 };
  }

  function withCalcs(h) {
    const inv    = (h.avgCost || 0) * h.qty;
    const val    = (h.ltp || 0) * h.qty;
    const pl     = val - inv;
    const plPct  = inv > 0 ? (pl / inv) * 100 : 0;
    const todayPL = Math.round(((h.todayPLPct || 0) / 100) * (h.ltp || 0) * h.qty * 100) / 100;
    return { ...h, plAbsolute: pl, plPct, todayPL };
  }

  const primaryList   = [];
  const secondaryList = [];
  stocks.forEach(h => {
    const { primary, secondary } = getAccountQtys(h);
    if (primary   > 0) primaryList.push(withCalcs({ ...h, qty: primary }));
    if (secondary > 0) secondaryList.push(withCalcs({ ...h, qty: secondary }));
  });

  function calcSummary(list) {
    const inv     = list.reduce((s, h) => s + (h.avgCost || 0) * h.qty, 0);
    const val     = list.reduce((s, h) => s + (h.ltp || 0) * h.qty, 0);
    const pl      = val - inv;
    const todayPL = list.reduce((s, h) => s + (h.todayPL || 0), 0);
    const winners = list.filter(h => (h.ltp || 0) > (h.avgCost || 0)).length;
    const healthy = list.filter(h => h.health === 'Healthy').length;
    const neutral = list.filter(h => h.health === 'Neutral' || !h.health).length;
    const weak    = list.filter(h => h.health === 'Weak').length;
    return { inv, val, pl, todayPL, winners, healthy, neutral, weak, count: list.length };
  }

  function summaryHtml(s) {
    return '<span>Invested: <strong>' + fmt(s.inv) + '</strong></span>'
      + '<span>Value: <strong>' + fmt(s.val) + '</strong></span>'
      + '<span class="' + plCls(s.pl) + '">P&amp;L: <strong>' + sign(s.pl) + fmt(s.pl) + '</strong></span>'
      + '<span class="' + plCls(s.todayPL) + '">Today: <strong>' + sign(s.todayPL) + fmt(s.todayPL) + '</strong></span>'
      + '<span>Winners: <strong style="color:var(--green)">' + s.winners + '</strong> / Losers: <strong style="color:var(--red)">' + (s.count - s.winners) + '</strong></span>'
      + '<span>🟢 ' + s.healthy + ' &nbsp;🟡 ' + s.neutral + ' &nbsp;🔴 ' + s.weak + '</span>';
  }

  document.getElementById('stocks-summary').innerHTML = summaryHtml(calcSummary([...primaryList, ...secondaryList]));

  const sortBy = (document.getElementById('stocks-sort') || {}).value || 'plPct';
  const filter = ((document.getElementById('stocks-filter') || {}).value || '').toLowerCase();
  const sortFns = {
    plPct:      (a, b) => (a.plPct || 0) - (b.plPct || 0),
    todayPLPct: (a, b) => (a.todayPLPct || 0) - (b.todayPLPct || 0),
    value:      (a, b) => ((b.ltp || 0) * b.qty) - ((a.ltp || 0) * a.qty),
    symbol:     (a, b) => (a.symbol || '').localeCompare(b.symbol || ''),
  };
  function filterAndSort(list) {
    return list
      .filter(h => !filter || (h.symbol || '').toLowerCase().includes(filter) || (h.sector || '').toLowerCase().includes(filter))
      .sort(sortFns[sortBy] || sortFns.plPct);
  }

  function buildRow(h, key) {
    const sym  = sanitize(h.symbol || '');
    const hVal = (h.ltp || 0) * h.qty;
    let badges = '';
    if (h.alertPrice) badges += '<span class="badge-inline badge-alert">⚠ Alert: ₹' + sanitize(String(h.alertPrice)) + '</span>';
    if (h.stopLoss)   badges += '<span class="badge-inline badge-stop">🛑 Stop: ₹' + sanitize(String(h.stopLoss)) + '</span>';

    const tr = (label, val) => val ? '<div class="tech-row"><span>' + label + '</span><span>' + val + '</span></div>' : '';
    const trc = (label, val, cls) => val ? '<div class="tech-row"><span>' + label + '</span><span class="' + cls + '">' + val + '</span></div>' : '';
    const techHtml = '<div class="tech-grid">'
      + '<div class="tech-section"><div class="tech-label">Price Technicals</div>'
      + (h.rsi ? '<div class="tech-row"><span>RSI (14)</span><span class="' + ((h.rsi||50)<35?'val-red':(h.rsi||50)>65?'val-amber':'val-green') + '">' + h.rsi.toFixed(1) + '</span></div>' : '')
      + (h.dma50 ? '<div class="tech-row"><span>vs 50 DMA</span><span class="' + ((h.ltp||0)>h.dma50?'val-green':'val-red') + '">' + ((h.ltp||0)>h.dma50 ? 'Above ₹'+Math.round(h.dma50).toLocaleString('en-IN')+' ▲' : 'Below ₹'+Math.round(h.dma50).toLocaleString('en-IN')+' ▼') + '</span></div>' : '')
      + (h.dma200 ? '<div class="tech-row"><span>vs 200 DMA</span><span class="' + ((h.ltp||0)>h.dma200?'val-green':'val-red') + '">' + ((h.ltp||0)>h.dma200 ? 'Above ₹'+Math.round(h.dma200).toLocaleString('en-IN')+' ▲' : 'Below ₹'+Math.round(h.dma200).toLocaleString('en-IN')+' ▼') + '</span></div>' : '')
      + (h.trend ? trc('Trend', sanitize(h.trend), h.trend==='Bullish'?'val-green':'val-red') : '')
      + (h.week52Low ? tr('52W Range', '₹'+Math.round(h.week52Low).toLocaleString('en-IN')+'–₹'+Math.round(h.week52High).toLocaleString('en-IN')) : '')
      + '</div>'
      + '<div class="tech-section"><div class="tech-label">Fundamentals</div>'
      + (h.pe ? tr('P/E Ratio', h.pe.toFixed(1)) : '')
      + (h.eps ? tr('EPS (TTM)', '₹'+h.eps.toFixed(2)) : '')
      + (function() {
          const v = h.roe || h.netMargin;
          if (!v) return '';
          const lbl = h.roe ? 'ROE' : 'Net Margin';
          const cls = v > 15 ? 'val-green' : v < 5 ? 'val-red' : '';
          return '<div class="tech-row"><span>' + lbl + '</span><span class="' + cls + '">' + v.toFixed(1) + '%</span></div>';
        })()
      + (h.debtEquity != null ? trc('Debt / Equity', h.debtEquity.toFixed(2), h.debtEquity > 1 ? 'val-red' : 'val-green') : '')
      + (h.marketCap ? tr('Market Cap', '₹'+(h.marketCap/10000000).toFixed(1)+'Cr') : '')
      + '</div>'
      + '<div class="tech-section"><div class="tech-label">Analyst & Risk</div>'
      + (h.beta ? trc('Beta', h.beta.toFixed(2), h.beta > 1.2 ? 'val-red' : h.beta < 0.8 ? 'val-green' : '') : '')
      + (h.bookValue ? tr('Book Value', '₹'+h.bookValue.toFixed(1)) : '')
      + (h.dividendYield ? tr('Dividend Yield', h.dividendYield.toFixed(2)+'%') : '')
      + (h.analystTarget ? trc('Analyst Target', '₹'+h.analystTarget.toLocaleString('en-IN',{maximumFractionDigits:0}), h.ltp ? plCls(h.analystTarget - h.ltp) : '') : '')
      + '</div>'
      + '</div>';

    return '<tr onclick="toggleTechPanel(\'' + key + '\')">'
      + '<td><div class="ticker-name">' + sym + '</div><div class="ticker-sub">' + sanitize(h.sector||'') + '</div>' + badges + '</td>'
      + '<td>' + h.qty + '</td>'
      + '<td>' + fmtD(h.avgCost||0) + '</td>'
      + '<td class="' + plCls(h.todayPL||0) + '">' + fmtD(h.ltp||0) + '</td>'
      + '<td>' + fmt(hVal) + '</td>'
      + '<td class="' + plCls(h.plAbsolute||0) + '">' + sign(h.plAbsolute||0) + fmt(h.plAbsolute||0) + '<br><span style="font-size:10px">' + fmtPct(h.plPct||0) + '</span></td>'
      + '<td class="' + plCls(h.todayPL||0) + '">' + sign(h.todayPL||0) + fmt(h.todayPL||0) + '<br><span style="font-size:10px">' + fmtPct(h.todayPLPct||0) + '</span></td>'
      + '<td>' + healthBadge(h.health||'Neutral') + '</td>'
      + '<td>' + week52Bar(h.ltp||0, h.week52Low, h.week52High) + '</td>'
      + '<td class="expand-btn" id="expand-' + key + '">▶ details</td>'
      + '</tr>'
      + '<tr id="panel-' + key + '" style="display:none"><td colspan="10" style="padding:0;background:var(--bg)"><div class="tech-panel">' + techHtml + '</div></td></tr>';
  }

  const primRows = filterAndSort(primaryList).map(h  => buildRow(h,  sanitize(h.symbol) + '-pri')).join('');
  const secRows  = filterAndSort(secondaryList).map(h => buildRow(h, sanitize(h.symbol) + '-sec')).join('');

  function sectionHeader(label, emoji, list) {
    const s = calcSummary(list);
    return '<tr><td colspan="10" style="padding:8px 10px;background:#f1f5f9;border-top:2px solid var(--border);border-bottom:1px solid var(--border)">'
      + '<strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#475569">' + emoji + ' ' + label + '</strong>'
      + '<span style="margin-left:12px;font-size:11px;color:#64748b">'
      + 'Invested: ' + fmt(s.inv) + ' &nbsp;·&nbsp; '
      + 'Value: ' + fmt(s.val) + ' &nbsp;·&nbsp; '
      + '<span class="' + plCls(s.pl) + '">P&L: ' + sign(s.pl) + fmt(s.pl) + '</span>'
      + ' &nbsp;·&nbsp; <span class="' + plCls(s.todayPL) + '">Today: ' + sign(s.todayPL) + fmt(s.todayPL) + '</span>'
      + '</span></td></tr>';
  }

  const primHeader = primaryList.length > 0   ? sectionHeader('Primary Account',   '🏦', primaryList)   : '';
  const secHeader  = secondaryList.length > 0  ? sectionHeader('Secondary Account', '📦', secondaryList) : '';

  document.getElementById('stocks-tbody').innerHTML = primHeader + primRows + secHeader + secRows;
}

function toggleTechPanel(key) {
  const panel = document.getElementById('panel-' + key);
  const btn   = document.getElementById('expand-' + key);
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'table-row' : 'none';
  if (btn) btn.textContent = show ? '▼ hide' : '▶ details';
}

// ── ETFs Tab ─────────────────────────────────────────────────────────────
const ETF_THESIS = {
  ICICIGOLD:  { tag: '✓ Best performer', cls: 'thesis-quality' },
  MIDQ50ADD:  { tag: '✓ Quality midcap', cls: 'thesis-quality' },
  MODEFENCE:  { tag: '⚡ Thematic',      cls: 'thesis-thematic' },
  ICICIALPLV: { tag: '⚠ Under review',  cls: 'thesis-review' },
  MON100:     { tag: '✓ US Tech core',  cls: 'thesis-quality' },
  MAHKTECH:   { tag: '⚠ China risk',    cls: 'thesis-review' },
  MASPTOP50:  { tag: 'Holding',          cls: 'thesis-holding' },
  ICICISILVE: { tag: '⚠ Weakest',       cls: 'thesis-review' },
};
function renderETFs() {
  if (!portfolio) return;
  const { etfs = [], sips = {} } = portfolio;

  const invested = etfs.reduce((s, h) => s + (h.avgCost||0)*h.qty, 0);
  const value    = etfs.reduce((s, h) => s + (h.ltp||0)*h.qty, 0);
  const pl       = value - invested;
  const todayPL  = etfs.reduce((s, h) => s + (h.todayPL||0), 0);

  document.getElementById('etfs-summary').innerHTML =
    '<span>Invested: <strong>' + fmt(invested) + '</strong></span>' +
    '<span>Value: <strong>' + fmt(value) + '</strong></span>' +
    '<span class="' + plCls(pl) + '">P&amp;L: <strong>' + sign(pl) + fmt(pl) + ' (' + fmtPct(invested ? pl/invested*100 : 0) + ')</strong></span>' +
    '<span class="' + plCls(todayPL) + '">Today: <strong>' + sign(todayPL) + fmt(todayPL) + '</strong></span>';

  const zerodhaList = etfs.filter(e => e.source === 'zerodha');
  const iciciList   = etfs.filter(e => e.source === 'icici');

  const getSIPLabel = sym => {
    const z = (sips.etf_zerodha||[]).find(s => s.symbol === sym);
    const i = (sips.etf_icici||[]).find(s => s.symbol === sym);
    const etf = etfs.find(e => e.symbol === sym);
    const ltp = etf ? (etf.ltp || etf.avgCost || 0) : 0;
    if (z && z.status === 'active') {
      if (z.mode === 'amount' && z.amount) return fmt(z.amount) + '/mo';
      const approx = ltp > 0 ? ' (~' + fmt(z.qty * ltp) + ')' : '';
      return (z.qty || 0) + ' units/mo' + approx;
    }
    if (i && i.status === 'active') {
      if (i.mode === 'qty' && i.qty && ltp > 0) return (i.qty||0) + ' units/mo (~' + fmt(i.qty * ltp) + ')';
      return fmt(i.amount) + '/mo';
    }
    if ((z && z.status === 'paused') || (i && i.status === 'paused')) return '⏸ Paused';
    return '—';
  };
  const isPaused = sym => {
    const z = (sips.etf_zerodha||[]).find(s => s.symbol === sym && s.status === 'paused');
    const i = (sips.etf_icici||[]).find(s => s.symbol === sym && s.status === 'paused');
    return !!(z || i);
  };

  function etfSectionHeader(label, emoji, list) {
    const inv     = list.reduce((s, h) => s + (h.avgCost||0)*h.qty, 0);
    const val     = list.reduce((s, h) => s + (h.ltp||0)*h.qty, 0);
    const spl     = val - inv;
    const todaypl = list.reduce((s, h) => s + (h.todayPL||0), 0);
    return '<tr><td colspan="9" style="padding:8px 10px;background:#f1f5f9;border-top:2px solid var(--border);border-bottom:1px solid var(--border)">'
      + '<strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#475569">' + emoji + ' ' + label + '</strong>'
      + '<span style="margin-left:12px;font-size:11px;color:#64748b">'
      + 'Invested: ' + fmt(inv) + ' &nbsp;·&nbsp; '
      + 'Value: ' + fmt(val) + ' &nbsp;·&nbsp; '
      + '<span class="' + plCls(spl) + '">P&L: ' + sign(spl) + fmt(spl) + '</span>'
      + ' &nbsp;·&nbsp; <span class="' + plCls(todaypl) + '">Today: ' + sign(todaypl) + fmt(todaypl) + '</span>'
      + '</span></td></tr>';
  }

  function buildRows(list) {
    return list.map(e => {
      const sym  = sanitize(e.symbol || '');
      const eVal = (e.ltp||0)*e.qty;
      const ePL  = eVal - (e.avgCost||0)*e.qty;
      const t    = ETF_THESIS[e.symbol] || { tag: '—', cls: 'thesis-holding' };
      const pausedBadge = isPaused(e.symbol) ? '<span class="badge-inline badge-paused">⏸ SIP paused</span>' : '';
      return '<tr>'
        + '<td><div class="ticker-name">' + sym + '</div>' + pausedBadge + '</td>'
        + '<td>' + e.qty + '</td>'
        + '<td>' + (e.avgCost ? fmtD(e.avgCost) : '—') + '</td>'
        + '<td class="' + plCls(e.todayPL||0) + '">' + fmtD(e.ltp||0) + '</td>'
        + '<td>' + fmt(eVal) + '</td>'
        + '<td class="' + plCls(ePL) + '">' + sign(ePL) + fmt(ePL) + '<br><span style="font-size:10px">' + fmtPct(e.plPct||0) + '</span></td>'
        + '<td class="' + plCls(e.todayPL||0) + '">' + sign(e.todayPL||0) + fmt(e.todayPL||0) + '<br><span style="font-size:10px">' + fmtPct(e.todayPLPct||0) + '</span></td>'
        + '<td>' + sanitize(getSIPLabel(e.symbol)) + '</td>'
        + '<td><span class="thesis-tag ' + t.cls + '">' + sanitize(t.tag) + '</span></td>'
        + '</tr>';
    }).join('');
  }

  const zHeader = zerodhaList.length > 0 ? etfSectionHeader('Zerodha', '🟢', zerodhaList) : '';
  const iHeader = iciciList.length   > 0 ? etfSectionHeader('ICICI',   '🔵', iciciList)   : '';

  document.getElementById('etfs-content').innerHTML =
    '<div class="table-wrap"><table class="data-table"><thead><tr>'
    + '<th>ETF</th><th>QTY</th><th>AVG</th><th>NAV <span class="live-dot">●</span></th>'
    + '<th>VALUE</th><th>TOTAL P&amp;L</th><th>TODAY</th><th>SIP/MONTH</th><th>THESIS</th>'
    + '</tr></thead><tbody>' + zHeader + buildRows(zerodhaList) + iHeader + buildRows(iciciList) + '</tbody></table></div>';
}

// ── MF Tab ────────────────────────────────────────────────────────────────
// Strip verbose historical name notes from MF scheme display names
function cleanSchemeName(name) {
  return name
    .replace(/\s*\(erstwhile[^)]*\)/gi, '')
    .replace(/\s*\(formerly[^)]*\)/gi, '')
    .replace(/\s*\(Erstwhile[^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function renderMF() {
  if (!portfolio) return;
  const { mf_nitin = [], mf_indumati = [], sips = {}, summary } = portfolio;

  const nitinInv   = mf_nitin.reduce((s,h) => s+h.invested, 0);
  const nitinVal   = mf_nitin.reduce((s,h) => s+(h.currentValue||(h.nav||0)*h.units||0), 0);
  const nitinToday = mf_nitin.reduce((s,h) => s+(h.todayPL||0), 0);
  const induInv    = mf_indumati.reduce((s,h) => s+h.invested, 0);
  const induVal    = mf_indumati.reduce((s,h) => s+(h.currentValue||(h.nav||0)*h.units||0), 0);
  const induToday  = mf_indumati.reduce((s,h) => s+(h.todayPL||0), 0);
  const totalInv   = nitinInv + induInv;
  const totalVal   = nitinVal + induVal;
  const totalPL    = totalVal - totalInv;
  const totalToday = nitinToday + induToday;
  const mfSIPTotal = (sips.mf||[]).filter(s=>s.status==='active').reduce((a,s)=>a+s.amount,0);
  const combinedXIRR = summary?.segments?.mf_combined?.xirr;

  document.getElementById('mf-summary').innerHTML =
    '<span>Invested: <strong>' + fmt(totalInv) + '</strong></span>' +
    '<span>Value: <strong>' + fmt(totalVal) + '</strong></span>' +
    '<span class="' + plCls(totalPL) + '">P&L: <strong>' + sign(totalPL) + fmt(totalPL) + ' (' + fmtPct(totalInv?totalPL/totalInv*100:0) + ')</strong></span>' +
    '<span class="' + plCls(totalToday) + '">Today: <strong>' + sign(totalToday) + fmt(totalToday) + '</strong></span>' +
    '<span>MF SIPs: <strong>' + fmt(mfSIPTotal) + '/mo</strong></span>' +
    (combinedXIRR != null ? '<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:8px;font-size:11px">Combined XIRR <strong>' + combinedXIRR.toFixed(1) + '%</strong></span>' : '');

  function normScheme(s) {
    return (s||'').toLowerCase()
      .replace(/direct\s+plan/g,'').replace(/regular\s+plan/g,'')
      .replace(/\s*-\s*growth/g,'').replace(/growth\s+option/g,'')
      .replace(/\(erstwhile[^)]*\)/g,'').replace(/\(formerly[^)]*\)/g,'')
      .replace(/\s{2,}/g,' ').trim().substring(0, 30);
  }
  function buildSipMap(holder) {
    const map = {};
    (sips.mf||[]).filter(s => s.holder === holder).forEach(s => { map[normScheme(s.scheme)] = s; });
    return map;
  }
  function findSIP(scheme, sipMap) {
    const norm = normScheme(scheme);
    if (sipMap[norm]) return sipMap[norm];
    let best = null, bestLen = 0;
    Object.entries(sipMap).forEach(([k, v]) => {
      const overlap = norm.includes(k) || k.includes(norm.substring(0, Math.min(norm.length, 20)));
      if (overlap && k.length > bestLen) { best = v; bestLen = k.length; }
    });
    return best;
  }

  const holderData = {
    nitin:    { holdings: mf_nitin,    inv: nitinInv, val: nitinVal, today: nitinToday },
    indumati: { holdings: mf_indumati, inv: induInv,  val: induVal,  today: induToday  },
  };

  function buildTabBar() {
    return Object.entries(holderData).map(([h, d]) => {
      const xirr     = summary?.segments?.['mf_' + h]?.xirr;
      const isActive = mfActiveTab === h;
      const label    = h === 'nitin' ? 'Nitin' : 'Indumati';
      return '<button class="mf-tab-btn ' + h + (isActive ? ' active' : '') + '" onclick="switchMFTab(\'' + h + '\')">'
        + sanitize(label)
        + ' <span class="mf-tab-meta">' + fmt(d.val)
        + (xirr != null ? ' &middot; XIRR ' + xirr.toFixed(1) + '%' : '')
        + '</span></button>';
    }).join('');
  }

  function buildTabContent(holder) {
    const d      = holderData[holder];
    const pl     = d.val - d.inv;
    const sipMap = buildSipMap(holder);
    const rows   = d.holdings.map(h => {
      const hVal    = h.currentValue || (h.nav||0)*h.units || 0;
      const hPL     = hVal - h.invested;
      const sipInfo = findSIP(h.scheme||'', sipMap);
      return '<tr>'
        + '<td style="max-width:220px"><div class="ticker-name" style="font-size:12px">' + sanitize(cleanSchemeName(h.scheme||'')) + '</div></td>'
        + '<td>' + (h.units||0).toFixed(3) + '</td>'
        + '<td>' + fmt(h.invested) + '</td>'
        + '<td>' + (h.nav ? h.nav.toFixed(4) : '—') + '</td>'
        + '<td>' + fmt(hVal) + '</td>'
        + '<td class="' + plCls(hPL) + '">' + sign(hPL) + fmt(hPL) + '<br><span style="font-size:10px">' + fmtPct(h.plPct||0) + '</span></td>'
        + '<td class="' + plCls(h.todayPL||0) + '">' + sign(h.todayPL||0) + fmt(h.todayPL||0) + '</td>'
        + '<td>' + (sipInfo ? '<span class="sip-tag ' + holder + '">' + fmt(sipInfo.amount) + '</span>' : '—') + '</td>'
        + '</tr>';
    }).join('');

    return '<div class="mf-holder-stats">'
      + '<span>Invested: <strong>' + fmt(d.inv) + '</strong></span>'
      + '<span>Value: <strong class="' + plCls(pl) + '">' + fmt(d.val) + '</strong></span>'
      + '<span class="' + plCls(pl) + '">P&L: <strong>' + sign(pl) + fmt(pl) + ' (' + fmtPct(d.inv ? pl/d.inv*100 : 0) + ')</strong></span>'
      + '<span class="' + plCls(d.today) + '">Today: <strong>' + sign(d.today) + fmt(d.today) + '</strong></span>'
      + '</div>'
      + '<div class="table-wrap"><table class="data-table"><thead><tr>'
      + '<th>SCHEME</th><th>UNITS</th><th>INVESTED</th>'
      + '<th>NAV <span class="live-dot">&#9679;</span></th>'
      + '<th>VALUE</th><th>TOTAL P&L</th><th>TODAY</th><th>SIP</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  document.getElementById('mf-content').innerHTML =
    '<div class="mf-tab-bar">' + buildTabBar() + '</div>'
    + '<div class="mf-tab-content">' + buildTabContent(mfActiveTab) + '</div>';
}

function updateStockCategoryValidation() {
  if (!portfolio) return;
  const stocks = portfolio.stocks || [];
  let allValid = true;
  let validCount = 0;
  stocks.forEach(h => {
    const sym = h.symbol;
    const pInput = document.querySelector('.sc-input[data-sym="' + sym + '"][data-field="primary"]');
    const sInput = document.querySelector('.sc-input[data-sym="' + sym + '"][data-field="secondary"]');
    if (!pInput || !sInput) return;
    const pQty = parseInt(pInput.value) || 0;
    const sQty = parseInt(sInput.value) || 0;
    const sum  = pQty + sQty;
    const valid = sum === h.qty;
    const statusEl = document.getElementById('sc-status-' + sym);
    if (statusEl) {
      statusEl.innerHTML = valid
        ? '<span style="color:var(--green)">&#10003;</span>'
        : '<span style="color:var(--red);font-size:11px">&#9888; ' + pQty + '+' + sQty + '=' + sum + ' &ne; ' + h.qty + '</span>';
    }
    if (valid) validCount++; else allValid = false;
  });
  const saveBtn = document.getElementById('sc-save-btn');
  if (saveBtn) saveBtn.disabled = !allValid;
  const summaryEl = document.getElementById('sc-summary');
  if (summaryEl) {
    summaryEl.innerHTML = '<span style="color:#64748b">'
      + validCount + ' of ' + stocks.length + ' stocks split correctly'
      + (validCount < stocks.length ? ' &middot; <span style="color:var(--red)">' + (stocks.length - validCount) + ' need attention</span>' : '')
      + '</span>';
  }
}

function renderStockCategory() {
  if (!portfolio) return;
  const stocks = portfolio.stocks || [];

  function getEntry(h) {
    return stockCategory[h.symbol] || { primary: h.qty, secondary: 0 };
  }

  const inputStyle = 'width:65px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;text-align:center';

  const rows = stocks.map(h => {
    const sym   = sanitize(h.symbol);
    const entry = getEntry(h);
    const sum   = entry.primary + entry.secondary;
    const valid = sum === h.qty;
    const statusHtml = valid
      ? '<span style="color:var(--green)">&#10003;</span>'
      : '<span style="color:var(--red);font-size:11px">&#9888; ' + entry.primary + '+' + entry.secondary + '=' + sum + ' &ne; ' + h.qty + '</span>';
    const exchVal = entry.exchange || 'NSE';
    const exchSel = '<select class="sc-exch settings-select" data-sym="' + sym + '" style="font-size:12px;padding:3px 6px">'
      + '<option value="NSE"' + (exchVal === 'NSE' ? ' selected' : '') + '>NSE</option>'
      + '<option value="BSE"' + (exchVal === 'BSE' ? ' selected' : '') + '>BSE</option>'
      + '</select>';
    return '<tr>'
      + '<td><strong>' + sym + '</strong><div style="font-size:10px;color:#94a3b8">' + sanitize(h.sector || '') + '</div></td>'
      + '<td style="color:#64748b;text-align:center">' + h.qty + '</td>'
      + '<td style="text-align:center"><input type="number" min="0" class="sc-input" data-sym="' + sym + '" data-field="primary"   value="' + entry.primary   + '" style="' + inputStyle + '" oninput="updateStockCategoryValidation()"></td>'
      + '<td style="text-align:center"><input type="number" min="0" class="sc-input" data-sym="' + sym + '" data-field="secondary" value="' + entry.secondary + '" style="' + inputStyle + '" oninput="updateStockCategoryValidation()"></td>'
      + '<td style="text-align:center">' + exchSel + '</td>'
      + '<td id="sc-status-' + sym + '">' + statusHtml + '</td>'
      + '</tr>';
  }).join('');

  const validCount = stocks.filter(h => { const e = getEntry(h); return e.primary + e.secondary === h.qty; }).length;
  const allValid   = validCount === stocks.length;

  const el = document.getElementById('settings-stock-category');
  if (!el) return;
  el.innerHTML = '<div style="overflow-x:auto">'
    + '<table class="settings-table"><thead><tr>'
    + '<th>STOCK</th><th style="text-align:center">TOTAL QTY</th><th style="text-align:center">PRIMARY</th><th style="text-align:center">SECONDARY</th><th style="text-align:center">EXCHANGE</th><th>STATUS</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:0 2px">'
    + '<div id="sc-summary"><span style="color:#64748b">'
    + validCount + ' of ' + stocks.length + ' stocks split correctly'
    + (validCount < stocks.length ? ' &middot; <span style="color:var(--red)">' + (stocks.length - validCount) + ' need attention</span>' : '')
    + '</span></div>'
    + '<button id="sc-save-btn" class="btn-primary" onclick="saveStockCategory()"' + (allValid ? '' : ' disabled') + '>Save</button>'
    + '</div>';
}

// ── Data Sources Tab ──────────────────────────────────────────────────────
// SOURCE_CONFIG split into two groups for display
const SOURCE_STOCKS_ETFS = [
  { id:'zerodha',      title:'Zerodha — Holdings',   iconLabel:'Z',   iconCls:'zerodha', endpoint:'/api/upload/zerodha',       accept:'.xlsx',      hint:'Console → Reports → Holdings → Export XLSX · Upload format: <strong>XLSX</strong>' },
  { id:'icici',        title:'ICICI Direct',         iconLabel:'IC',  iconCls:'icici',   endpoint:'/api/upload/icici',         accept:'.csv',       hint:'Portfolio → Portfolio Summary → Export · Upload format: <strong>CSV</strong>' },
  { id:'realized_pnl', title:'Zerodha — Realized P&L', iconLabel:'P&L', iconCls:'zerodha', endpoint:'/api/upload/realized-pnl', accept:'.xlsx',      hint:'Console → Reports → Tax P&L → Download XLSX · Multiple files merge automatically · Upload format: <strong>XLSX</strong>' },
];
const SOURCE_MF = [
  { id:'mfcentral_nitin',    title:'MFCentral — Nitin',    iconLabel:'MF', iconCls:'nitin', endpoint:'/api/upload/mfcentral', accept:'.csv,.xlsx', hint:'mfcentral.in → CAS → Detailed → Download · Upload format: <strong>XLSX or CSV</strong>' },
  { id:'mfcentral_indumati', title:'MFCentral — Indumati', iconLabel:'MF', iconCls:'indu',  endpoint:'/api/upload/mfcentral', accept:'.csv,.xlsx', hint:'mfcentral.in → CAS → Detailed → Download · Upload format: <strong>XLSX or CSV</strong>' },
];
const SOURCE_CONFIG = [...SOURCE_STOCKS_ETFS, ...SOURCE_MF];

function renderSources() {
  if (!portfolio) return;
  const { lastUpdated = {}, upload_history = [], source_metadata = {} } = portfolio;

  function buildCard(src) {
    const ts    = lastUpdated[src.id];
    const stale = isStale(ts);
    const meta  = source_metadata[src.id] || null;

    // Build the rich hint line based on file metadata
    let hintHtml = '';
    if (meta && meta.label) {
      // Zerodha Holdings: "Equity Holdings Statement as on 2026-03-18"
      // Zerodha P&L:     "P&L Statement for Equity from 2025-04-01 to 2026-03-18"
      // MFCentral:       "CAS from 01-Jan-2023 to 20-Mar-2026"
      hintHtml = '📄 <strong>' + sanitize(meta.label) + '</strong>';
    } else if (src.iconCls === 'nitin' || src.iconCls === 'indu') {
      // MFCentral fallback: show next CAS hint
      const nextDate = ts ? new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : 'Never';
      hintHtml = '📅 Next CAS from: <strong>' + sanitize(nextDate) + '</strong>';
    } else {
      hintHtml = '📥 ' + src.hint;
    }

    // For MFCentral, also show date range if available
    if (meta && meta.fromDate && meta.toDate && (src.iconCls === 'nitin' || src.iconCls === 'indu')) {
      hintHtml = '📄 CAS: <strong>' + sanitize(meta.fromDate) + '</strong> → <strong>' + sanitize(meta.toDate) + '</strong>'
        + '<br><span style="font-size:10px;color:#64748b">Next upload: from ' + sanitize(meta.toDate) + ' onwards</span>';
    }

    return '<div class="source-card">'
      + '<input type="file" id="file-' + src.id + '" class="hidden" accept="' + src.accept + '" onchange="handleFileInput(\'' + src.id + '\',\'' + src.endpoint + '\',this)">'
      + '<div class="source-card-header">'
      + '<div class="source-icon ' + src.iconCls + '">' + sanitize(src.iconLabel) + '</div>'
      + '<div><div class="source-card-title">' + sanitize(src.title) + '</div></div>'
      + '<span class="source-status ' + (stale?'stale':'ok') + '">' + (stale?'⚠ Stale':'● Up to date') + '</span>'
      + '</div>'
      + '<div class="source-meta"><div class="source-meta-item"><div class="meta-label">Last Updated</div><div class="meta-val ' + (stale?'stale':'') + '">' + sanitize(dateFmt(ts)) + '</div></div></div>'
      + '<div class="source-hint ' + src.iconCls + '">' + hintHtml + '</div>'
      + '<div class="drop-zone ' + src.iconCls + '" id="drop-' + src.id + '"'
      + ' onclick="document.getElementById(\'file-' + src.id + '\').click()"'
      + ' ondragover="event.preventDefault();this.classList.add(\'dragover\')"'
      + ' ondragleave="this.classList.remove(\'dragover\')"'
      + ' ondrop="handleDrop(event,\'' + src.id + '\',\'' + src.endpoint + '\')">'
      + '<div class="drop-icon">📁</div>'
      + '<div class="drop-label">Drop file here</div>'
      + '<div class="drop-sub">or click to browse</div>'
      + '</div>'
      + '<div id="upload-result-' + src.id + '" style="font-size:11px;margin-top:8px"></div>'
      + '</div>';
  }

  document.getElementById('source-cards').innerHTML =
    '<div style="margin-bottom:6px"><div class="settings-section-title" style="color:#ff6600;padding:10px 20px 4px;background:white;border-bottom:1px solid var(--border)">Stocks &amp; ETFs</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px 20px">'
    + SOURCE_STOCKS_ETFS.map(buildCard).join('')
    + '</div></div>'
    + '<div><div class="settings-section-title" style="color:var(--purple);padding:10px 20px 4px;background:white;border-bottom:1px solid var(--border)">Mutual Funds</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px 20px">'
    + SOURCE_MF.map(buildCard).join('')
    + '</div></div>';

  const hist = [...(upload_history||[])].reverse();
  document.getElementById('upload-history').innerHTML = '<h4>Recent Uploads</h4>'
    + '<table class="history-table"><thead><tr><th>Source</th><th>File</th><th>Uploaded At</th><th>Changes</th></tr></thead><tbody>'
    + (hist.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">No uploads yet</td></tr>'
      : hist.map(h => '<tr>'
          + '<td style="font-weight:600">' + sanitize(h.source||'—') + '</td>'
          + '<td style="color:#64748b">' + sanitize(h.filename||'—') + '</td>'
          + '<td>' + sanitize(dateFmt(h.uploadedAt)) + '</td>'
          + '<td style="color:var(--green)">' + sanitize(JSON.stringify(h.changes||{})) + '</td>'
          + '</tr>').join(''))
    + '</tbody></table>';
}

function handleFileInput(srcId, endpoint, input) {
  const file = input.files[0];
  if (file) doUpload(srcId, endpoint, file);
}

function handleDrop(event, srcId, endpoint) {
  event.preventDefault();
  const dz = document.getElementById('drop-' + srcId);
  if (dz) dz.classList.remove('dragover');
  const file = event.dataTransfer.files[0];
  if (file) doUpload(srcId, endpoint, file);
}

async function doUpload(srcId, endpoint, file) {
  const resultEl = document.getElementById('upload-result-' + srcId);
  if (resultEl) { resultEl.textContent = '⏳ Uploading...'; resultEl.style.color = '#64748b'; }
  const form = new FormData();
  form.append('file', file);
  try {
    const r = await fetch(endpoint, { method: 'POST', body: form });
    const json = await r.json();
    if (json.success) {
      if (resultEl) { resultEl.textContent = '✓ ' + JSON.stringify(json.diff); resultEl.style.color = 'var(--green)'; }
      await loadPortfolio();
      renderSources();
    } else {
      if (resultEl) { resultEl.textContent = '✗ ' + sanitize(json.error||'Error'); resultEl.style.color = 'var(--red)'; }
    }
  } catch (err) {
    if (resultEl) { resultEl.textContent = '✗ ' + sanitize(err.message); resultEl.style.color = 'var(--red)'; }
  }
}

// ── Wealth Projection Tab ─────────────────────────────────────────────────
function renderWealth() {
  if (!portfolio) return;
  const { summary = {}, assumptions = {} } = portfolio;
  const { mfEtfCagr = 12, stocksCagr = 15, monthlyStockBudget = 4000 } = assumptions;

  document.getElementById('assumptions-bar').innerHTML =
    '<div class="assump-label">Assumptions</div>'
    + '<div class="assump-group"><label>MF + ETF CAGR (%)</label><input class="assump-input" id="a-mf" type="number" value="' + mfEtfCagr + '" min="1" max="30" onchange="renderWealth()"></div>'
    + '<div class="assump-group"><label>Stocks CAGR (%)</label><input class="assump-input" id="a-stocks" type="number" value="' + stocksCagr + '" min="1" max="40" onchange="renderWealth()"></div>'
    + '<div class="assump-group"><label>Monthly SIPs</label><input class="assump-input" id="a-monthly" type="number" value="' + (summary.monthlySIPs||95267) + '" style="width:90px" onchange="renderWealth()"></div>';

  const mfRate  = (parseFloat((document.getElementById('a-mf')||{}).value) || mfEtfCagr) / 100;
  const stkRate = (parseFloat((document.getElementById('a-stocks')||{}).value) || stocksCagr) / 100;
  const monthly = parseFloat((document.getElementById('a-monthly')||{}).value) || (summary.monthlySIPs||95267);
  const corpus  = summary.totalValue || 0;
  const stocksV = summary.segments?.stocks?.value || 0;
  const mfEtfV  = corpus - stocksV;
  const stkMo   = monthlyStockBudget;
  const mfMo    = monthly - stkMo;

  function project(years) {
    let mf = mfEtfV, stk = stocksV;
    for (let y = 0; y < years; y++) { mf = mf*(1+mfRate) + mfMo*12; stk = stk*(1+stkRate) + stkMo*12; }
    return { total: mf+stk, deployed: corpus + monthly*12*years };
  }

  const fmtCr = n => n >= 10000000 ? '₹'+(n/10000000).toFixed(2)+'Cr' : n >= 100000 ? '₹'+(n/100000).toFixed(1)+'L' : fmt(n);

  const milestones = [
    { label:'5 Years · Mar 2031', cls:'y5',  dark:false, proj:project(5) },
    { label:'10 Years · Mar 2036',cls:'y10', dark:false, proj:project(10) },
    { label:'20 Years · Mar 2046',cls:'y20', dark:true,  proj:project(20) },
  ];

  document.getElementById('milestone-cards').innerHTML = milestones.map(({ label, cls, dark, proj }) => {
    const gain   = proj.total - proj.deployed;
    const retPct = proj.deployed ? ((gain / proj.deployed) * 100).toFixed(1) : '0';
    return '<div class="milestone ' + cls + (dark?' dark':'') + '">'
      + '<div class="milestone-label">' + sanitize(label) + '</div>'
      + '<div class="milestone-value">' + sanitize(fmtCr(proj.total)) + '</div>'
      + '<div class="milestone-sub">' + (proj.total >= 10000000 ? (proj.total/10000000).toFixed(1)+' Crore' : '') + '</div>'
      + '<div class="milestone-breakdown">'
      + '<div class="mb-row"><span>Deployed</span><span>' + sanitize(fmtCr(proj.deployed)) + '</span></div>'
      + '<div class="mb-row"><span>Gains</span><span class="val-green">+' + sanitize(fmtCr(gain)) + '</span></div>'
      + '<div class="mb-row"><span>Return</span><span class="val-green">+' + sanitize(retPct) + '%</span></div>'
      + '</div></div>';
  }).join('');

  const years  = Array.from({ length: 21 }, (_, i) => i);
  const wData  = years.map(y => project(y).total);
  const dData  = years.map(y => project(y).deployed);
  const labels = years.map(y => String(2026 + y));

  if (wealthChart) wealthChart.destroy();
  const ctx = document.getElementById('wealth-chart').getContext('2d');
  wealthChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      { label:'Total Wealth', data:wData, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.08)', fill:true, tension:0.4, pointRadius:3 },
      { label:'Deployed',     data:dData, borderColor:'#e2e8f0', borderDash:[5,3], fill:false, pointRadius:0 },
    ]},
    options: {
      responsive: true,
      plugins: { legend:{ display:false }, tooltip:{ callbacks:{ label:c => fmtCr(c.raw) } } },
      scales: { y:{ ticks:{ callback:v => fmtCr(v) } }, x:{ ticks:{ maxTicksLimit:8 } } }
    }
  });

  const rows = years.slice(1).map(y => { const p = project(y); return { year: 2026+y, ...p, gain: p.total-p.deployed }; });
  let showAll = false;
  function drawYearTable() {
    const display = showAll ? rows : rows.slice(0, 5);
    document.getElementById('year-table').innerHTML = '<h4>Year-by-Year Breakdown'
      + '<button class="show-all-btn" id="toggle-yr">' + (showAll?'Show less ▲':'Show all years ▼') + '</button></h4>'
      + '<table class="data-table" style="font-size:11px"><thead><tr><th>Year</th><th>Deployed</th><th>Wealth</th><th>Gain</th><th>Return</th></tr></thead><tbody>'
      + display.map(r => '<tr>'
          + '<td class="font-bold">' + r.year + '</td>'
          + '<td>' + sanitize(fmtCr(r.deployed)) + '</td>'
          + '<td class="font-bold">' + sanitize(fmtCr(r.total)) + '</td>'
          + '<td class="val-green">+' + sanitize(fmtCr(r.gain)) + '</td>'
          + '<td class="val-green">+' + ((r.gain/r.deployed)*100).toFixed(1) + '%</td>'
          + '</tr>').join('')
      + '</tbody></table>';
    document.getElementById('toggle-yr').onclick = () => { showAll = !showAll; drawYearTable(); };
  }
  drawYearTable();
}

// ── Settings Tab ──────────────────────────────────────────────────────────
function switchSettingsTab(tab) {
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('settings-' + tab).classList.add('active');
  document.querySelectorAll('.stab').forEach(b => {
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'" + tab + "'")) b.classList.add('active');
  });
  const footer = document.getElementById('settings-footer');
  if (footer) footer.style.display = tab === 'stock-category' ? 'none' : '';
  if (tab === 'stock-category') renderStockCategory();
}

function renderSettings() {
  if (!settings) return;
  const { sips = {}, assumptions = {} } = settings;
  const mfSIPs = sips.mf || [];
  const etfZ   = sips.etf_zerodha || [];
  const etfI   = sips.etf_icici || [];

  const dateOptions = Array.from({length:31},(_,i)=>i+1);
  function dateSelect(selected, idx) {
    return '<select class="settings-select" data-type="mf" data-field="date" data-idx="' + idx + '">'
      + dateOptions.map(d => '<option value="' + d + '"' + (d===selected?' selected':'') + '>' + d + (d===1?'st':d===2?'nd':d===3?'rd':'th') + '</option>').join('')
      + '</select>';
  }

  const mfNitin = mfSIPs.filter(s => s.holder === 'nitin');
  const mfIndu  = mfSIPs.filter(s => s.holder === 'indumati');
  const nitinTotal = mfNitin.filter(s=>s.status==='active').reduce((a,s)=>a+s.amount,0);
  const induTotal  = mfIndu.filter(s=>s.status==='active').reduce((a,s)=>a+s.amount,0);

  function mfRows(list, holder) {
    return list.map(s => {
      const idx = mfSIPs.indexOf(s);
      const isActive = s.status === 'active';
      return '<tr>'
        + '<td style="min-width:180px"><input style="width:100%;font-size:11px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;box-sizing:border-box" data-type="mf" data-field="scheme" data-idx="' + idx + '" value="' + sanitize(s.scheme||'') + '"></td>'
        + '<td><input class="settings-input" data-type="mf" data-field="amount" data-idx="' + idx + '" type="number" value="' + s.amount + '"></td>'
        + '<td>' + dateSelect(s.date, idx) + '</td>'
        + '<td><button class="btn-sip-status ' + (isActive ? 'active' : 'paused') + '" onclick="toggleMFSIPStatus(' + idx + ')">' + (isActive ? '⏸ Pause' : '▶ Resume') + '</button></td>'
        + '<td><button class="del-btn" onclick="deleteMFSIP(' + idx + ')">✕ Remove</button></td>'
        + '</tr>';
    }).join('');
  }

  document.getElementById('settings-mf-sips').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div class="settings-section-title nitin" style="margin:0">Nitin — Direct Plans</div>'
    + '<button class="btn-primary" style="font-size:11px;padding:4px 10px" onclick="addMFSIP(\'nitin\')">+ Add SIP</button>'
    + '</div>'
    + '<table class="settings-table"><thead><tr><th>Scheme</th><th>Amount (₹)</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>' + mfRows(mfNitin, 'nitin') + '</tbody></table>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 6px">'
    + '<div class="settings-section-title indu" style="margin:0">Indumati — via Dezerv</div>'
    + '<button class="btn-primary" style="font-size:11px;padding:4px 10px;background:var(--violet)" onclick="addMFSIP(\'indumati\')">+ Add SIP</button>'
    + '</div>'
    + '<table class="settings-table"><thead><tr><th>Scheme</th><th>Amount (₹)</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>' + mfRows(mfIndu, 'indumati') + '</tbody></table>'
    + '<div class="settings-total">'
    + '<span>Nitin: <strong style="color:var(--purple)">' + fmt(nitinTotal) + '/mo</strong></span>'
    + '<span>Indumati: <strong style="color:var(--violet)">' + fmt(induTotal) + '/mo</strong></span>'
    + '<span>Total: <strong>' + fmt(nitinTotal+induTotal) + '/mo</strong></span>'
    + '</div>';

  // Unified ETF SIP table — all brokers, normalized with date + mode (qty/amount)
  const dateOpts2 = Array.from({length:31},(_,i)=>i+1);
  function etfDateSel(selected, type, idx) {
    return '<select class="settings-select" data-type="' + type + '" data-field="date" data-idx="' + idx + '">'
      + dateOpts2.map(d => '<option value="' + d + '"' + (d===selected?' selected':'') + '>' + d + (d===1?'st':d===2?'nd':d===3?'rd':'th') + '</option>').join('')
      + '</select>';
  }
  function modeSel(mode, type, idx) {
    return '<select class="settings-select" data-type="' + type + '" data-field="mode" data-idx="' + idx + '" onchange="renderSettings()">'
      + '<option value="qty"' + (mode==='qty'?' selected':'') + '>Units</option>'
      + '<option value="amount"' + (mode==='amount'?' selected':'') + '>₹ Amount</option>'
      + '</select>';
  }

  function etfRows(list, type) {
    return list.map((s,i) => {
      const m = s.mode || (type==='etf_zerodha' ? 'qty' : 'amount');
      const valField = m === 'qty'
        ? '<input class="settings-input" style="width:65px" data-type="' + type + '" data-field="qty" data-idx="' + i + '" type="number" value="' + (s.qty||0) + '"> units'
        : '<input class="settings-input" style="width:75px" data-type="' + type + '" data-field="amount" data-idx="' + i + '" type="number" value="' + (s.amount||0) + '"> ₹';
      const isActive = s.status === 'active';
      return '<tr>'
        + '<td><input class="settings-input" style="width:90px;text-align:left" data-type="' + type + '" data-field="symbol" data-idx="' + i + '" value="' + sanitize(s.symbol||'') + '"></td>'
        + '<td>' + valField + '</td>'
        + '<td>' + modeSel(m, type, i) + '</td>'
        + '<td>' + etfDateSel(s.date||2, type, i) + '</td>'
        + '<td><button class="btn-sip-status ' + (isActive ? 'active' : 'paused') + '" onclick="toggleETFSIPStatus(\'' + type + '\',' + i + ')">' + (isActive ? '⏸ Pause' : '▶ Resume') + '</button></td>'
        + '<td><button class="del-btn" onclick="deleteETFSIP(\'' + type + '\',' + i + ')">✕ Remove</button></td>'
        + '</tr>';
    }).join('');
  }

  document.getElementById('settings-etf-sips').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div class="settings-section-title" style="color:#ff6600;margin:0">Zerodha Basket</div>'
    + '<button class="btn-primary" style="font-size:11px;padding:4px 10px;background:#ff6600" onclick="addETFSIP(\'etf_zerodha\')">+ Add ETF</button>'
    + '</div>'
    + '<table class="settings-table"><thead><tr><th>ETF</th><th>Value/Month</th><th>Mode</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>'
    + etfRows(etfZ, 'etf_zerodha') + '</tbody></table>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 6px">'
    + '<div class="settings-section-title" style="color:var(--purple);margin:0">ICICI ETF SIPs</div>'
    + '<button class="btn-primary" style="font-size:11px;padding:4px 10px" onclick="addETFSIP(\'etf_icici\')">+ Add ETF</button>'
    + '</div>'
    + '<table class="settings-table"><thead><tr><th>ETF</th><th>Value/Month</th><th>Mode</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>'
    + etfRows(etfI, 'etf_icici') + '</tbody></table>'
    + '<div class="assump-note" style="margin-top:8px">Mode: "Units" = buy N units/month. "₹ Amount" = invest fixed amount/month.</div>';

  const { mfEtfCagr=12, stocksCagr=15, monthlyStockBudget=4000 } = assumptions;
  document.getElementById('settings-assumptions').innerHTML =
    '<div class="assump-grid">'
    + '<div class="assump-field"><label>MF + ETF CAGR (%)</label><input id="set-mf-cagr" type="number" value="' + mfEtfCagr + '"></div>'
    + '<div class="assump-field"><label>Stocks CAGR (%)</label><input id="set-stocks-cagr" type="number" value="' + stocksCagr + '"></div>'
    + '<div class="assump-field"><label>Monthly Stock Budget (₹)</label><input id="set-stock-budget" type="number" value="' + monthlyStockBudget + '"></div>'
    + '</div>'
    + '<div class="assump-note">Changes update the Wealth Projection chart when saved.</div>';
}

// Read all visible input/select values back into settings — call before any renderSettings() or persist
function syncDOMToSettings() {
  if (!settings) return;
  document.querySelectorAll('[data-type="mf"][data-field]').forEach(el => {
    const idx = parseInt(el.dataset.idx), field = el.dataset.field;
    if (isNaN(idx) || !settings.sips.mf[idx]) return;
    if (field === 'scheme') settings.sips.mf[idx][field] = el.value.trim();
    else if (field === 'amount') settings.sips.mf[idx][field] = parseFloat(el.value) || 0;
    else settings.sips.mf[idx][field] = parseInt(el.value) || 0;
  });
  ['etf_zerodha', 'etf_icici'].forEach(type => {
    document.querySelectorAll('[data-type="' + type + '"]').forEach(el => {
      const idx = parseInt(el.dataset.idx), field = el.dataset.field;
      if (isNaN(idx) || !settings.sips[type][idx]) return;
      if (field === 'symbol') settings.sips[type][idx][field] = el.value.trim().toUpperCase();
      else if (field === 'mode') settings.sips[type][idx][field] = el.value;
      else if (field === 'date') settings.sips[type][idx][field] = parseInt(el.value) || 1;
      else settings.sips[type][idx][field] = parseFloat(el.value) || 0;
    });
  });
  const mfCagr = document.getElementById('set-mf-cagr');
  if (mfCagr) settings.assumptions = {
    mfEtfCagr:          parseFloat(mfCagr.value) || 12,
    stocksCagr:         parseFloat((document.getElementById('set-stocks-cagr')||{}).value) || 15,
    monthlyStockBudget: parseFloat((document.getElementById('set-stock-budget')||{}).value) || 4000,
  };
}

function addMFSIP(holder) {
  syncDOMToSettings(); // preserve any typed values before re-render
  settings.sips.mf.push({ scheme: 'New Scheme', amount: 1000, date: 2, holder, status: 'active', start_date: new Date().toISOString().slice(0,10) });
  renderSettings();
  document.getElementById('settings-mf-sips').scrollIntoView({ behavior: 'smooth' });
}

// Persist in-memory settings to server and refresh portfolio — no alert
async function persistSettings() {
  syncDOMToSettings(); // always capture latest DOM state before saving
  await api('POST', '/api/settings', settings);
  await loadPortfolio();
}

function deleteMFSIP(idx) {
  if (!confirm('Remove this SIP?')) return;
  settings.sips.mf.splice(idx, 1);
  renderSettings();
  persistSettings();
}

function toggleMFSIPStatus(idx) {
  const s = settings.sips.mf[idx];
  if (!s) return;
  s.status = s.status === 'active' ? 'paused' : 'active';
  renderSettings();
  persistSettings();
}

function addETFSIP(type) {
  const defaultMode = type === 'etf_zerodha' ? 'qty' : 'amount';
  settings.sips[type].push({ symbol: 'NEWSYMBOL', qty: defaultMode === 'qty' ? 10 : null, amount: defaultMode === 'amount' ? 1000 : null, date: 2, mode: defaultMode, status: 'active', start_date: new Date().toISOString().slice(0,10) });
  renderSettings();
  persistSettings();
}

function deleteETFSIP(type, idx) {
  if (!confirm('Remove this ETF SIP?')) return;
  settings.sips[type].splice(idx, 1);
  renderSettings();
  persistSettings();
}

function toggleETFSIPStatus(type, idx) {
  const s = settings.sips[type][idx];
  if (!s) return;
  s.status = s.status === 'active' ? 'paused' : 'active';
  renderSettings();
  persistSettings();
}

async function saveSettings() {
  await persistSettings(); // syncDOMToSettings() is called inside persistSettings()
  alert('Settings saved!');
}

// ── Init ───────────────────────────────────────────────────────────────────
Promise.all([loadPortfolio(), loadStockCategory()]).then(startCountdown);
loadSettings();
