#!/usr/bin/env python3
"""
Price fetcher using NSE India API — replaces yfinance (Yahoo Finance blocks cloud IPs).
Fetches: price, prevClose, 52-week range, PE, historical closes for RSI.
Called from Node.js: echo '[{"symbol":...}]' | python3 fetch_prices.py
"""
import sys, json, time, datetime
import requests

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Referer': 'https://www.nseindia.com/',
    'Connection': 'keep-alive',
})

# ICICI Direct uses internal short codes — map to NSE registered symbols
SYMBOL_OVERRIDE = {
    'ICICIGOLD':  'GOLDIETF',      # ICICI Prudential Gold ETF
    'ICICIALPLV': 'ALPL30IETF',   # ICICI Prudential Nifty Alpha Low-Volatility 30 ETF
    'ICICISILVE': 'SILVERIETF',   # ICICI Prudential Silver ETF
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

def nse_history(symbol, days=45):
    """Fetch historical closes for RSI. NSE returns newest-first — reversed to chronological."""
    today = datetime.date.today()
    frm   = today - datetime.timedelta(days=days * 2)  # extra buffer for weekends/holidays
    url   = (
        f'https://www.nseindia.com/api/historical/cm/equity'
        f'?symbol={symbol}&series=["EQ"]'
        f'&from={frm.strftime("%d-%m-%Y")}&to={today.strftime("%d-%m-%Y")}'
    )
    try:
        r      = SESSION.get(url, timeout=20)
        rows   = r.json().get('data', [])
        closes = [float(row['CH_CLOSING_PRICE']) for row in rows if row.get('CH_CLOSING_PRICE')]
        return closes[::-1]  # reverse to chronological order (oldest first)
    except Exception:
        return []

def fetch(symbol, avg_cost=None, stored_exchange=None):
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

        # Sanity check vs known avg cost (catches wrong-stock mismatches)
        if avg_cost and avg_cost > 0:
            ratio = price / avg_cost
            if ratio < 0.35 or ratio > 3.0:
                return None

        wh        = pi.get('weekHighLow', {})
        wk52_high = wh.get('max')
        wk52_low  = wh.get('min')

        # PE from metadata
        pe = None
        try:
            pe_raw = d.get('metadata', {}).get('pdSymbolPe')
            if pe_raw:
                pe = round(float(pe_raw), 2)
        except Exception:
            pass

        closes = nse_history(lookup)

        return {
            'symbol':        symbol,
            'exchange':      'NSE',
            'ticker':        lookup + '.NS',
            'price':         price,
            'prevClose':     prev_close,
            'dma50':         None,
            'dma200':        None,
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
            'closes':        closes,
        }
    except Exception:
        return None


if __name__ == '__main__':
    try:
        holdings = json.loads(sys.stdin.read())
        init_session()
        results = {}
        for item in holdings:
            symbol = item['symbol']
            result = fetch(symbol, item.get('avgCost'), item.get('exchange'))
            results[symbol] = result
            time.sleep(0.3)
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
