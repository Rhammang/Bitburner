/**
 * Stock Price Graph — standalone React/SVG viewer for Bitburner stock data.
 * Usage: run stock-graph.js [--sym ECP] [--owned-only] [--sort value] [--count 15] [--rotate 0] [--refresh 2000]
 *
 * Reads /data/stocks_history.json written by the stocks module and renders
 * interactive SVG charts in a tail window via ns.printRaw().
 *
 * @param {NS} ns
 */

import {
  STOCKS_HISTORY_FILE,
  STOCKS_BUY_THRESHOLD,
  STOCKS_SELL_THRESHOLD,
} from "/modules/runtime-contracts.js";

const h = React.createElement;

const ARGS_SCHEMA = [
  ["sym", ""],
  ["owned-only", false],
  ["sort", "value"],
  ["count", 15],
  ["rotate", 0],
  ["refresh", 2000],
];

// ── Colors ──────────────────────────────────────────────────────────

const C = {
  bg: "#1a1a2e",
  chartBg: "#0f0f23",
  price: "#60a5fa",
  signal: "#c084fc",
  buy: "#4ade80",
  sell: "#f87171",
  neutral: "#facc15",
  text: "#c0c0c0",
  label: "#888",
  grid: "#333",
  dim: "#555",
  border: "#2a2a4e",
  highlight: "#2a2a4e",
};

// ── Entry point ─────────────────────────────────────────────────────

export function autocomplete(data) {
  data.flags(ARGS_SCHEMA);
  return [];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tail();
  const flags = ns.flags(ARGS_SCHEMA);
  let last_updated = 0;
  let focus_sym = flags.sym || "";
  let rotate_timer = 0;

  while (true) {
    const data = read_history(ns);
    if (!data) {
      ns.clearLog();
      ns.printRaw(h("div", { style: { fontFamily: "monospace", color: C.label, padding: "12px" } },
        "Waiting for stock history data...",
        h("br"),
        "Ensure the stocks module is running with 4S data access.",
      ));
      await ns.sleep(flags.refresh);
      continue;
    }

    if (data.updatedAt === last_updated) {
      await ns.sleep(flags.refresh);
      continue;
    }
    last_updated = data.updatedAt;

    // Handle auto-rotation
    if (flags.rotate > 0) {
      rotate_timer += flags.refresh;
      if (rotate_timer >= flags.rotate * 1000) {
        rotate_timer = 0;
        focus_sym = next_symbol(data, focus_sym, flags["owned-only"]);
      }
    }

    const resolved_focus = select_focus(data, focus_sym, flags["owned-only"]);
    const sorted = build_sorted_list(data, flags);

    ns.clearLog();
    ns.printRaw(h(StockGraphApp, { data, focus: resolved_focus, sorted, flags }));

    await ns.sleep(flags.refresh);
  }
}

// ── Data reader ─────────────────────────────────────────────────────

function read_history(ns) {
  const raw = ns.read(STOCKS_HISTORY_FILE);
  if (!raw || !raw.trim()) return null;
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !data.symbols) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Focus & sorting ─────────────────────────────────────────────────

function select_focus(data, requested, owned_only) {
  const syms = Object.keys(data.symbols);
  if (requested && data.symbols[requested]) return requested;

  // Default: largest held position by value
  let best = "";
  let best_val = -1;
  for (const sym of syms) {
    const pos = data.symbols[sym].position;
    if (pos && pos.value > best_val) {
      best = sym;
      best_val = pos.value;
    }
  }
  // Fallback: highest adjusted signal
  if (!best) {
    best_val = -Infinity;
    for (const sym of syms) {
      const adj = data.symbols[sym].last?.adjusted || 0;
      if (adj > best_val) { best = sym; best_val = adj; }
    }
  }
  return best || syms[0] || "";
}

function next_symbol(data, current, owned_only) {
  let syms = Object.keys(data.symbols);
  if (owned_only) syms = syms.filter(s => data.symbols[s].position);
  if (syms.length === 0) return "";
  const idx = syms.indexOf(current);
  return syms[(idx + 1) % syms.length];
}

