/**
 * Bitburner Diagnostics Script — run manually to dump system state.
 * Usage: run diag.js [--tail]
 *
 * Prints a full snapshot: manager status, prep workers, batch workers,
 * RAM allocation, target analysis, and data file health.
 *
 * @param {NS} ns
 */

const MODULE_STATUS_FILE = "/data/module_status.json";
const MANAGER_STATUS_FILE = "/data/manager_status.json";
const SERVER_MAP_FILE = "/data/server_map.json";
const ROOTED_FILE = "/data/rooted.txt";
const TARGETS_FILE = "/data/targets.txt";
const PREPPED_FILE = "/data/prepped.txt";

const PREP_SCRIPTS = new Set(["/w-hack.js", "/w-grow.js", "/w-weak.js",
                               "w-hack.js", "w-grow.js", "w-weak.js"]);
const BATCH_SCRIPTS = new Set(["/b-hack.js", "/b-grow.js", "/b-weak.js",
                                "b-hack.js", "b-grow.js", "b-weak.js"]);

export function autocomplete() {
  return ["--tail"];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const sep = "═".repeat(60);
  const thin = "─".repeat(60);

  ns.tprint(`\n${sep}`);
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
  ns.tprint(`\n${thin}`);
  ns.tprint("▸ MANAGER STATUS");
  const mgr = read_json(ns, MANAGER_STATUS_FILE, null);
  if (!mgr) {
    ns.tprint("  ⚠ No manager_status.json found — manager may not be running");
  } else {
    ns.tprint(`  Mode: ${mgr.mode || "unknown"}  |  Updated: ${mgr.timestamp || "unknown"}`);
    if (mgr.mode === "PREP") {
      ns.tprint(`  Prep target: ${mgr.prepTarget || "none"}`);
      ns.tprint(`  Income target: ${mgr.prepIncomeTarget || "none"}`);
      ns.tprint(`  Targets: ${mgr.prepTargets || 0} prep / ${mgr.hackTargets || 0} hack / ${mgr.totalTargets || 0} total`);
      if (mgr.prepDiag) {
        ns.tprint(`  Prep diag state: ${mgr.prepDiag.state || "unknown"}`);
        if (mgr.prepDiag.state === "running") {
          ns.tprint(`    Workers: G${mgr.prepDiag.growThreads} W${mgr.prepDiag.weakThreads} H${mgr.prepDiag.hackThreads}`);
          ns.tprint(`    Target: ${mgr.prepDiag.target}  Income: ${mgr.prepDiag.incomeTarget}`);
        } else if (mgr.prepDiag.state === "retargeting") {
          ns.tprint(`    Stale workers: ${(mgr.prepDiag.staleWorkers || []).join(", ")}`);
        } else if (mgr.prepDiag.state === "ram-blocked") {
          ns.tprint(`    Available RAM: ${fmt_ram(mgr.prepDiag.availableRam)}  Need: ${fmt_ram(mgr.prepDiag.neededRam)}  Reserve: ${fmt_ram(mgr.prepDiag.homeReserve)}`);
        } else if (mgr.prepDiag.state === "launched") {
          ns.tprint(`    Launched: G${mgr.prepDiag.growThreads}(pid:${mgr.prepDiag.growPid}) W${mgr.prepDiag.weakThreads}(pid:${mgr.prepDiag.weakPid}) H${mgr.prepDiag.hackThreads}(pid:${mgr.prepDiag.hackPid})`);
          if (mgr.prepDiag.failed) ns.tprint("    ⚠ SOME EXEC CALLS FAILED (pid=0)");
        }
      }
    } else if (mgr.mode === "HACK") {
      ns.tprint(`  Batches launched: ${mgr.launchedBatches || 0}`);
      ns.tprint(`  Targets: ${mgr.hackTargets || 0} hack / ${mgr.prepTargets || 0} prep`);
      ns.tprint(`  Hosts: ${mgr.runnableHostCount || 0}/${mgr.hostCount || 0}  RAM: ${fmt_ram(mgr.availableRam)}`);
    }
  }

  // ── 3. Live Processes ──────────────────────────────────────
  ns.tprint(`\n${thin}`);
  ns.tprint("▸ LIVE WORKER PROCESSES (home)");
  const home_procs = ns.ps("home");
  const prep_procs = home_procs.filter((p) => PREP_SCRIPTS.has(p.filename));
  const batch_procs_home = home_procs.filter((p) => BATCH_SCRIPTS.has(p.filename));

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
  ns.tprint(`\n${thin}`);
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
    const batch_on_host = procs.filter((p) => BATCH_SCRIPTS.has(p.filename));
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
  ns.tprint(`\n${thin}`);
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
  ns.tprint(`\n${thin}`);
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
  ns.tprint(`\n${thin}`);
  ns.tprint("▸ DATA FILES");
  const data_files = [
    MODULE_STATUS_FILE,
    MANAGER_STATUS_FILE,
    SERVER_MAP_FILE,
    ROOTED_FILE,
    TARGETS_FILE,
    PREPPED_FILE,
  ];
  for (const f of data_files) {
    const exists = ns.fileExists(f, "home");
    const raw = exists ? ns.read(f) : "";
    const size = raw.length;
    ns.tprint(`  ${pad(f, 30)} ${exists ? `${size} bytes` : "MISSING"}`);
  }

  // ── 8. Worker Script Check ────────────────────────────────
  ns.tprint(`\n${thin}`);
  ns.tprint("▸ WORKER SCRIPTS ON DISK");
  const worker_scripts = ["/w-hack.js", "/w-grow.js", "/w-weak.js", "/b-hack.js", "/b-grow.js", "/b-weak.js"];
  for (const ws of worker_scripts) {
    const exists = ns.fileExists(ws, "home");
    ns.tprint(`  ${pad(ws, 16)} ${exists ? "✓ present" : "✗ MISSING"}`);
  }

  ns.tprint(`\n${sep}`);
  ns.tprint("  END DIAGNOSTICS");
  ns.tprint(`${sep}\n`);
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
