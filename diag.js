/**
 * Bitburner Diagnostics Script — run manually to dump system state.
 * Usage: run diag.js [--tail]
 *
 * Prints a full snapshot: manager status, prep workers, batch workers,
 * RAM allocation, target analysis, and data file health.
 *
 * @param {NS} ns
 */

import {
  BATCH_WORKER_FILES,
  CONTRACTS_STATUS_FILE,
  MANAGER_STATUS_FILE,
  MODULE_STATUS_FILE,
  PREPPED_FILE,
  PREP_WORKER_FILES,
  ROOTED_FILE,
  SERVER_MAP_FILE,
  STOCKS_STATUS_FILE,
  TARGETS_FILE,
  WORKER_FILES,
  normalize_script_filename,
} from "/modules/runtime-contracts.js";

const CONTRACTS_FILE = CONTRACTS_STATUS_FILE;
const PREP_SCRIPTS = new Set(PREP_WORKER_FILES);
const BATCH_SCRIPTS = new Set(BATCH_WORKER_FILES);

export function autocomplete() {
  return ["--tail", "--json"];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const json_mode = ns.args.includes("--json");

  if (json_mode) {
    const data = build_json_snapshot(ns);
    ns.tprint(JSON.stringify(data, null, 2));
    return;
  }

  const sep = "═".repeat(60);
  const thin = "─".repeat(60);

  ns.tprint(`${sep}`);
  ns.tprint("  BITBURNER DIAGNOSTICS SNAPSHOT");
  ns.tprint(`  ${new Date().toISOString()}`);
  ns.tprint(sep);

  // ── 1. Module Status ──────────────────────────────────────
  ns.tprint("\n▸ MODULE STATUS");
  const mod_status = read_json(ns, MODULE_STATUS_FILE, null);
  if (!mod_status) {
    ns.tprint("  ⚠ No module_status.json found — daemon may not be running");
  } else {
    const boot = mod_status.boot || {};
    ns.tprint(`  Boot: root=${boot.rootReady ? "✓" : "✗"}  manager=${boot.managerReady ? "✓" : "✗"}`);
    ns.tprint(`  Last update: ${mod_status.timestamp || "unknown"}`);
    const modules = mod_status.modules || {};
    for (const [file, state] of Object.entries(modules)) {
      const s = state.state || "unknown";
      let detail = "";
      if (s === "ram-blocked") {
        detail = ` (free=${fmt_ram(state.freeRam)} need=${fmt_ram(state.neededRam)}${state.bootReserve ? ` reserve=${fmt_ram(state.bootReserve)}` : ""})`;
      }
      ns.tprint(`  ${pad(file, 20)} ${pad(s, 12)}${detail}`);
    }
  }

  // ── 2. Manager Status ─────────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ MANAGER STATUS");
  const mgr = read_json(ns, MANAGER_STATUS_FILE, null);
  if (!mgr) {
    ns.tprint("  ⚠ No manager_status.json found — manager may not be running");
  } else {
    ns.tprint(`  Mode: ${mgr.mode || "unknown"}  |  Updated: ${mgr.timestamp || "unknown"}`);
    const prep_mode = mgr.mode === "PREP" || mgr.mode === "HYBRID";
    const batch_mode = mgr.mode === "HACK" || mgr.mode === "HYBRID";
    if (prep_mode) {
      ns.tprint(`  Prep target: ${mgr.prepTarget || "none"}`);
      ns.tprint(`  Income target: ${mgr.prepIncomeTarget || "none"}`);
      ns.tprint(`  Targets: ${mgr.prepTargets || 0} prep / ${mgr.hackTargets || 0} hack / ${mgr.totalTargets || 0} total`);
      if (mgr.prepHostCount) {
        ns.tprint(`  Prep hosts: ${mgr.prepHostCount}`);
      }
      if (mgr.prepDiag) {
        ns.tprint(`  Prep diag: ${mgr.prepDiag.state || "unknown"}  | needsGrow=${mgr.prepDiag.needsGrow ? "yes" : "no"} hybrid=${mgr.prepDiag.hybridMode ? "yes" : "no"}`);
        ns.tprint(`    Hosts: stable=${mgr.prepDiag.unchangedHosts || 0} adjusted=${mgr.prepDiag.adjustedHosts || 0} ram-limited=${mgr.prepDiag.ramLimitedHosts || 0}`);
        ns.tprint(`    Cleanup: stale-hosts=${mgr.prepDiag.staleHostsCleared || 0} stale-workers=${mgr.prepDiag.staleWorkersKilled || 0}`);
        ns.tprint(`    Threads: G${mgr.prepDiag.totalGrowThreads || 0} W${mgr.prepDiag.totalWeakThreads || 0} H${mgr.prepDiag.totalHackThreads || 0}`);
        const prep_hosts = Array.isArray(mgr.prepDiag.hosts) ? mgr.prepDiag.hosts : [];
        for (const host of prep_hosts.slice(0, 5)) {
          ns.tprint(`    Host ${pad(host.hostname, 18)} ${pad(host.action, 11)} exp=${host.expectedScripts || 0} act=${host.actualScripts || 0} ram=${fmt_ram(host.availableRam)} G${host.growThreads || 0} W${host.weakThreads || 0} H${host.hackThreads || 0}`);
        }
      }
    }
    if (batch_mode) {
      ns.tprint(`  Batches launched: ${mgr.launchedBatches || 0}`);
      ns.tprint(`  Targets: ${mgr.hackTargets || 0} hack / ${mgr.prepTargets || 0} prep`);
      ns.tprint(`  Hosts: ${mgr.runnableHostCount || 0}/${mgr.hostCount || 0}  RAM: ${fmt_ram(mgr.availableRam)}`);
      if (mgr.batchDiag) {
        ns.tprint(`  Batch diag: ${mgr.batchDiag.state || "unknown"}  | blocked=${mgr.batchDiag.blockedTargets || 0} failed=${mgr.batchDiag.failedExecs || 0}`);
        const batch_targets = Array.isArray(mgr.batchDiag.targets) ? mgr.batchDiag.targets : [];
        for (const target of batch_targets.slice(0, 5)) {
          ns.tprint(`    Target ${pad(target.target, 18)} launched=${target.launched || 0} reason=${target.reason || "unknown"}`);
        }
      }
    }
  }

  // ── 3. Live Processes ──────────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ LIVE WORKER PROCESSES (home)");
  const home_procs = ns.ps("home");
  const prep_procs = home_procs.filter((p) => PREP_SCRIPTS.has(normalize_script_filename(p.filename)));
  const batch_procs_home = home_procs.filter((p) => BATCH_SCRIPTS.has(normalize_script_filename(p.filename)));

  if (prep_procs.length === 0) {
    ns.tprint("  No prep workers on home");
  } else {
    ns.tprint(`  Prep workers (${prep_procs.length}):`);
    for (const p of prep_procs) {
      ns.tprint(`    PID ${pad(String(p.pid), 6)} ${pad(p.filename, 14)} threads=${p.threads} args=[${p.args.join(",")}]`);
    }
  }

  if (batch_procs_home.length === 0) {
    ns.tprint("  No batch workers on home");
  } else {
    ns.tprint(`  Batch workers on home (${batch_procs_home.length}):`);
    for (const p of batch_procs_home.slice(0, 10)) {
      ns.tprint(`    PID ${pad(String(p.pid), 6)} ${pad(p.filename, 14)} threads=${p.threads} args=[${p.args.join(",")}]`);
    }
    if (batch_procs_home.length > 10) ns.tprint(`    ... and ${batch_procs_home.length - 10} more`);
  }

  // ── 4. Distributed Workers ────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ DISTRIBUTED BATCH WORKERS");
  const rooted = read_lines(ns, ROOTED_FILE);
  let total_batch_jobs = 0;
  const batch_by_host = {};
  const all_hosts = ["home", ...rooted, ...ns.getPurchasedServers()];
  const seen = new Set();
  for (const host of all_hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    if (!ns.serverExists(host) || !ns.hasRootAccess(host)) continue;
    const procs = ns.ps(host);
    const batch_on_host = procs.filter((p) => BATCH_SCRIPTS.has(normalize_script_filename(p.filename)));
    if (batch_on_host.length > 0) {
      total_batch_jobs += batch_on_host.length;
      batch_by_host[host] = batch_on_host.length;
    }
  }

  if (total_batch_jobs === 0) {
    ns.tprint("  No batch workers running anywhere");
  } else {
    ns.tprint(`  Total batch jobs: ${total_batch_jobs} across ${Object.keys(batch_by_host).length} hosts`);
    const sorted_hosts = Object.entries(batch_by_host).sort((a, b) => b[1] - a[1]);
    for (const [host, count] of sorted_hosts.slice(0, 10)) {
      ns.tprint(`    ${pad(host, 22)} ${count} jobs`);
    }
    if (sorted_hosts.length > 10) ns.tprint(`    ... and ${sorted_hosts.length - 10} more hosts`);
  }

  // ── 5. RAM Analysis ───────────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ RAM ANALYSIS");
  const home_max = ns.getServerMaxRam("home");
  const home_used = ns.getServerUsedRam("home");
  ns.tprint(`  Home: ${fmt_ram(home_used)} / ${fmt_ram(home_max)} (${Math.round(home_used / home_max * 100)}% used)`);
  ns.tprint(`  Free: ${fmt_ram(home_max - home_used)}`);

  const pservs = ns.getPurchasedServers();
  let pserv_total = 0;
  let pserv_used = 0;
  for (const ps of pservs) {
    pserv_total += ns.getServerMaxRam(ps);
    pserv_used += ns.getServerUsedRam(ps);
  }
  if (pservs.length > 0) {
    ns.tprint(`  Purchased (${pservs.length}): ${fmt_ram(pserv_used)} / ${fmt_ram(pserv_total)} (${pserv_total > 0 ? Math.round(pserv_used / pserv_total * 100) : 0}%)`);
  }

  // ── 6. Server Map / Target Analysis ───────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ TARGET ANALYSIS");
  const server_map = read_json(ns, SERVER_MAP_FILE, []);
  if (server_map.length === 0) {
    ns.tprint("  ⚠ No server_map.json found");
  } else {
    const prep = server_map.filter((s) => s.state === "PREP" && s.hasAdminRights);
    const hack = server_map.filter((s) => s.state === "HACK" && s.hasAdminRights);
    const locked = server_map.filter((s) => !s.hasAdminRights);
    ns.tprint(`  Hackable: ${hack.length}  |  Prepping: ${prep.length}  |  Locked: ${locked.length}`);

    if (prep.length > 0) {
      ns.tprint("  Top prep targets (by score):");
      for (const t of prep.slice(0, 5)) {
        ns.tprint(`    ${pad(t.hostname, 22)} score=${t.score.toFixed(2)} money=$${fmt_money(t.maxMoney)}`);
      }
    }
    if (hack.length > 0) {
      ns.tprint("  Top hack targets (by score):");
      for (const t of hack.slice(0, 5)) {
        ns.tprint(`    ${pad(t.hostname, 22)} score=${t.score.toFixed(2)} money=$${fmt_money(t.maxMoney)}`);
      }
    }
  }

  // ── 7. Data File Health ───────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ DATA FILES");
  const data_files = [
    MODULE_STATUS_FILE,
    MANAGER_STATUS_FILE,
    SERVER_MAP_FILE,
    ROOTED_FILE,
    TARGETS_FILE,
    PREPPED_FILE,
    CONTRACTS_FILE,
    STOCKS_STATUS_FILE,
  ];
  for (const f of data_files) {
    const exists = ns.fileExists(f, "home");
    const raw = exists ? ns.read(f) : "";
    const size = raw.length;
    ns.tprint(`  ${pad(f, 30)} ${exists ? `${size} bytes` : "MISSING"}`);
  }

  // ── 8. Worker Script Check ────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ WORKER SCRIPTS ON DISK");
  const worker_scripts = WORKER_FILES;
  for (const ws of worker_scripts) {
    const exists = ns.fileExists(ws, "home");
    ns.tprint(`  ${pad(ws, 16)} ${exists ? "✓ present" : "✗ MISSING"}`);
  }

  // ── 9. Batch Efficiency ─────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ BATCH EFFICIENCY");
  const income = ns.getScriptIncome();
  ns.tprint(`  Current income: $${fmt_money(income[0])}/sec`);
  ns.tprint(`  Since aug:      $${fmt_money(income[1])}/sec avg`);
  if (mgr && mgr.batchDiag) {
    const bd = mgr.batchDiag;
    ns.tprint(`  Skipped templates: ${bd.skippedTemplates || 0} (targets with non-finite analysis)`);
    ns.tprint(`  Failed execs: ${bd.failedExecs || 0}`);
  }

  // ── 10. Stocks Status ──────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ STOCKS");
  const stocks_raw = ns.read(STOCKS_STATUS_FILE).trim();
  if (!stocks_raw) {
    ns.tprint("  No stocks status file");
  } else {
    const pipe = stocks_raw.indexOf("|");
    const stocks_state = pipe > 0 ? stocks_raw.substring(0, pipe) : stocks_raw;
    ns.tprint(`  State: ${stocks_state}`);
    if (pipe > 0) {
      try {
        const sd = JSON.parse(stocks_raw.substring(pipe + 1));
        ns.tprint(`  Positions: ${sd.positions || 0}  Value: $${fmt_money(sd.value || 0)}`);
        ns.tprint(`  Realized: $${fmt_money(sd.realizedProfit || 0)}  Unrealized: $${fmt_money(sd.unrealizedProfit || 0)}  Total: $${fmt_money(sd.profit || 0)}`);
      } catch { /* ignore parse errors */ }
    }
  }

  ns.tprint(`${sep}`);
  ns.tprint("  END DIAGNOSTICS");
  ns.tprint(`${sep}`);
}

