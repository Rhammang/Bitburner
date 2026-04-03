import {
  STOCKS_STATUS_FILE,
  STOCKS_HISTORY_FILE,
  STOCKS_HISTORY_CAPACITY,
  STOCKS_EVENT_CAPACITY,
  STOCKS_LOOP_MS,
  STOCKS_BUY_THRESHOLD,
  STOCKS_SELL_THRESHOLD,
  STOCKS_COMMISSION,
  STOCKS_MAX_PORTFOLIO_FRACTION,
  STOCKS_PER_STOCK_FRACTION,
  STOCKS_MIN_CASH_RESERVE,
  load_config,
} from "/modules/runtime-contracts.js";

// ── History state (in-memory, serialized to JSON each tick) ─────────

/** @type {Object<string, {samples: Array, events: Array}>} */
const history = {};

function push_sample(sym, sample) {
  if (!history[sym]) history[sym] = { samples: [], events: [] };
  const ring = history[sym].samples;
  if (ring.length >= STOCKS_HISTORY_CAPACITY) ring.shift();
  ring.push(sample);
}

function push_event(sym, event) {
  if (!history[sym]) history[sym] = { samples: [], events: [] };
  const ring = history[sym].events;
  if (ring.length >= STOCKS_EVENT_CAPACITY) ring.shift();
  ring.push(event);
}

// ── Market snapshot ─────────────────────────────────────────────────

function build_market_snapshot(ns, symbols) {
  const snapshot = {};
  for (const sym of symbols) {
    const [long_shares, long_price] = ns.stock.getPosition(sym);
    const bid = ns.stock.getBidPrice(sym);
    const ask = ns.stock.getAskPrice(sym);
    const price = ns.stock.getPrice(sym);
    const forecast = ns.stock.getForecast(sym);
    const volatility = ns.stock.getVolatility(sym);
    const adjusted = forecast - volatility;
    const max_shares = ns.stock.getMaxShares(sym);

    snapshot[sym] = {
      bid, ask, price, forecast, volatility, adjusted, max_shares,
      long_shares, long_price,
      value: long_shares > 0 ? long_shares * bid : 0,
      cost: long_shares > 0 ? long_shares * long_price : 0,
    };
  }
  return snapshot;
}

