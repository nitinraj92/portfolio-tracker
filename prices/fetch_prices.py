#!/usr/bin/env python3
"""
Price fetcher using NSE India API + NSE Archives bhav copy + Screener.in fundamentals.
- Live price/PE/52wk/sector PE/market cap: NSE quote API
- Historical closes for RSI/DMA: NSE Archives daily CSV (cached to data/price_history.json)
- EPS/ROE/DivYield/BookValue/D/E: Screener.in (cached 24h to data/screener_cache.json)
Called from Node.js: echo '[{"symbol":...}]' | python3 fetch_prices.py
"""
import sys, json, time, datetime, os, re, urllib.request
import requests

# ── NSE API session ────────────────────────────────────────────────────────
SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Referer': 'https://www.nseindia.com/',
    'Connection': 'keep-alive',
})

SYMBOL_OVERRIDE = {
    'ICICIGOLD':  'GOLDIETF',
    'ICICIALPLV': 'ALPL30IETF',
    'ICICISILVE': 'SILVERIETF',
}

_session_ready = False

def init_session():
    global _session_ready
    if _session_ready:
        return
    try:
        SESSION.get('https://www.nseindia.com', timeout=15)
        _session_ready = True
    except Exception:
        pass

def nse_quote(symbol):
    url = 'https://www.nseindia.com/api/quote-equity?symbol=' + symbol
    r = SESSION.get(url, timeout=15)
    r.raise_for_status()
    return r.json()

# ── Historical closes via NSE Archives bhav copy ───────────────────────────
DATA_DIR      = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
HISTORY_FILE  = os.path.join(DATA_DIR, 'price_history.json')
SCREENER_FILE = os.path.join(DATA_DIR, 'screener_cache.json')
SCREENER_TTL  = 86400  # refresh fundamentals once per day