function build_json_snapshot(ns) {
  return {
    timestamp: new Date().toISOString(),
    moduleStatus: read_json(ns, MODULE_STATUS_FILE, null),
    managerStatus: read_json(ns, MANAGER_STATUS_FILE, null),
    serverMap: read_json(ns, SERVER_MAP_FILE, []),
    income: { perSec: ns.getScriptIncome()[0], sinceAug: ns.getScriptIncome()[1] },
    stocks: parse_stocks_status(ns),
    ram: {
      homeMax: ns.getServerMaxRam("home"),
      homeUsed: ns.getServerUsedRam("home"),
      purchasedServers: ns.getPurchasedServers().map((s) => ({
        hostname: s,
        max: ns.getServerMaxRam(s),
        used: ns.getServerUsedRam(s),
      })),
    },
    dataFiles: [MODULE_STATUS_FILE, MANAGER_STATUS_FILE, SERVER_MAP_FILE,
      ROOTED_FILE, TARGETS_FILE, PREPPED_FILE, CONTRACTS_FILE, STOCKS_STATUS_FILE]
      .map((f) => ({ path: f, exists: ns.fileExists(f, "home"), size: ns.read(f).length })),
    workerScripts: WORKER_FILES.map((w) => ({ path: w, exists: ns.fileExists(w, "home") })),
  };
}

function parse_stocks_status(ns) {
  const raw = ns.read(STOCKS_STATUS_FILE).trim();
  if (!raw) return null;
  const pipe = raw.indexOf("|");
  if (pipe < 0) return { state: raw };
  try {
    return { state: raw.substring(0, pipe), ...JSON.parse(raw.substring(pipe + 1)) };
  } catch {
    return { state: raw.substring(0, pipe) };
  }
}

function read_json(ns, path, fallback) {
  const raw = ns.read(path).trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function read_lines(ns, path) {
  const raw = ns.read(path).trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean);
}

function pad(str, len) {
  return String(str || "").padEnd(len);
}

function fmt_ram(gb) {
  const val = Number(gb);
  if (!Number.isFinite(val)) return "0 GB";
  if (val >= 1024) return `${(val / 1024).toFixed(1)} TB`;
  return `${val.toFixed(1)} GB`;
}

function fmt_money(amount) {
  const val = Number(amount);
  if (!Number.isFinite(val)) return "0";
  if (val >= 1e12) return `${(val / 1e12).toFixed(2)}t`;
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}b`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}m`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(2)}k`;
  return val.toFixed(0);
}