function build_sorted_list(data, flags) {
  let syms = Object.keys(data.symbols);
  if (flags["owned-only"]) {
    syms = syms.filter(s => data.symbols[s].position);
  }

  const sort_key = flags.sort;
  syms.sort((a, b) => {
    const da = data.symbols[a];
    const db = data.symbols[b];
    if (sort_key === "value") return (db.position?.value || 0) - (da.position?.value || 0);
    if (sort_key === "profit") return (db.position?.unrealized || 0) - (da.position?.unrealized || 0);
    if (sort_key === "adjusted") return (db.last?.adjusted || 0) - (da.last?.adjusted || 0);
    if (sort_key === "alpha") return a.localeCompare(b);
    return 0;
  });

  // Owned symbols first
  syms.sort((a, b) => {
    const a_owned = data.symbols[a].position ? 1 : 0;
    const b_owned = data.symbols[b].position ? 1 : 0;
    return b_owned - a_owned;
  });

  return syms;
}

// ── React components ────────────────────────────────────────────────

function StockGraphApp({ data, focus, sorted, flags }) {
  return h("div", {
    style: {
      fontFamily: "monospace", fontSize: "12px", color: C.text,
      background: C.bg, padding: "6px", minWidth: "520px",
    },
  },
    h(PortfolioHeader, { data }),
    h("div", { style: { display: "flex", gap: "6px", marginTop: "4px" } },
      h(WatchlistPanel, { data, sorted, focus, count: flags.count }),
      h(DetailPanel, { data, focus }),
    ),
  );
}

// ── Portfolio header ────────────────────────────────────────────────

function PortfolioHeader({ data }) {
  let positions = 0, total_value = 0, total_unrealized = 0;
  for (const sym of Object.keys(data.symbols)) {
    const pos = data.symbols[sym].position;
    if (pos) {
      positions++;
      total_value += pos.value;
      total_unrealized += pos.unrealized;
    }
  }
  const age = Math.round((Date.now() - data.updatedAt) / 1000);
  const pnl_color = total_unrealized >= 0 ? C.buy : C.sell;

  return h("div", {
    style: {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      borderBottom: `1px solid ${C.grid}`, paddingBottom: "4px", fontSize: "11px",
    },
  },
    h("span", null, `Positions: ${positions}`),
    h("span", null, `Value: $${fmt_money(total_value)}`),
    h("span", { style: { color: pnl_color } },
      `P&L: ${total_unrealized >= 0 ? "+$" : "-$"}${fmt_money(total_unrealized)}`),
    h("span", { style: { color: age > 12 ? C.sell : C.dim } },
      age > 12 ? `STALE ${age}s` : `${age}s ago`),
  );
}

// ── Watchlist (left pane) ───────────────────────────────────────────

function WatchlistPanel({ data, sorted, focus, count }) {
  const rows = sorted.slice(0, count);
  return h("div", {
    style: {
      width: "180px", flexShrink: 0, overflowY: "auto",
      maxHeight: "420px", borderRight: `1px solid ${C.grid}`, paddingRight: "4px",
    },
  },
    ...rows.map(sym =>
      h(WatchlistRow, { key: sym, sym, symData: data.symbols[sym], isFocused: sym === focus })
    ),
  );
}

function WatchlistRow({ sym, symData, isFocused }) {
  const last = symData.last || {};
  const pos = symData.position;
  const adj = last.adjusted || 0;
  const adj_color = adj > STOCKS_BUY_THRESHOLD ? C.buy : adj < STOCKS_SELL_THRESHOLD ? C.sell : C.neutral;
  const bg = isFocused ? C.highlight : "transparent";

  return h("div", {
    style: {
      background: bg, padding: "3px 4px", borderBottom: `1px solid #1a1a2e`,
      borderLeft: isFocused ? `2px solid ${C.price}` : "2px solid transparent",
    },
  },
    h("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: "1px" } },
      h("span", { style: { fontWeight: isFocused ? "bold" : "normal", fontSize: "11px" } }, sym),
      h("span", { style: { color: adj_color, fontSize: "10px" } },
        `${(adj * 100).toFixed(1)}%`),
    ),
    h(Sparkline, { samples: symData.samples, width: 168, height: 18 }),
    pos ? h("div", { style: { fontSize: "9px", color: C.label, marginTop: "1px" } },
      `$${fmt_money(pos.value)} `,
      h("span", { style: { color: pos.unrealized >= 0 ? C.buy : C.sell } },
        `${pos.unrealized >= 0 ? "+$" : "-$"}${fmt_money(pos.unrealized)}`),
    ) : null,
  );
}

