#!/usr/bin/env python3
"""
Price fetcher for Indian stocks using yfinance.
Called from Node.js: python3 fetch_prices.py SYMBOL1 SYMBOL2 ...
Returns JSON: { "SYMBOL": { "price": X, "prevClose": X, "dma50": X, ... }, ... }
Tries NSE (.NS) first, then BSE (.BO), validates price vs avgCost.
"""
import sys
import json
import yfinance as yf

def fetch(symbol, avg_cost=None, stored_exchange=None):
    suffixes = ['.NS', '.BO']
    if stored_exchange == 'BSE':
        suffixes = ['.BO', '.NS']

    for suffix in suffixes:
        ticker = symbol + suffix
        try:
            t = yf.Ticker(ticker)
            fi = t.fast_info

            price = getattr(fi, 'last_price', None)
            if not price or price <= 0:
                continue

            # Sanity check vs avgCost
            if avg_cost and avg_cost > 0:
                ratio = price / avg_cost
                if ratio < 0.4 or ratio > 2.5:
                    continue

            # Get more info
            info = {}
            try:
                info = t.info or {}
            except:
                pass

            prev_close = getattr(fi, 'previous_close', None) or info.get('previousClose')
            dma50      = info.get('fiftyDayAverage')
            dma200     = info.get('twoHundredDayAverage')
            wk52high   = getattr(fi, 'year_high', None) or info.get('fiftyTwoWeekHigh')
            wk52low    = getattr(fi, 'year_low', None)  or info.get('fiftyTwoWeekLow')
            pe         = info.get('trailingPE')
            mktcap     = info.get('marketCap')

            # Historical closes for RSI (30 days)
            closes = []
            try:
                hist = t.history(period='40d', interval='1d')
                closes = [float(c) for c in hist['Close'].dropna().tolist() if c > 0]
            except:
                pass

            return {
                'symbol': symbol,
                'exchange': 'BSE' if suffix == '.BO' else 'NSE',
                'ticker': ticker,
                'price': round(price, 2),
                'prevClose': round(prev_close, 2) if prev_close else None,
                'dma50':     round(dma50, 2)      if dma50     else None,
                'dma200':    round(dma200, 2)     if dma200    else None,
                'week52High':round(wk52high, 2)   if wk52high  else None,
                'week52Low': round(wk52low, 2)    if wk52low   else None,
                'pe':        round(pe, 2)          if pe        else None,
                'marketCap': mktcap,
                'closes':    closes,
            }
        except Exception as e:
            continue

    return None

if __name__ == '__main__':
    # Input: JSON on stdin with list of {symbol, avgCost, exchange}
    try:
        data = json.loads(sys.stdin.read())
        results = {}
        for item in data:
            symbol = item['symbol']
            avg    = item.get('avgCost')
            exch   = item.get('exchange')
            result = fetch(symbol, avg, exch)
            results[symbol] = result
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