def load_history_cache():
    try:
        with open(HISTORY_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def save_history_cache(cache):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(HISTORY_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception:
        pass

def fetch_bhav(date, symbols):
    """Download one day's bhav copy and return {symbol: close} for requested symbols."""
    date_str = date.strftime('%d%m%Y')
    url = 'https://archives.nseindia.com/products/content/sec_bhavdata_full_' + date_str + '.csv'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as r:
            content = r.read().decode('utf-8')
        result = {}
        for line in content.split('\n')[1:]:
            parts = [p.strip() for p in line.split(',')]
            if len(parts) >= 9 and parts[0] in symbols and parts[1] == 'EQ':
                try:
                    result[parts[0]] = float(parts[8])  # CLOSE_PRICE column
                except ValueError:
                    pass
        return result
    except Exception:
        return None  # holiday, weekend, or network error

def update_history(symbols, needed_days=210):
    """Ensure cache has enough trading days for all symbols. Downloads missing dates."""
    cache = load_history_cache()
    today = datetime.date.today()

    have_dates = set()
    for d_str, row in cache.items():
        if any(sym in row for sym in symbols):
            have_dates.add(d_str)

    downloads = 0
    current = today - datetime.timedelta(days=1)
    trading_days_found = len(have_dates)

    while trading_days_found < needed_days and downloads < 250:
        if current.weekday() >= 5:
            current -= datetime.timedelta(days=1)
            continue
        d_str = current.isoformat()
        if d_str in have_dates:
            trading_days_found += 1
            current -= datetime.timedelta(days=1)
            continue
        closes = fetch_bhav(current, symbols)
        downloads += 1
        if closes is not None:
            cache.setdefault(d_str, {}).update(closes)
            if closes:
                trading_days_found += 1
        current -= datetime.timedelta(days=1)

    if downloads > 0:
        save_history_cache(cache)
    return cache

def get_closes(symbol, cache, days=210):
    closes = []
    for d_str in sorted(cache.keys()):
        if symbol in cache[d_str]:
            closes.append(cache[d_str][symbol])
    return closes[-days:]

# ── Screener.in fundamentals (EPS, ROE, DivYield, BookValue, D/E) ─────────
def load_screener_cache():
    try:
        with open(SCREENER_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def save_screener_cache(cache):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(SCREENER_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception:
        pass

def _scrape_screener(symbol):
    """Fetch and parse fundamentals from screener.in. Returns dict or {}."""
    try:
        sr = requests.Session()
        sr.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Encoding': 'identity',
            'Referer': 'https://www.screener.in/',
        })
        # Find the company URL
        resp = sr.get('https://www.screener.in/api/company/search/?q=' + symbol, timeout=10)
        results = resp.json()
        if not results:
            return {}
        company_url = 'https://www.screener.in' + results[0]['url']

        page = sr.get(company_url, timeout=15)
        text = page.text

        def extract(pat):
            m = re.search(pat, text, re.DOTALL)
            try:
                return round(float(m.group(1).replace(',', '')), 2) if m else None
            except Exception:
                return None

        return {
            'eps':           extract(r'EPS[^<]*</span>\s*<span[^>]*>([\d.,]+)'),
            'roe':           extract(r'ROE[^<]*</span>\s*<span[^>]*>([\d.,]+)'),
            'dividendYield': extract(r'Dividend Yield[^<]*</span>\s*<span[^>]*>([\d.,]+)'),
            'bookValue':     extract(r'Book Value[^<]*</span>\s*<span[^>]*>([\d.,]+)'),
            'debtEquity':    extract(r'Debt to equity[^<]*</span>\s*<span[^>]*>([\d.,]+)')
                          or extract(r'Debt / Equity[^<]*</span>\s*<span[^>]*>([\d.,]+)'),
        }
    except Exception:
        return {}

def get_screener_data(symbol, cache):
    """Return cached screener data, refreshing if stale (>24h)."""
    entry = cache.get(symbol, {})
    if entry.get('_ts') and time.time() - entry['_ts'] < SCREENER_TTL:
        return entry
    data = _scrape_screener(symbol)
    if data:
        data['_ts'] = time.time()
        cache[symbol] = data
    return data

# ── Per-symbol fetch ───────────────────────────────────────────────────────
def fetch(symbol, avg_cost=None, stored_exchange=None, history_cache=None, sc=None):
    lookup = SYMBOL_OVERRIDE.get(symbol, symbol)
    try:
        d  = nse_quote(lookup)
        pi = d.get('priceInfo', {})

        # Use official closing price when available (market closed); real-time lastPrice during hours
        close_price = float(pi.get('close') or 0)
        last_price  = float(pi.get('lastPrice') or 0)
        price = close_price if close_price > 0 else last_price
        if price <= 0:
            return None

        price      = round(price, 2)
        prev_close = pi.get('previousClose')
        prev_close = round(float(prev_close), 2) if prev_close else price

        if avg_cost and avg_cost > 0:
            ratio = price / avg_cost
            if ratio < 0.35 or ratio > 3.0:
                return None

        wh        = pi.get('weekHighLow', {})
        wk52_high = wh.get('max')
        wk52_low  = wh.get('min')

        meta = d.get('metadata', {})
        pe, sector_pe = None, None
        try:
            if meta.get('pdSymbolPe'):
                pe = round(float(meta['pdSymbolPe']), 2)
            if meta.get('pdSectorPe'):
                sector_pe = round(float(meta['pdSectorPe']), 2)
        except Exception:
            pass

        market_cap = None
        try:
            issued = d.get('securityInfo', {}).get('issuedSize')
            if issued:
                market_cap = int(float(issued) * price)
        except Exception:
            pass

        closes = get_closes(lookup, history_cache) if history_cache else []
        dma50  = round(sum(closes[-50:])  / len(closes[-50:]),  2) if len(closes) >= 50  else None
        dma200 = round(sum(closes[-200:]) / len(closes[-200:]), 2) if len(closes) >= 200 else None

        sc = sc or {}
        return {
            'symbol':        symbol,
            'exchange':      'NSE',
            'ticker':        lookup + '.NS',
            'price':         price,
            'prevClose':     prev_close,
            'dma50':         dma50,
            'dma200':        dma200,
            'week52High':    round(float(wk52_high), 2) if wk52_high else None,
            'week52Low':     round(float(wk52_low),  2) if wk52_low  else None,
            'marketCap':     market_cap,
            'pe':            pe,
            'sectorPe':      sector_pe,
            'eps':           sc.get('eps'),
            'roe':           sc.get('roe'),
            'netMargin':     None,
            'debtEquity':    sc.get('debtEquity'),
            'beta':          None,
            'bookValue':     sc.get('bookValue'),
            'dividendYield': sc.get('dividendYield'),
            'analystTarget': None,
            'closes':        closes[-55:],
        }
    except Exception:
        return None


if __name__ == '__main__':
    try:
        holdings = json.loads(sys.stdin.read())
        init_session()

        nse_symbols = set()
        for item in holdings:
            nse_symbols.add(SYMBOL_OVERRIDE.get(item['symbol'], item['symbol']))

        print('[prices/stocks] Updating historical price cache...', file=sys.stderr)
        history_cache = update_history(nse_symbols, needed_days=210)

        # Load screener cache and refresh stale entries
        screener_cache = load_screener_cache()
        screener_map   = {}
        for item in holdings:
            sym = item['symbol']
            sc_data = get_screener_data(sym, screener_cache)
            screener_map[sym] = sc_data
        save_screener_cache(screener_cache)

        results = {}
        for item in holdings:
            symbol = item['symbol']
            result = fetch(
                symbol,
                item.get('avgCost'),
                item.get('exchange'),
                history_cache,
                screener_map.get(symbol, {}),
            )
            results[symbol] = result
            time.sleep(0.3)

        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
