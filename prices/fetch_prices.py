#!/usr/bin/env python3
"""
Price fetcher using NSE India API + NSE Archives bhav copy.
- Live price/PE/52wk: NSE quote API
- Historical closes for RSI/DMA: NSE Archives daily CSV (cached to data/price_history.json)
Called from Node.js: echo '[{"symbol":...}]' | python3 fetch_prices.py
"""
import sys, json, time, datetime, os, urllib.request
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
DATA_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
HISTORY_FILE = os.path.join(DATA_DIR, 'price_history.json')

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

    # Collect dates we already have (that have at least one of our symbols)
    have_dates = set()
    for d_str, row in cache.items():
        if any(sym in row for sym in symbols):
            have_dates.add(d_str)

    # Walk backwards from yesterday, download missing trading days
    downloads = 0
    current = today - datetime.timedelta(days=1)
    trading_days_found = len(have_dates)

    while trading_days_found < needed_days and downloads < 250:
        if current.weekday() >= 5:  # skip weekends
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
        # if None, it's a holiday — skip and don't count

        current -= datetime.timedelta(days=1)

    if downloads > 0:
        save_history_cache(cache)
    return cache

def get_closes(symbol, cache, days=210):
    """Return chronological closes for symbol from cache."""
    closes = []
    for d_str in sorted(cache.keys()):
        if symbol in cache[d_str]:
            closes.append(cache[d_str][symbol])
    return closes[-days:]

# ── Per-symbol fetch ───────────────────────────────────────────────────────
def fetch(symbol, avg_cost=None, stored_exchange=None, history_cache=None):
    lookup = SYMBOL_OVERRIDE.get(symbol, symbol)
    try:
        d  = nse_quote(lookup)
        pi = d.get('priceInfo', {})

        price = pi.get('lastPrice') or pi.get('close')
        if not price or float(price) <= 0:
            return None

        price      = round(float(price), 2)
        prev_close = pi.get('previousClose')
        prev_close = round(float(prev_close), 2) if prev_close else price

        if avg_cost and avg_cost > 0:
            ratio = price / avg_cost
            if ratio < 0.35 or ratio > 3.0:
                return None

        wh        = pi.get('weekHighLow', {})
        wk52_high = wh.get('max')
        wk52_low  = wh.get('min')

        pe = None
        try:
            pe_raw = d.get('metadata', {}).get('pdSymbolPe')
            if pe_raw:
                pe = round(float(pe_raw), 2)
        except Exception:
            pass

        closes = get_closes(lookup, history_cache) if history_cache else []

        # Calculate DMA50/DMA200 from cached closes
        dma50  = round(sum(closes[-50:])  / len(closes[-50:]),  2) if len(closes) >= 50  else None
        dma200 = round(sum(closes[-200:]) / len(closes[-200:]), 2) if len(closes) >= 200 else None

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
            'marketCap':     None,
            'pe':            pe,
            'eps':           None,
            'roe':           None,
            'netMargin':     None,
            'debtEquity':    None,
            'beta':          None,
            'bookValue':     None,
            'dividendYield': None,
            'analystTarget': None,
            'closes':        closes[-55:],  # last 55 days for RSI (14-period needs ~28+)
        }
    except Exception:
        return None


if __name__ == '__main__':
    try:
        holdings = json.loads(sys.stdin.read())
        init_session()

        # All NSE symbols we need history for
        nse_symbols = set()
        for item in holdings:
            sym = item['symbol']
            nse_symbols.add(SYMBOL_OVERRIDE.get(sym, sym))

        # Update history cache (downloads missing dates, uses cache for known dates)
        print('[prices/stocks] Updating historical price cache...', file=sys.stderr)
        history_cache = update_history(nse_symbols, needed_days=210)

        results = {}
        for item in holdings:
            symbol = item['symbol']
            result = fetch(symbol, item.get('avgCost'), item.get('exchange'), history_cache)
            results[symbol] = result
            time.sleep(0.3)

        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
