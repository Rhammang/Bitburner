/**
 * Bitburner HUD module.
 * Displays daemon module state plus simple effectiveness metrics in the overview panel.
 *
 * @param {NS} ns
 */

import {
  CONTRACTS_STATUS_FILE,
  DISABLED_PREFIX,
  FACTIONS_STATUS_FILE,
  MANAGER_STATUS_FILE,
  MetricsRing,
  MODULE_ROWS,
  MODULE_STATUS_FILE,
  LITE_ROWS,
  PREPPED_FILE,
  ROOTED_FILE,
  SERVER_MAP_FILE,
  SERVERS_FILE,
  STOCKS_STATUS_FILE,
  TARGETS_FILE,
  get_worker_kind,
} from "/modules/runtime-contracts.js";

const CONTRACTS_FILE = CONTRACTS_STATUS_FILE;

const argsSchema = [
  ["refresh", 1000],
  ["show-lite", true],
  ["show-disabled", true],
  ["target-rows", 3],
];

// ── Metrics ring buffer (persists across HUD cycles) ────────────────
const metricsHistory = new MetricsRing(120);
let lastMode = "";
let modeSwitchCount = 0;
let modeSwitchWindowStart = 0;
let smoothedIncome = 0;

// ── Money-delta income tracking ─────────────────────────────────────
// ns.getScriptIncome() only counts RUNNING scripts. Fire-and-forget
// batch workers exit after hack(), so their income is never visible.
// Track player money changes instead for a reliable income rate.
let prevMoney = -1;
let prevMoneyTime = 0;
let moneyDeltaIncome = 0; // EMA-smoothed $/sec

/**
 * @typedef {{state?: string, pid?: number, freeRam?: number, neededRam?: number, bootReserve?: number}} RuntimeModuleState
 * @typedef {{rootReady?: boolean, managerReady?: boolean}} BootState
 * @typedef {{timestamp?: string, boot?: BootState, modules?: Record<string, RuntimeModuleState>}} DaemonStatus
 * @typedef {{mode?: string, prepTarget?: string, prepIncomeTarget?: string, prepTargets?: number, hackTargets?: number, launchedBatches?: number, scheduledTargets?: number, availableRam?: number, hostCount?: number, prepHostCount?: number, runnableHostCount?: number, failedExecs?: number, prepDiag?: any, batchDiag?: any, timestamp?: string}} ManagerStatus
 */

