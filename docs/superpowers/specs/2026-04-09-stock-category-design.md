# Stock Category — Design Spec
**Date:** 2026-04-09  
**Status:** Approved

---

## Overview

Add a "Stock Category" feature that lets the user manually split each stock holding between a **Primary** account (where trading happens) and a **Secondary** account (demat-only). The Stocks tab then renders two separate sections — Primary on top, Secondary below — each with its own totals.

---

## Feature 1: Settings → "Stock Category" sub-tab

### Placement
New first sub-tab in the Settings tab:
`📋 Stock Category` | `💰 MF SIPs` | `📊 ETF SIPs` | `📈 Projection Assumptions`

### UI: Stock Category Table

A table listing every stock from `portfolio.stocks`:

| STOCK | TOTAL QTY | PRIMARY | SECONDARY | STATUS |
|-------|-----------|---------|-----------|--------|
| AARTIIND | 33 | `[number input]` | `[number input]` | ✓ or ⚠ |

- **TOTAL QTY**: read-only, from `portfolio.stocks`
- **PRIMARY**: number input, min 0
- **SECONDARY**: number input, min 0
- **STATUS column**:
  - ✓ (green) if `primary + secondary === totalQty`
  - ⚠ `"X + Y = Z ≠ 33"` (red) if they don't match
- Footer summary: `"N stocks split correctly, M need attention"`
- **Save button**: disabled until all rows are valid (all match total qty). On click, calls `POST /api/stock-category`.
- Stocks not yet categorized default to `{ primary: totalQty, secondary: 0 }` — so nothing disappears until the user explicitly changes the split.

### Behavior
- Inputs accept only non-negative integers
- Both fields are free-form (user sets both; no auto-calculation)
- Validation is per-row and real-time (updates status column on input change)
- Save is all-or-nothing (all rows must be valid)

---

## Feature 2: Stocks tab → Primary / Secondary sections

### Layout
Two sections separated by a visual divider:

```
┌─────────────────────────────────────────┐
│  PRIMARY ACCOUNT                        │
│  [summary strip: invested/value/P&L/today] │
│  [stock table — rows with primaryQty]   │
├─────────────────────────────────────────┤
│  SECONDARY ACCOUNT                      │
│  [summary strip: invested/value/P&L/today] │
│  [stock table — rows with secondaryQty] │
└─────────────────────────────────────────┘
```

- A stock appears in **Primary** only if `primaryQty > 0`
- A stock appears in **Secondary** only if `secondaryQty > 0`
- The `QTY` column shows the account-specific qty (not total)
- All other columns (AVG, LTP, VALUE, P&L, TODAY, HEALTH, 52W, details) behave identically to today, but calculated with account qty

### P&L Calculations (per section)
```
value     = ltp × accountQty
invested  = avgCost × accountQty
plAbsolute = value − invested
plPct     = plAbsolute / invested × 100
todayPL   = (todayPLPct / 100) × ltp × accountQty
```

### Summary Strip (per section)
Same fields as today's stocks summary strip:
- Invested, Value, P&L, Today, Winners/Losers, Health counts

### Uncategorized Stocks
If a stock has no entry in `stock_category.json`, it defaults to `primary = totalQty, secondary = 0`. This means the Primary section behaves exactly like today until the user sets a split.

### Existing Sort/Filter
Sort and filter apply within each section independently (same controls, same logic).

---

## Data Storage

**File:** `storage/stock_category.json`

```json
{
  "AARTIIND": { "primary": 0, "secondary": 33 },
  "ADANIPORTS": { "primary": 11, "secondary": 0 },
  "BHARTIARTL": { "primary": 5, "secondary": 8 }
}
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stock-category` | Returns `storage/stock_category.json` or `{}` |
| POST | `/api/stock-category` | Validates and saves the full map |

`POST` body: `{ "AARTIIND": { "primary": 0, "secondary": 33 }, ... }`

Server validation: for each symbol, verify that the symbol exists in `portfolio.stocks` (no phantom entries). Does NOT re-validate qty sum — that's enforced client-side.

---

## Data Sources Tab
No changes. Upload cards remain primary-account-only, which is correct since trading (and hence all file exports from Zerodha/ICICI) happens only in the primary account.

---

## Out of Scope
- No secondary-specific data source uploads
- No automated detection of which account a stock belongs to
- No history tracking of category changes
