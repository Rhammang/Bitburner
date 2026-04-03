# Stocks Model

## Capability Gating

Check APIs before trading — missing access is not an error, it's a wait state:

1. `ns.stock.hasTIXAPIAccess()` — if false, set status `waiting-tix` and
   return. Do not disable the module.
2. `ns.stock.has4SDataTIXAPI()` — if false, set status `waiting-4s` and
   return. Do not disable the module.
3. With both APIs: run forecast-based trading with volatility-adjusted
   thresholds.

Disable only for true API-surface mismatch (unexpected environment).

## Trading Thresholds

- Buy threshold: forecast > 0.55
- Sell threshold: forecast < 0.51
- Hysteresis band prevents whipsaw trades.

## Portfolio Limits

- Max 75% of total worth invested at any time.
- Max 20% of total worth in any single stock.
- Minimum $5M cash reserve plus a server-purchase reserve fraction.

## Status

Written to `data/stocks_status.txt` as `state|{json}`.

## Price History

The stocks module writes `/data/stocks_history.json` each tick containing:
- Per-symbol price/forecast/volatility samples (ring buffer, 180 capacity)
- Buy/sell event log (ring buffer, 50 per symbol)
- Current position data (shares, avgPrice, value, unrealized)
- Trading thresholds and metadata

This file is the data source for `stock-graph.js`. It is a runtime cache
(overwritten from fresh state on module restart), not durable history.

## Stock Graph Viewer

`stock-graph.js` is a standalone React/SVG viewer that renders in a tail
window. Not daemon-managed — run manually when you want to see charts.

See `tooling.md` for usage flags.