export function autocomplete(data, args) {
  data.flags(argsSchema);
  return [];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags(argsSchema);
  const refresh_ms = Math.max(250, Number(flags.refresh) || 1000);
  const show_lite = Boolean(flags["show-lite"]);
  const show_disabled = Boolean(flags["show-disabled"]);
  const target_rows = Math.max(1, Math.min(5, Number(flags["target-rows"]) || 3));

  const doc = eval("document");
  const hook0 = doc?.getElementById("overview-extra-hook-0");
  const hook1 = doc?.getElementById("overview-extra-hook-1");
  if (!hook0 || !hook1) {
    await ns.write(DISABLED_PREFIX + "hud.js", "true", "w");
    ns.tprint("HUD: overview hooks not available. Disabling hud.js for this daemon run.");
    return;
  }

  ns.atExit(() => {
    try {
      hook0.innerText = "";
      hook1.innerText = "";
    } catch {
      // Best effort cleanup.
    }
  });

  while (true) {
    /** @type {DaemonStatus} */
    const module_status = read_json(ns, MODULE_STATUS_FILE, { modules: {}, boot: {} });
    /** @type {ManagerStatus} */
    const manager_status = read_json(ns, MANAGER_STATUS_FILE, {});
    const metrics = read_metrics(ns);
    const hwgw_live = collect_live_hwgw(ns);
    const prep_live = collect_live_prep(ns);
    const ram = collect_ram_summary(ns);

    // ── Push derived metrics into ring buffer ─────────────────
    const dm = manager_status.derivedMetrics || null;
    push_metrics_snapshot(dm, manager_status.mode);
    const trends = compute_trend_metrics();
    const control = compute_control_metrics();

    const rows = show_lite ? MODULE_ROWS.concat(LITE_ROWS) : MODULE_ROWS.slice();
    const module_map = module_status.modules || {};
    const enabled_count = rows.filter((row) => is_enabled(ns, row.file, module_map[row.file])).length;
    const boot_ready = Boolean(module_status.boot?.rootReady && module_status.boot?.managerReady);
    const mode = String(manager_status.mode || "");
    const mgr_age = manager_age_ms(manager_status.timestamp);
    const mgr_stale = mgr_age > 10000;

    const left = [];
    const right = [];

    // ── System header ─────────────────────────────────────────
    left.push("Daemon");
    right.push(short_time(module_status.timestamp));
    left.push("Manager");
    right.push(mgr_stale
      ? `STALE ${Math.floor(mgr_age / 1000)}s!`
      : `ok ${Math.floor(mgr_age / 1000)}s ago`);
    left.push("Boot");
    right.push(boot_ready ? "complete" : "bootstrap");
    left.push("Modules");
    right.push(`${enabled_count}/${rows.length} enabled`);

    // ── Income (money-delta tracking) ─────────────────────────
    const curMoney = ns.getPlayer().money;
    const curTime = Date.now();
    if (prevMoney >= 0 && curTime > prevMoneyTime) {
      const dt = (curTime - prevMoneyTime) / 1000;
      const raw = (curMoney - prevMoney) / dt;
      // EMA smooth (α=0.15) — ignore negative spikes from purchases
      if (raw >= 0) moneyDeltaIncome = moneyDeltaIncome === 0 ? raw : 0.15 * raw + 0.85 * moneyDeltaIncome;
    }
    prevMoney = curMoney;
    prevMoneyTime = curTime;
    left.push("Income");
    right.push(fmt_income(moneyDeltaIncome));
    left.push("RAM");
    right.push(`h:${ram.homeUsed.toFixed(0)}/${ram.homeMax.toFixed(0)}GB t:${fmt_ram(ram.totalUsed)}/${fmt_ram(ram.totalMax)}`);

    // ── Mode-specific ─────────────────────────────────────────
    const prep_mode = (mode === "PREP" || mode === "HYBRID") && manager_status.prepTarget;
    const batch_mode = mode === "HACK" || mode === "HYBRID";

    if (prep_mode) {
      const active = manager_status.activePrepTargets || (manager_status.prepTarget ? [manager_status.prepTarget] : []);
      for (let pi = 0; pi < active.length; pi++) {
        const prep_host = String(active[pi]);
        let money_pct = "?";
        let sec_delta = "?";
        try {
          const srv = ns.getServer(prep_host);
          money_pct = srv.moneyMax > 0 ? Math.round((srv.moneyAvailable / srv.moneyMax) * 100) : 0;
          sec_delta = (srv.hackDifficulty - srv.minDifficulty).toFixed(1);
        } catch { /* server may not exist */ }
        left.push(pi === 0 ? "Prep" : `Prep${pi + 1}`);
        right.push(`${short_host(prep_host)} $${money_pct}% +${sec_delta}sec`);
      }

      const income_src = manager_status.prepIncomeTarget;
      if (income_src && !active.includes(income_src)) {
        left.push("Prep Src");
        right.push(short_host(String(income_src)));
      }

      left.push("Prep Work");
      right.push(prep_live.jobs > 0
        ? `G${prep_live.growThreads} W${prep_live.weakThreads} H${prep_live.hackThreads}`
        : "none running");

      const prep_hosts = to_num(manager_status.prepHostCount);
      if (prep_hosts > 0) {
        left.push("Prep Hosts");
        right.push(String(prep_hosts));
      }

      if (manager_status.prepDiag?.state) {
        left.push("Prep State");
        right.push(`${manager_status.prepDiag.state} adj:${to_num(manager_status.prepDiag.adjustedHosts)}`);
      }
    }

    if (batch_mode) {
      const sched = to_num(manager_status.scheduledTargets);
      const hp = manager_status.hackPercent;
      left.push("Batch Live");
      right.push(`j${hwgw_live.jobs} sc${sched} t${hwgw_live.targetCount} h%${hp ? Math.round(hp * 100) : "?"} H${hwgw_live.hackThreads} G${hwgw_live.growThreads} W${hwgw_live.weakThreads}`);

      const failed = to_num(manager_status.failedExecs);
      if (failed > 0) {
        left.push("Exec Fail");
        right.push(`${failed} last cycle`);
      }

      if (manager_status.batchDiag?.state) {
        left.push("Batch State");
        right.push(`${manager_status.batchDiag.state} blk:${to_num(manager_status.batchDiag.blockedTargets)}`);
      }

      const top_targets = hwgw_live.targets.slice(0, target_rows);
      for (let i = 0; i < top_targets.length; i++) {
        const t = top_targets[i];
        left.push(`Target ${i + 1}`);
        right.push(`${short_host(t.hostname)} b${t.batches} H${t.hack} G${t.grow} W${t.weak}`);
      }
    }

    if (!prep_mode && !batch_mode) {
      left.push("Mode");
      right.push(mode || "waiting");
    }

    // ── Module rows ───────────────────────────────────────────
    for (const row of rows) {
      const state = module_map[row.file] || {};
      const enabled = is_enabled(ns, row.file, state);
      if (!enabled && !show_disabled) continue;

      left.push(`${row.label} ${short_state(state.state, enabled)}`);
      right.push(effectiveness_text(row.file, state, manager_status, metrics, refresh_ms, boot_ready));
    }

    // ── Derived metrics rows ────────────────────────────────
    if (dm) {
      left.push("Efficiency");
      right.push(
        `${fmt_income(dm.incomePerGB)}/GB ext:${Math.round(dm.extractionRatio * 100)}% ${score_letter(dm.systemScore)}`
      );

      left.push("Health");
      const prepETAStr = dm.prepETA === null ? "" : dm.prepETA === -1 ? " prep:stall" : ` prep:${fmt_eta(dm.prepETA)}`;
      right.push(
        `suc:${Math.round(dm.batchSuccessRate * 100)}% ram:${Math.round(dm.ramUtilization * 100)}%${prepETAStr}`
      );

      if (trends) {
        left.push("Trend");
        right.push(
          `inc:${fmt_income(trends.incomeTrend)}${trend_arrow(trends.incomeTrend)} jit:${trends.cycleJitter}ms mode:${trends.modeSwitches === 0 ? "stable" : trends.modeSwitches + "/m"}`
        );
      }
    }

    hook0.innerText = left.join("\n");
    hook1.innerText = right.join("\n");
    await ns.sleep(refresh_ms);
  }
}