// ── Sparkline ───────────────────────────────────────────────────────

function Sparkline({ samples, width, height }) {
  if (!samples || samples.length < 2) {
    return h("div", { style: { height: height + "px" } });
  }

  const pts = downsample(samples, 60);
  const prices = pts.map(s => s[1]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const points = pts.map((s, i) => {
    const x = (i / (pts.length - 1)) * width;
    const y = height - ((s[1] - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const trend_color = prices[prices.length - 1] >= prices[0] ? C.buy : C.sell;

  return h("svg", { width, height, style: { display: "block" } },
    h("polyline", { points, fill: "none", stroke: trend_color, strokeWidth: "1" }),
  );
}

// ── Detail panel (right pane) ───────────────────────────────────────

function DetailPanel({ data, focus }) {
  if (!focus || !data.symbols[focus]) {
    return h("div", { style: { flex: 1, padding: "12px", color: C.label } },
      "No symbol selected");
  }
  const symData = data.symbols[focus];
  return h("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" } },
    h(StockDetailCard, { sym: focus, symData, thresholds: data.thresholds }),
    h(PriceChart, { sym: focus, symData, width: 320, height: 150 }),
    h(SignalChart, { sym: focus, symData, thresholds: data.thresholds, width: 320, height: 85 }),
  );
}

// ── Stock detail card ───────────────────────────────────────────────

function StockDetailCard({ sym, symData, thresholds }) {
  const last = symData.last || {};
  const pos = symData.position;
  const adj = last.adjusted || 0;
  const signal_label = adj > thresholds.buy ? "BUY" : adj < thresholds.sell ? "SELL" : "HOLD";
  const signal_color = adj > thresholds.buy ? C.buy : adj < thresholds.sell ? C.sell : C.neutral;

  const stats = [
    ["Price", `$${fmt_money(last.price)}`],
    ["Forecast", `${((last.forecast || 0) * 100).toFixed(1)}%`],
    ["Volatility", `${((last.volatility || 0) * 100).toFixed(1)}%`],
    ["Adjusted", h("span", { style: { color: signal_color } },
      `${(adj * 100).toFixed(1)}% ${signal_label}`)],
  ];

  if (pos) {
    stats.push(
      ["Shares", fmt_num(pos.shares)],
      ["Avg Price", `$${fmt_money(pos.avgPrice)}`],
      ["Value", `$${fmt_money(pos.value)}`],
      ["Unrealized", h("span", { style: { color: pos.unrealized >= 0 ? C.buy : C.sell } },
        `${pos.unrealized >= 0 ? "+$" : "-$"}${fmt_money(pos.unrealized)}`)],
    );
  }

  return h("div", {
    style: { background: "#16213e", padding: "5px 8px", borderRadius: "3px" },
  },
    h("div", { style: { fontWeight: "bold", fontSize: "14px", marginBottom: "3px", color: C.price } }, sym),
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 12px" } },
      ...stats.flatMap(([label, val]) => [
        h("span", { key: label + "l", style: { color: C.label, fontSize: "10px" } }, label),
        h("span", { key: label + "v", style: { fontSize: "10px", textAlign: "right" } }, val),
      ]),
    ),
  );
}

// ── Price chart ─────────────────────────────────────────────────────

function PriceChart({ sym, symData, width, height }) {
  const samples = symData.samples || [];
  if (samples.length < 2) {
    return h("div", {
      style: { width, height, background: C.chartBg, borderRadius: "3px",
        display: "flex", alignItems: "center", justifyContent: "center", color: C.label, fontSize: "11px" },
    }, "Collecting price data...");
  }

  const PAD = { top: 12, right: 45, bottom: 14, left: 5 };
  const pw = width - PAD.left - PAD.right;
  const ph = height - PAD.top - PAD.bottom;

  const prices = samples.map(s => s[1]);
  const times = samples.map(s => s[0]);
  const pos = symData.position;

  // Y-range includes avg entry price if held
  let y_min = Math.min(...prices);
  let y_max = Math.max(...prices);
  if (pos?.avgPrice) {
    y_min = Math.min(y_min, pos.avgPrice);
    y_max = Math.max(y_max, pos.avgPrice);
  }
  const y_pad = (y_max - y_min || 1) * 0.08;
  y_min -= y_pad;
  y_max += y_pad;
  const y_range = y_max - y_min;

  const sx = (i) => PAD.left + (i / (samples.length - 1)) * pw;
  const sy = (p) => PAD.top + ph - ((p - y_min) / y_range) * ph;

  const children = [];

  // Background
  children.push(h("rect", { key: "bg", x: 0, y: 0, width, height, fill: C.chartBg, rx: "3" }));

  // Grid lines + Y-axis labels (4 ticks)
  for (let i = 0; i <= 3; i++) {
    const p = y_min + (y_range * i) / 3;
    const y = sy(p);
    children.push(h("line", {
      key: `grid-${i}`, x1: PAD.left, y1: y, x2: width - PAD.right, y2: y,
      stroke: C.grid, strokeWidth: "0.5",
    }));
    children.push(h("text", {
      key: `label-${i}`, x: width - 3, y: y + 3,
      textAnchor: "end", fill: C.dim, fontSize: "8",
    }, `$${fmt_compact(p)}`));
  }

  // Time labels on X-axis
  const t_min = times[0];
  const t_max = times[times.length - 1];
  const t_range = t_max - t_min || 1;
  for (let i = 0; i <= 2; i++) {
    const t = t_min + (t_range * i) / 2;
    const x = PAD.left + (i / 2) * pw;
    const mins_ago = Math.round((t_max - t) / 60000);
    children.push(h("text", {
      key: `time-${i}`, x, y: height - 2,
      textAnchor: "middle", fill: C.dim, fontSize: "8",
    }, mins_ago === 0 ? "now" : `-${mins_ago}m`));
  }

  // Price polyline
  const price_pts = samples.map((s, i) =>
    `${sx(i).toFixed(1)},${sy(s[1]).toFixed(1)}`
  ).join(" ");
  children.push(h("polyline", {
    key: "price", points: price_pts,
    fill: "none", stroke: C.price, strokeWidth: "1.5",
  }));

  // Avg entry price dashed line
  if (pos?.avgPrice) {
    const y = sy(pos.avgPrice);
    children.push(h("line", {
      key: "avg", x1: PAD.left, y1: y, x2: width - PAD.right, y2: y,
      stroke: C.neutral, strokeWidth: "1", strokeDasharray: "4,3",
    }));
    children.push(h("text", {
      key: "avg-lbl", x: PAD.left + 2, y: y - 3,
      fill: C.neutral, fontSize: "8",
    }, `avg $${fmt_compact(pos.avgPrice)}`));
  }

  // Buy/sell event markers
  const events = symData.events || [];
  for (let ei = 0; ei < events.length; ei++) {
    const [ts, type, , exec_price] = events[ei];
    if (ts < t_min || ts > t_max || !exec_price) continue;
    const ex = PAD.left + ((ts - t_min) / t_range) * pw;
    const ey = sy(exec_price);
    if (type === "buy") {
      children.push(h("polygon", {
        key: `evt-${ei}`,
        points: `${ex},${ey - 6} ${ex - 4},${ey + 2} ${ex + 4},${ey + 2}`,
        fill: C.buy, opacity: "0.9",
      }));
    } else {
      children.push(h("polygon", {
        key: `evt-${ei}`,
        points: `${ex},${ey + 6} ${ex - 4},${ey - 2} ${ex + 4},${ey - 2}`,
        fill: C.sell, opacity: "0.9",
      }));
    }
  }

  // Current price dot
  const last_y = sy(prices[prices.length - 1]);
  const last_x = sx(samples.length - 1);
  children.push(h("circle", {
    key: "dot", cx: last_x, cy: last_y, r: "3",
    fill: C.price, stroke: C.bg, strokeWidth: "1",
  }));

  // Title
  children.push(h("text", {
    key: "title", x: PAD.left + 2, y: 10,
    fill: C.label, fontSize: "9",
  }, `${sym} Price`));

  return h("svg", { width, height, style: { display: "block" } }, ...children);
}

// ── Signal chart ────────────────────────────────────────────────────

function SignalChart({ sym, symData, thresholds, width, height }) {
  const samples = symData.samples || [];
  if (samples.length < 2) return null;

  const PAD = { top: 10, right: 45, bottom: 12, left: 5 };
  const pw = width - PAD.left - PAD.right;
  const ph = height - PAD.top - PAD.bottom;

  const adjusted = samples.map(s => s[4]);
  const all_vals = [...adjusted, thresholds.buy, thresholds.sell, 0.5];
  let y_min = Math.min(...all_vals) - 0.03;
  let y_max = Math.max(...all_vals) + 0.03;
  const y_range = y_max - y_min || 0.1;

  const sx = (i) => PAD.left + (i / (samples.length - 1)) * pw;
  const sy = (v) => PAD.top + ph - ((v - y_min) / y_range) * ph;

  const children = [];

  // Background
  children.push(h("rect", { key: "bg", x: 0, y: 0, width, height, fill: C.chartBg, rx: "3" }));

  // Buy threshold
  const buy_y = sy(thresholds.buy);
  children.push(h("line", {
    key: "buy-th", x1: PAD.left, y1: buy_y, x2: width - PAD.right, y2: buy_y,
    stroke: C.buy, strokeWidth: "0.8", strokeDasharray: "3,3",
  }));
  children.push(h("text", {
    key: "buy-lbl", x: width - 3, y: buy_y + 3,
    textAnchor: "end", fill: C.buy, fontSize: "8",
  }, `buy ${(thresholds.buy * 100).toFixed(0)}%`));

  // Sell threshold
  const sell_y = sy(thresholds.sell);
  children.push(h("line", {
    key: "sell-th", x1: PAD.left, y1: sell_y, x2: width - PAD.right, y2: sell_y,
    stroke: C.sell, strokeWidth: "0.8", strokeDasharray: "3,3",
  }));
  children.push(h("text", {
    key: "sell-lbl", x: width - 3, y: sell_y + 3,
    textAnchor: "end", fill: C.sell, fontSize: "8",
  }, `sell ${(thresholds.sell * 100).toFixed(0)}%`));

  // 0.5 neutral baseline
  const neutral_y = sy(0.5);
  children.push(h("line", {
    key: "neutral", x1: PAD.left, y1: neutral_y, x2: width - PAD.right, y2: neutral_y,
    stroke: C.grid, strokeWidth: "0.5",
  }));

  // Signal polyline with color zones
  const signal_pts = samples.map((s, i) =>
    `${sx(i).toFixed(1)},${sy(s[4]).toFixed(1)}`
  ).join(" ");
  children.push(h("polyline", {
    key: "signal", points: signal_pts,
    fill: "none", stroke: C.signal, strokeWidth: "1.5",
  }));

  // Current signal dot
  const last_adj = adjusted[adjusted.length - 1];
  const dot_color = last_adj > thresholds.buy ? C.buy : last_adj < thresholds.sell ? C.sell : C.neutral;
  children.push(h("circle", {
    key: "dot", cx: sx(samples.length - 1), cy: sy(last_adj), r: "3",
    fill: dot_color, stroke: C.bg, strokeWidth: "1",
  }));

  // Title
  children.push(h("text", {
    key: "title", x: PAD.left + 2, y: 9,
    fill: C.label, fontSize: "9",
  }, "Signal (forecast - volatility)"));

  return h("svg", { width, height, style: { display: "block" } }, ...children);
}

// ── Utilities ───────────────────────────────────────────────────────

function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const result = [];
  for (let i = 0; i < max; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  result[result.length - 1] = arr[arr.length - 1];
  return result;
}

function fmt_money(v) {
  const val = Math.abs(Number(v));
  if (!Number.isFinite(val)) return "0";
  if (val >= 1e12) return `${(val / 1e12).toFixed(2)}t`;
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}b`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}m`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)}k`;
  return val.toFixed(0);
}

function fmt_compact(v) {
  const val = Number(v);
  if (!Number.isFinite(val)) return "0";
  const abs = Math.abs(val);
  if (abs >= 1e9) return `${(val / 1e9).toFixed(1)}b`;
  if (abs >= 1e6) return `${(val / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(0)}k`;
  return val.toFixed(0);
}

function fmt_num(v) {
  const val = Number(v);
  if (!Number.isFinite(val)) return "0";
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}m`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)}k`;
  return val.toFixed(0);
}