// ── Main ────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!ns.stock.hasTIXAPIAccess()) {
    write_status(ns, "waiting-tix", { positions: 0, value: 0, profit: 0 });
    ns.tprint("STOCKS: No TIX API access. Waiting.");
    return;
  }

  const has_4s = ns.stock.has4SDataTIXAPI();
  if (!has_4s) {
    write_status(ns, "waiting-4s", { positions: 0, value: 0, profit: 0 });
    ns.tprint("STOCKS: TIX access OK but no 4S data. Waiting.");
    return;
  }

  ns.tprint("STOCKS: 4S data available. Starting trading loop.");
  let total_profit = 0;

  while (true) {
    const cfg = load_config(ns);
    const reserve_fraction = cfg.buyServers?.budgetFraction || 0.25;
    const symbols = ns.stock.getSymbols();
    const player_money = ns.getPlayer().money;

    // Build single snapshot — all API calls happen here
    const snapshot = build_market_snapshot(ns, symbols);

    // Build portfolio from snapshot
    const portfolio = [];
    let portfolio_value = 0;
    for (const sym of symbols) {
      const s = snapshot[sym];
      if (s.long_shares > 0) {
        portfolio.push({
          sym,
          shares: s.long_shares,
          avgPrice: s.long_price,
          value: s.value,
          profit: s.value - s.cost,
        });
        portfolio_value += s.value;
      }
    }

    const total_worth = player_money + portfolio_value;
    const max_invested = total_worth * STOCKS_MAX_PORTFOLIO_FRACTION;
    const per_stock_cap = total_worth * STOCKS_PER_STOCK_FRACTION;

    // Sell positions where volatility-adjusted forecast has turned unfavorable
    for (const pos of portfolio) {
      const s = snapshot[pos.sym];
      if (s.adjusted < STOCKS_SELL_THRESHOLD) {
        const revenue = ns.stock.sellStock(pos.sym, pos.shares);
        if (revenue > 0) {
          const profit = revenue - (pos.shares * pos.avgPrice);
          total_profit += profit;
          push_event(pos.sym, [Date.now(), "sell", pos.shares, revenue / pos.shares, profit]);
          ns.tprint(
            `STOCKS: Sold ${pos.sym} ${ns.formatNumber(pos.shares)} shares ` +
            `${profit >= 0 ? "+" : ""}$${ns.formatNumber(profit)}`
          );
        }
      }
    }

    // Buy stocks with strong volatility-adjusted forecasts
    const buy_candidates = [];
    for (const sym of symbols) {
      const s = snapshot[sym];
      if (s.adjusted > STOCKS_BUY_THRESHOLD) {
        const expected_return = (s.forecast - 0.5) * s.volatility;
        buy_candidates.push({ sym, forecast: s.forecast, volatility: s.volatility, expected_return });
      }
    }

    // Sort by expected return descending
    buy_candidates.sort((a, b) => b.expected_return - a.expected_return);

    for (const candidate of buy_candidates) {
      const s = snapshot[candidate.sym];
      const current_position_value = s.long_shares * s.ask;

      // Skip if already at per-stock cap
      if (current_position_value >= per_stock_cap) continue;

      // How much can we spend?
      const cash = ns.getPlayer().money;
      const cash_reserve = Math.max(STOCKS_MIN_CASH_RESERVE, total_worth * reserve_fraction);
      const available = Math.min(
        cash - cash_reserve - STOCKS_COMMISSION,
        max_invested - portfolio_value,
        per_stock_cap - current_position_value
      );
      if (available < s.ask + STOCKS_COMMISSION) continue;

      const shares_to_buy = Math.min(
        s.max_shares - s.long_shares,
        Math.floor(available / s.ask)
      );
      if (shares_to_buy <= 0) continue;

      const cost = ns.stock.buyStock(candidate.sym, shares_to_buy);
      if (cost > 0) {
        portfolio_value += cost;
        push_event(candidate.sym, [Date.now(), "buy", shares_to_buy, cost / shares_to_buy, null]);
        ns.tprint(
          `STOCKS: Bought ${candidate.sym} ${ns.formatNumber(shares_to_buy)} shares ` +
          `$${ns.formatNumber(cost)} (forecast ${(candidate.forecast * 100).toFixed(1)}%)`
        );
      }
    }

    // Record price samples for all symbols
    const now = Date.now();
    for (const sym of symbols) {
      const s = snapshot[sym];
      push_sample(sym, [now, s.price, s.forecast, s.volatility, s.adjusted]);
    }

    // Refresh portfolio for final status (positions may have changed from trades)
    const final_positions_map = {};
    let final_positions = 0;
    let final_value = 0;
    let unrealized = 0;
    for (const sym of symbols) {
      const [long_shares, long_price] = ns.stock.getPosition(sym);
      if (long_shares > 0) {
        final_positions++;
        const bid = ns.stock.getBidPrice(sym);
        const value = long_shares * bid;
        final_value += value;
        unrealized += value - (long_shares * long_price);
        final_positions_map[sym] = {
          shares: long_shares,
          avgPrice: long_price,
          value,
          unrealized: value - (long_shares * long_price),
        };
      }
    }

    write_status(ns, "active", {
      positions: final_positions,
      value: final_value,
      unrealizedProfit: unrealized,
      realizedProfit: total_profit,
      profit: total_profit + unrealized,
    });

    write_history(ns, symbols, final_positions_map);

    await ns.sleep(STOCKS_LOOP_MS);
  }
}

// ── Status writers ──────────────────────────────────────────────────

function write_status(ns, state, data) {
  const line = `${state}|${JSON.stringify(data)}`;
  ns.write(STOCKS_STATUS_FILE, line, "w");
}

function write_history(ns, symbols, positions) {
  const sym_data = {};
  for (const sym of symbols) {
    const h = history[sym] || { samples: [], events: [] };
    const last_sample = h.samples.length > 0 ? h.samples[h.samples.length - 1] : null;
    sym_data[sym] = {
      samples: h.samples,
      events: h.events,
      position: positions[sym] || null,
      last: last_sample ? {
        price: last_sample[1],
        forecast: last_sample[2],
        volatility: last_sample[3],
        adjusted: last_sample[4],
      } : null,
    };
  }

  const payload = {
    version: 1,
    updatedAt: Date.now(),
    sampleMs: STOCKS_LOOP_MS,
    capacity: STOCKS_HISTORY_CAPACITY,
    thresholds: { buy: STOCKS_BUY_THRESHOLD, sell: STOCKS_SELL_THRESHOLD },
    symbols: sym_data,
  };

  ns.write(STOCKS_HISTORY_FILE, JSON.stringify(payload), "w");
}