/** @param {NS} ns */
function read_metrics(ns) {
  return {
    servers: count_lines(ns, SERVERS_FILE),
    rooted: count_lines(ns, ROOTED_FILE),
    targets: count_lines(ns, TARGETS_FILE),
    prepped: count_lines(ns, PREPPED_FILE),
    contracts: count_lines(ns, CONTRACTS_FILE),
    stocks: read_stocks_status(ns),
    factions: read_json(ns, FACTIONS_STATUS_FILE, null),
    purchased: ns.getPurchasedServers().length,
    purchasedLimit: ns.getPurchasedServerLimit(),
  };
}

/**
 * @param {NS} ns
 * @param {string} file
 * @param {RuntimeModuleState | undefined} state
 */
function is_enabled(ns, file, state) {
  if (state?.state === "disabled") return false;
  return ns.read(DISABLED_PREFIX + file).trim() !== "true";
}

/**
 * @param {string} file
 * @param {RuntimeModuleState} state
 * @param {ManagerStatus} manager
 * @param {{servers:number, rooted:number, targets:number, prepped:number, contracts:number, purchased:number, purchasedLimit:number}} metrics
 * @param {number} refresh_ms
 * @param {boolean} boot_ready
 */
function effectiveness_text(file, state, manager, metrics, refresh_ms, boot_ready) {
  if (state.state === "missing") return "missing";
  if (state.state === "disabled") return "disabled";
  if (state.state === "ram-blocked") {
    const free = to_num(state.freeRam);
    const need = to_num(state.neededRam);
    if (need > 0) return `ram ${free.toFixed(1)}/${need.toFixed(1)}`;
  }
  if (state.state === "exec-failed") return "exec failed";

  if (file === "root.js") {
    return `root ${metrics.rooted}/${metrics.servers} prep ${metrics.prepped}/${metrics.targets}`;
  }

  if (file === "manager.js") {
    const mode = String(manager.mode || "INIT");
    if (mode === "PREP") {
      const prep_state = String(manager.prepDiag?.state || "prep");
      return `${prep_state} h${to_num(manager.prepHostCount)}`;
    }
    if (mode === "HACK" || mode === "HYBRID") {
      const launched = to_num(manager.launchedBatches);
      const blocked = to_num(manager.batchDiag?.blockedTargets);
      const targets = Math.max(1, to_num(manager.hackTargets));
      const batches_per_target = (launched / targets).toFixed(2);
      if (mode === "HYBRID") {
        return `hyb ${launched} blk ${blocked}`;
      }
      return `hack ${launched} bpt ${batches_per_target}`;
    }
    return "waiting";
  }

  if (file === "buy-servers.js") {
    return `pserv ${metrics.purchased}/${metrics.purchasedLimit}`;
  }

  if (file === "contracts.js") {
    return `${metrics.contracts} found`;
  }

  if (file === "stocks.js") {
    const ss = metrics.stocks;
    if (!ss.state) return "idle";
    if (ss.state === "waiting-tix" || ss.state === "waiting-4s") return ss.state;
    if (ss.state === "active") {
      const p = ss.profit || 0;
      const sign = p >= 0 ? "+" : "";
      const abs = Math.abs(p);
      const fmt = abs >= 1e9 ? `${(abs / 1e9).toFixed(1)}b`
        : abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}m`
        : abs >= 1e3 ? `${(abs / 1e3).toFixed(0)}k`
        : abs.toFixed(0);
      return `${ss.positions}pos ${sign}$${fmt}`;
    }
    return ss.state;
  }

  if (file === "factions.js") {
    const fs = metrics.factions;
    if (!fs) return "idle";
    const parts = [];
    if (fs.affordableCount > 0) parts.push(`${fs.affordableCount} buy`);
    if (fs.needRepCount > 0) parts.push(`${fs.needRepCount} need`);
    if (fs.pendingInstall > 0) parts.push(`${fs.pendingInstall} pend`);
    if (fs.activity?.type === "company" && fs.activity.target) parts.push(`corp:${short_host(fs.activity.target)}`);
    else if (fs.activity?.type === "training") parts.push("train");
    else if (fs.workTarget) parts.push(`work:${short_host(fs.workTarget.faction)}`);
    if (fs.backdoor?.nextEligible?.server) parts.push(`bd:${short_host(fs.backdoor.nextEligible.server)}`);
    else if (fs.backdoor?.remaining > 0) parts.push(`bd:${fs.backdoor.remaining}`);
    if (Array.isArray(fs.missingPrograms) && fs.missingPrograms.length > 0) parts.push(`prog:${fs.missingPrograms.length}`);
    return parts.length > 0 ? parts.join(" ") : `${fs.factionCount || 0} fac`;
  }

  if (file === "hud.js") {
    return `${refresh_ms}ms refresh`;
  }

  if (file === "root-lite.js" || file === "deploy-lite.js") {
    return boot_ready ? "standby" : "bootstrap";
  }

  return "ok";
}

function short_state(state, enabled) {
  if (!enabled) return "[off]";
  if (!state) return "[init]";
  if (state === "running" || state === "ok") return "[on]";
  if (state === "ram-blocked") return "[ram]";
  if (state === "exec-failed") return "[fail]";
  if (state === "missing") return "[miss]";
  if (state === "disabled") return "[off]";
  if (state === "standby") return "[off]";
  return `[${state}]`;
}

function percent(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return "n/a";
  const pct = (to_num(numerator) / denominator) * 100;
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

function to_num(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * @template T
 * @param {NS} ns
 * @param {string} path
 * @param {T} fallback
 * @returns {T}
 */
function read_json(ns, path, fallback) {
  const raw = ns.read(path).trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** @param {NS} ns */
function count_lines(ns, path) {
  const raw = ns.read(path).trim();
  if (!raw) return 0;
  return raw.split(/\r?\n/).filter(Boolean).length;
}

function read_stocks_status(ns) {
  const raw = ns.read(STOCKS_STATUS_FILE).trim();
  if (!raw) return {};
  const pipe = raw.indexOf("|");
  if (pipe < 0) return { state: raw };
  const state = raw.substring(0, pipe);
  try {
    return { state, ...JSON.parse(raw.substring(pipe + 1)) };
  } catch {
    return { state };
  }
}

function short_time(iso) {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

/** @param {NS} ns */
function collect_live_hwgw(ns) {
  const hosts = read_hosts_for_hwgw(ns);
  const targets = new Map();

  let jobs = 0;
  let hack_threads = 0;
  let grow_threads = 0;
  let weak_threads = 0;

  for (const host of hosts) {
    if (!ns.serverExists(host) || !ns.hasRootAccess(host)) continue;
    for (const process of ns.ps(host)) {
      const kind = get_worker_kind(process.filename);
      if (!kind) continue;

      jobs += 1;
      const threads = to_num(process.threads);
      if (kind === "hack") hack_threads += threads;
      if (kind === "grow") grow_threads += threads;
      if (kind === "weak") weak_threads += threads;

      const hostname = process.args.length > 0 ? String(process.args[0]) : "unknown";
      if (!targets.has(hostname)) {
        targets.set(hostname, {
          hostname,
          hack: 0,
          grow: 0,
          weak: 0,
          batches: new Set(),
        });
      }

      const target = targets.get(hostname);
      if (kind === "hack") target.hack += threads;
      if (kind === "grow") target.grow += threads;
      if (kind === "weak") target.weak += threads;

      if (process.args.length > 2) {
        target.batches.add(String(process.args[2]));
      }
    }
  }

  const target_rows = Array.from(targets.values())
    .map((target) => ({
      hostname: target.hostname,
      hack: target.hack,
      grow: target.grow,
      weak: target.weak,
      batches: target.batches.size,
      totalThreads: target.hack + target.grow + target.weak,
    }))
    .sort((a, b) => b.totalThreads - a.totalThreads);

  return {
    jobs,
    hackThreads: hack_threads,
    growThreads: grow_threads,
    weakThreads: weak_threads,
    targetCount: target_rows.length,
    targets: target_rows,
  };
}

/** @param {NS} ns */
function read_hosts_for_hwgw(ns) {
  const hosts = new Set(["home"]);
  const rooted = ns
    .read(ROOTED_FILE)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const host of rooted) hosts.add(host);
  return [...hosts];
}

function short_host(hostname) {
  if (!hostname) return "unknown";
  if (hostname.length <= 16) return hostname;
  return `${hostname.slice(0, 15)}~`;
}

function manager_age_ms(timestamp) {
  if (!timestamp) return Infinity;
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return Infinity;
  return Math.max(0, Date.now() - d.getTime());
}

/** @param {NS} ns */
function collect_ram_summary(ns) {
  const homeMax = ns.getServerMaxRam("home");
  const homeUsed = ns.getServerUsedRam("home");
  let totalMax = homeMax;
  let totalUsed = homeUsed;

  for (const host of ns.getPurchasedServers()) {
    totalMax += ns.getServerMaxRam(host);
    totalUsed += ns.getServerUsedRam(host);
  }

  const rooted = ns.read(ROOTED_FILE).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const host of rooted) {
    if (!ns.serverExists(host) || !ns.hasRootAccess(host)) continue;
    totalMax += ns.getServerMaxRam(host);
    totalUsed += ns.getServerUsedRam(host);
  }

  return { homeMax, homeUsed, totalMax, totalUsed };
}

/** @param {NS} ns */
function collect_live_prep(ns) {
  let jobs = 0;
  let hack_threads = 0;
  let grow_threads = 0;
  let weak_threads = 0;
  let target = "";

  for (const process of ns.ps("home")) {
    const kind = get_worker_kind(process.filename);
    if (!kind) continue;
    jobs += 1;
    const threads = to_num(process.threads);
    if (kind === "hack") hack_threads += threads;
    if (kind === "grow") grow_threads += threads;
    if (kind === "weak") weak_threads += threads;
    if (!target && process.args.length > 0) target = String(process.args[0]);
  }

  return { jobs, hackThreads: hack_threads, growThreads: grow_threads, weakThreads: weak_threads, target };
}
function fmt_income(per_sec) {
  const val = Number(per_sec);
  if (!Number.isFinite(val) || val <= 0) return "$0/s";
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}t/s`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}b/s`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}m/s`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}k/s`;
  return `$${val.toFixed(0)}/s`;
}

function fmt_eta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "stall";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

function fmt_ram(gb) {
  const val = Number(gb);
  if (!Number.isFinite(val)) return "0GB";
  if (val >= 1024) return `${(val / 1024).toFixed(1)}TB`;
  return `${val.toFixed(0)}GB`;
}

// ── Trend & control-theory metrics ──────────────────────────────────

function push_metrics_snapshot(dm, mode) {
  if (!dm) return;
  const now = Date.now();

  // Track mode switches
  if (mode && mode !== lastMode && lastMode) {
    modeSwitchCount++;
    if (!modeSwitchWindowStart) modeSwitchWindowStart = now;
  }
  lastMode = mode || lastMode;
  if (now - modeSwitchWindowStart > 60000) {
    modeSwitchCount = 0;
    modeSwitchWindowStart = now;
  }

  // EMA smoothed income
  const alpha = 0.1;
  const income = to_num(dm.income);
  smoothedIncome = smoothedIncome === 0 ? income : alpha * income + (1 - alpha) * smoothedIncome;

  metricsHistory.push({ ...dm, timestamp: now, smoothedIncome, mode });
}

function compute_trend_metrics() {
  if (metricsHistory.length < 2) return null;
  const cur = metricsHistory.latest();
  const prev10 = metricsHistory.ago(10);
  const prev = metricsHistory.ago(1);
  if (!cur || !prev10) return null;

  const incomeTrend = cur.smoothedIncome - (prev10?.smoothedIncome || cur.smoothedIncome);
  const batchFailDelta = to_num(cur.execFailureRatio) - to_num(prev?.execFailureRatio);

  // Prep velocity (for primary prep target)
  let prepMoneyVel = 0;
  let prepSecVel = 0;
  if (cur.perTarget && prev?.perTarget) {
    for (const hn of Object.keys(cur.perTarget)) {
      const ct = cur.perTarget[hn];
      const pt = prev.perTarget[hn];
      if (pt && ct.moneyRatio < 0.99) {
        prepMoneyVel = ct.moneyRatio - pt.moneyRatio;
        prepSecVel = ct.securityDrift - pt.securityDrift;
        break;
      }
    }
  }

  // Cycle jitter
  const window = metricsHistory.window(20);
  let jitter = 0;
  if (window.length > 2) {
    const deltas = [];
    for (let i = 1; i < window.length; i++) {
      deltas.push(window[i].timestamp - window[i - 1].timestamp);
    }
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / deltas.length;
    jitter = Math.sqrt(variance);
  }

  return {
    incomeTrend,
    batchFailDelta,
    prepMoneyVel,
    prepSecVel,
    modeSwitches: modeSwitchCount,
    cycleJitter: Math.round(jitter),
  };
}

function compute_control_metrics() {
  if (metricsHistory.length < 30) return null;
  const result = {};

  // Damping estimate per target
  const cur = metricsHistory.latest();
  if (cur?.perTarget) {
    result.damping = {};
    for (const hn of Object.keys(cur.perTarget)) {
      result.damping[hn] = estimate_damping(hn);
    }
  }

  // Income spectrum
  result.spectrum = income_spectrum(64);

  // Transfer gain estimate (Δincome / Δthreads over recent window)
  const w = metricsHistory.window(20);
  if (w.length >= 10) {
    const first = w[0];
    const last = w[w.length - 1];
    const dIncome = to_num(last.income) - to_num(first.income);
    const dThreads = to_num(last.totalThreads) - to_num(first.totalThreads);
    result.transferGain = dThreads !== 0 ? dIncome / dThreads : null;
  }

  // Settling time: cycles since last mode change where securityDrift < 0.05 for all hack targets
  const window = metricsHistory.window(60);
  let lastModeChange = -1;
  for (let i = 1; i < window.length; i++) {
    if (window[i].mode !== window[i - 1].mode) lastModeChange = i;
  }
  if (lastModeChange >= 0 && window.length > lastModeChange) {
    let settled = 0;
    for (let i = lastModeChange; i < window.length; i++) {
      const pt = window[i].perTarget || {};
      const allSettled = Object.values(pt).every(
        (t) => t.securityDrift < 0.05 && t.moneyRatio > 0.95
      );
      if (allSettled) { settled = i - lastModeChange; break; }
    }
    result.settlingCycles = settled > 0 ? settled : null;
  }

  return result;
}

function estimate_damping(target) {
  const drifts = metricsHistory.window(30).map(
    (s) => s.perTarget?.[target]?.securityDrift ?? 0
  );
  const peaks = [];
  for (let i = 1; i < drifts.length - 1; i++) {
    if (drifts[i] > drifts[i - 1] && drifts[i] > drifts[i + 1] && drifts[i] > 0.01) {
      peaks.push(drifts[i]);
    }
  }
  if (peaks.length < 2) return { label: "stable", ratio: 1.0 };
  const decrement = Math.log(peaks[0] / peaks[1]);
  const zeta = decrement / Math.sqrt(4 * Math.PI * Math.PI + decrement * decrement);
  if (zeta > 0.9) return { label: "overdamped", ratio: Math.round(zeta * 100) / 100 };
  if (zeta > 0.6) return { label: "critical", ratio: Math.round(zeta * 100) / 100 };
  return { label: "underdamped", ratio: Math.round(zeta * 100) / 100 };
}

function income_spectrum(sample_count) {
  const samples = metricsHistory.window(sample_count).map((s) => to_num(s.incomePerGB));
  if (samples.length < sample_count) return null;
  const N = samples.length;
  let peakFreq = 0, peakMag = 0, totalMag = 0;
  for (let k = 1; k <= N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += samples[n] * Math.cos(angle);
      im -= samples[n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im) / N;
    totalMag += mag;
    if (mag > peakMag) { peakMag = mag; peakFreq = k; }
  }
  const spread = totalMag > 0 ? 1 - (peakMag / totalMag) : 0;
  return { peakFreq, peakMag: Math.round(peakMag * 100) / 100, spread: Math.round(spread * 100) / 100 };
}

function trend_arrow(value) {
  if (value > 0.001) return "\u2191";  // ↑
  if (value < -0.001) return "\u2193"; // ↓
  return "\u2194";                     // ↔
}

function score_letter(score) {
  if (score >= 0.9) return "A";
  if (score >= 0.75) return "B";
  if (score >= 0.6) return "C";
  if (score >= 0.4) return "D";
  return "F";
}
