#!/usr/bin/env python3
"""
Price fetcher for Indian stocks/ETFs using yfinance fast_info + history.
Uses only 2 network calls per symbol (fast_info + history) to avoid rate limits.
Called from Node.js: echo '[{"symbol":...}]' | python3 fetch_prices.py
"""
import sys, json, time
import yfinance as yf

def fetch(symbol, avg_cost=None, stored_exchange=None):
    # Use correct NSE ticker if symbol is an ICICI internal code
    lookup_symbol = SYMBOL_OVERRIDE.get(symbol, symbol)
    suffixes = ['.NS', '.BO']
    if stored_exchange == 'BSE':
        suffixes = ['.BO', '.NS']

    for suffix in suffixes:
        ticker = lookup_symbol + suffix
        try:
            t = yf.Ticker(ticker)
            fi = t.fast_info

            price = getattr(fi, 'last_price', None)
            if not price or price <= 0:
                continue

            # Sanity check vs known avg cost (catches wrong-stock mismatches)
            if avg_cost and avg_cost > 0:
                ratio = price / avg_cost
                if ratio < 0.35 or ratio > 3.0:
                    continue

            # Get 40-day history for RSI + reliable prevClose
            closes = []
            try:
                hist = t.history(period='40d', interval='1d')
                closes = [float(c) for c in hist['Close'].dropna().tolist() if c > 0]
            except:
                pass

            # prevClose = previous trading day's close
            # fast_info.previous_close is the most reliable source.
            # closes[-2] is fallback (closes[-1] may be today's intraday value).
            prev_close_fast = getattr(fi, 'previous_close', None)
            if prev_close_fast and prev_close_fast > 0:
                prev_close = prev_close_fast
            elif len(closes) >= 2:
                prev_close = closes[-2]  # second-to-last = yesterday's close
            elif len(closes) == 1:
                prev_close = closes[0]
            else:
                prev_close = price

            # Technical fields from fast_info (no extra network call needed)
            dma50   = getattr(fi, 'fifty_day_average',       None)
            dma200  = getattr(fi, 'two_hundred_day_average',  None)
            wk52hi  = getattr(fi, 'year_high',               None)
            wk52lo  = getattr(fi, 'year_low',                None)
            mktcap  = getattr(fi, 'market_cap',              None)

            # Fundamentals from t.info (skip silently if rate-limited)
            pe = beta = book_value = div_yield = analyst_target = None
            try:
                info = t.info or {}
                def _f(key):
                    v = info.get(key)
                    return float(v) if v and not isinstance(v, str) else None

                pe             = _f('trailingPE')
                beta           = _f('beta')
                book_value     = _f('bookValue')
                div_yield      = _f('dividendYield')
                analyst_target = _f('targetMeanPrice')
                eps            = _f('trailingEps')
                roe            = _f('returnOnEquity')   # decimal e.g. 0.18 = 18%
                debt_equity    = _f('debtToEquity')
                if pe:           pe           = round(pe, 2)
                if beta:         beta         = round(beta, 2)
                if book_value:   book_value   = round(book_value, 2)
                if div_yield:    div_yield    = round(div_yield, 2)
                if analyst_target: analyst_target = round(analyst_target, 2)
                if eps:          eps          = round(eps, 2)
                if roe:          roe          = round(roe * 100, 1)  # to %
                if debt_equity:  debt_equity  = round(debt_equity, 2)
            except Exception:
                pass

            return {
                'symbol':         symbol,
                'exchange':       'BSE' if suffix == '.BO' else 'NSE',
                'ticker':         ticker,
                'price':          round(float(price), 2),
                'prevClose':      round(float(prev_close), 2) if prev_close else None,
                'dma50':          round(float(dma50),  2) if dma50  else None,
                'dma200':         round(float(dma200), 2) if dma200 else None,
                'week52High':     round(float(wk52hi), 2) if wk52hi else None,
                'week52Low':      round(float(wk52lo), 2) if wk52lo else None,
                'marketCap':      int(mktcap) if mktcap else None,
                'pe':             pe,
                'eps':            eps,
                'roe':            roe,
                'debtEquity':     debt_equity,
                'beta':           beta,
                'bookValue':      book_value,
                'dividendYield':  div_yield,
                'analystTarget':  analyst_target,
                'closes':         closes,
            }
        except Exception as e:
            continue  # try next suffix

    return None

# ICICI Direct uses internal short codes that don't match NSE registered symbols.
# Map them to the correct NSE tickers for yfinance.
SYMBOL_OVERRIDE = {
    'ICICIGOLD':  'GOLDIETF',    # ICICI Prudential Gold ETF
    'ICICIALPLV': 'ALPL30IETF',  # ICICI Prudential Nifty Alpha Low-Volatility 30 ETF
    'ICICISILVE': 'SILVERIETF',  # ICICI Prudential Silver ETF
}

UNSUPPORTED_SYMBOLS = set()  # all symbols now supported

if __name__ == '__main__':
    try:
        data = json.loads(sys.stdin.read())
        results = {}
        for item in data:
            if item['symbol'] in UNSUPPORTED_SYMBOLS:
                results[item['symbol']] = None  # keep existing data, skip refresh
                continue
            symbol = item['symbol']
            avg    = item.get('avgCost')
            exch   = item.get('exchange')
            result = fetch(symbol, avg, exch)
            results[symbol] = result
            # Small delay to avoid rate limiting
            time.sleep(0.5)
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
