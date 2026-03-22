import {
  STOCKS_STATUS_FILE,
  load_config,
} from "/modules/runtime-contracts.js";

const COMMISSION = 100000; // $100k per transaction
const BUY_THRESHOLD = 0.55; // buy when (forecast - volatility) > this — hysteresis band upper
const SELL_THRESHOLD = 0.51; // sell when (forecast - volatility) < this — hysteresis band lower
const MAX_PORTFOLIO_FRACTION = 0.75; // never invest more than 75% of total money
const PER_STOCK_FRACTION = 0.2; // max 20% of portfolio per stock
const MIN_CASH_RESERVE = 5000000; // keep at least $5M liquid
const LOOP_MS = 6000; // 6s loop (stock ticks are ~6s)

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

    // Build portfolio snapshot
    const portfolio = [];
    let portfolio_value = 0;
    for (const sym of symbols) {
      const [long_shares, long_price, short_shares, short_price] = ns.stock.getPosition(sym);
      if (long_shares > 0) {
        const current_price = ns.stock.getBidPrice(sym);
        const value = long_shares * current_price;
        const cost = long_shares * long_price;
        portfolio.push({ sym, shares: long_shares, avgPrice: long_price, value, profit: value - cost });
        portfolio_value += value;
      }
    }

    const total_worth = player_money + portfolio_value;
    const max_invested = total_worth * MAX_PORTFOLIO_FRACTION;
    const per_stock_cap = total_worth * PER_STOCK_FRACTION;

    // Sell positions where volatility-adjusted forecast has turned unfavorable
    for (const pos of portfolio) {
      const forecast = ns.stock.getForecast(pos.sym);
      const volatility = ns.stock.getVolatility(pos.sym);
      const adjusted = forecast - volatility;
      if (adjusted < SELL_THRESHOLD) {
        const revenue = ns.stock.sellStock(pos.sym, pos.shares);
        if (revenue > 0) {
          // revenue from sellStock() is net of commission already
          const profit = revenue - (pos.shares * pos.avgPrice);
          total_profit += profit;
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
      const forecast = ns.stock.getForecast(sym);
      const volatility = ns.stock.getVolatility(sym);
      const adjusted = forecast - volatility;
      if (adjusted > BUY_THRESHOLD) {
        const expected_return = (forecast - 0.5) * volatility;
        buy_candidates.push({ sym, forecast, volatility, expected_return });
      }
    }

    // Sort by expected return descending
    buy_candidates.sort((a, b) => b.expected_return - a.expected_return);

    for (const candidate of buy_candidates) {
      const [long_shares] = ns.stock.getPosition(candidate.sym);
      const ask_price = ns.stock.getAskPrice(candidate.sym);
      const max_shares = ns.stock.getMaxShares(candidate.sym);
      const current_position_value = long_shares * ask_price;

      // Skip if already at per-stock cap
      if (current_position_value >= per_stock_cap) continue;

      // How much can we spend?
      const cash = ns.getPlayer().money;
      // Reserve money for server purchases and keep minimum liquid
      const cash_reserve = Math.max(MIN_CASH_RESERVE, total_worth * reserve_fraction);
      const available = Math.min(
        cash - cash_reserve - COMMISSION,
        max_invested - portfolio_value,
        per_stock_cap - current_position_value
      );
      if (available < ask_price + COMMISSION) continue;

      const shares_to_buy = Math.min(
        max_shares - long_shares,
        Math.floor(available / ask_price)
      );
      if (shares_to_buy <= 0) continue;

      const cost = ns.stock.buyStock(candidate.sym, shares_to_buy);
      if (cost > 0) {
        portfolio_value += cost;
        ns.tprint(
          `STOCKS: Bought ${candidate.sym} ${ns.formatNumber(shares_to_buy)} shares ` +
          `$${ns.formatNumber(cost)} (forecast ${(candidate.forecast * 100).toFixed(1)}%)`
        );
      }
    }

    // Refresh portfolio for status
    let final_positions = 0;
    let final_value = 0;
    let unrealized = 0;
    for (const sym of symbols) {
      const [long_shares, long_price] = ns.stock.getPosition(sym);
      if (long_shares > 0) {
        final_positions++;
        const value = long_shares * ns.stock.getBidPrice(sym);
        final_value += value;
        unrealized += value - (long_shares * long_price);
      }
    }

    write_status(ns, "active", {
      positions: final_positions,
      value: final_value,
      unrealizedProfit: unrealized,
      realizedProfit: total_profit,
      profit: total_profit + unrealized,
    });

    await ns.sleep(LOOP_MS);
  }
}

function write_status(ns, state, data) {
  const line = `${state}|${JSON.stringify(data)}`;
  ns.write(STOCKS_STATUS_FILE, line, "w");
}
