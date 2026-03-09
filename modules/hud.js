/**
 * Bitburner HUD module.
 * Displays daemon module state plus simple effectiveness metrics in the overview panel.
 *
 * @param {NS} ns
 */

const MODULE_STATUS_FILE = "/data/module_status.json";
const MANAGER_STATUS_FILE = "/data/manager_status.json";
const SERVERS_FILE = "/data/servers.txt";
const ROOTED_FILE = "/data/rooted.txt";
const TARGETS_FILE = "/data/targets.txt";
const PREPPED_FILE = "/data/prepped.txt";
const CONTRACTS_FILE = "/data/contracts_status.txt";
const DISABLED_PREFIX = "/data/disabled_";

const MODULE_ROWS = [
  { file: "root.js", label: "Root" },
  { file: "manager.js", label: "Manager" },
  { file: "hud.js", label: "HUD" },
  { file: "buy-servers.js", label: "Servers" },
  { file: "contracts.js", label: "Contracts" },
];

const LITE_ROWS = [
  { file: "root-lite.js", label: "RootLite" },
  { file: "deploy-lite.js", label: "DeployLite" },
];

const argsSchema = [
  ["refresh", 1000],
  ["show-lite", true],
  ["show-disabled", true],
  ["target-rows", 3],
];

/**
 * @typedef {{state?: string, pid?: number, freeRam?: number, neededRam?: number, bootReserve?: number}} RuntimeModuleState
 * @typedef {{rootReady?: boolean, managerReady?: boolean}} BootState
 * @typedef {{timestamp?: string, boot?: BootState, modules?: Record<string, RuntimeModuleState>}} DaemonStatus
 * @typedef {{mode?: string, prepTarget?: string, prepIncomeTarget?: string, prepTargets?: number, hackTargets?: number, launchedBatches?: number, availableRam?: number, hostCount?: number, runnableHostCount?: number}} ManagerStatus
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

    const rows = show_lite ? MODULE_ROWS.concat(LITE_ROWS) : MODULE_ROWS.slice();
    const module_map = module_status.modules || {};
    const enabled_count = rows.filter((row) => is_enabled(ns, row.file, module_map[row.file])).length;
    const boot_ready = Boolean(module_status.boot?.rootReady && module_status.boot?.managerReady);

    const left = [];
    const right = [];
    left.push("Daemon");
    right.push(short_time(module_status.timestamp));
    left.push("Boot");
    right.push(boot_ready ? "complete" : "bootstrap");
    left.push("Modules");
    right.push(`${enabled_count}/${rows.length} enabled`);
    left.push("HWGW Live");
    right.push(
      `jobs ${hwgw_live.jobs} targets ${hwgw_live.targetCount} H${hwgw_live.hackThreads} G${hwgw_live.growThreads} W${hwgw_live.weakThreads}`
    );

    const top_targets = hwgw_live.targets.slice(0, target_rows);
    if (top_targets.length === 0) {
      left.push("Target 1");
      if (String(manager_status.mode || "") === "PREP" && manager_status.prepTarget) {
        right.push(`prep ${short_host(String(manager_status.prepTarget))}`);
        if (manager_status.prepIncomeTarget) {
          left.push("Income");
          right.push(short_host(String(manager_status.prepIncomeTarget)));
        }
      } else {
        right.push("none");
      }
    } else {
      for (let i = 0; i < top_targets.length; i++) {
        const target = top_targets[i];
        left.push(`Target ${i + 1}`);
        right.push(
          `${short_host(target.hostname)} b${target.batches} h${target.hack} g${target.grow} w${target.weak}`
        );
      }
    }

    for (const row of rows) {
      const state = module_map[row.file] || {};
      const enabled = is_enabled(ns, row.file, state);
      if (!enabled && !show_disabled) continue;

      left.push(`${row.label} ${short_state(state.state, enabled)}`);
      right.push(effectiveness_text(row.file, state, manager_status, metrics, refresh_ms, boot_ready));
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
      const ready_ratio = percent(metrics.prepped, metrics.targets);
      return `prep ${to_num(manager.prepTargets)} ready ${ready_ratio}`;
    }
    if (mode === "HACK") {
      const launched = to_num(manager.launchedBatches);
      const targets = Math.max(1, to_num(manager.hackTargets));
      const batches_per_target = (launched / targets).toFixed(2);
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
      const kind = hwgw_kind(process.filename);
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

function hwgw_kind(filename) {
  if (!filename) return "";
  if (filename.endsWith("/b-hack.js") || filename === "b-hack.js") return "hack";
  if (filename.endsWith("/b-grow.js") || filename === "b-grow.js") return "grow";
  if (filename.endsWith("/b-weak.js") || filename === "b-weak.js") return "weak";
  return "";
}

function short_host(hostname) {
  if (!hostname) return "unknown";
  if (hostname.length <= 16) return hostname;
  return `${hostname.slice(0, 15)}~`;
}
