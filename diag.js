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
  FACTIONS_STATUS_FILE,
  MANAGER_STATUS_FILE,
  METRICS_THRESHOLDS,
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
  return ["--tail", "--json", "--control"];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const json_mode = ns.args.includes("--json");
  const worker_conflicts = collect_worker_target_conflicts(ns);

  if (json_mode) {
    const data = build_json_snapshot(ns, worker_conflicts);
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
      const active = mgr.activePrepTargets || (mgr.prepTarget ? [mgr.prepTarget] : []);
      ns.tprint(`  Prep target${active.length > 1 ? "s" : ""}: ${active.join(", ") || "none"}`);
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
      ns.tprint(`  Batches launched: ${mgr.launchedBatches || 0}  |  hackPercent: ${mgr.hackPercent ? Math.round(mgr.hackPercent * 100) + "%" : "??"}`);
      ns.tprint(`  Targets: ${mgr.hackTargets || 0} hack / ${mgr.prepTargets || 0} prep`);
      ns.tprint(`  Hosts: ${mgr.runnableHostCount || 0}/${mgr.hostCount || 0}  RAM: ${fmt_ram(mgr.availableRam)}`);
      const active_batch_targets = Array.isArray(mgr.activeBatchTargets) ? mgr.activeBatchTargets : [];
      if (active_batch_targets.length > 0) {
        const shown = active_batch_targets.slice(0, 5);
        ns.tprint(`  Active batch targets: ${shown.join(", ")}${active_batch_targets.length > shown.length ? ` ... +${active_batch_targets.length - shown.length}` : ""}`);
      }
      if (mgr.batchDiag) {
        ns.tprint(`  Batch diag: ${mgr.batchDiag.state || "unknown"}  | blocked=${mgr.batchDiag.blockedTargets || 0} failed=${mgr.batchDiag.failedExecs || 0} active=${mgr.batchDiag.activeBatchTargets || 0}`);
        const batch_targets = Array.isArray(mgr.batchDiag.targets) ? mgr.batchDiag.targets : [];
        for (const target of batch_targets.slice(0, 5)) {
          ns.tprint(
            `    Target ${pad(target.target, 18)} launched=${target.launched || 0} active=${target.activeBatches || 0} reason=${target.reason || "unknown"}`
            + ` minDelay=${fmt_ms(target.minDelayMs)} ram=${fmt_ram(target.templateRam || 0)} clamps=${target.clampedJobs || 0}`
          );
        }
      }
      if (worker_conflicts.overlapTargets.length > 0) {
        ns.tprint(`  Prep/Batch overlap: ${worker_conflicts.overlapTargets.join(", ")}`);
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
    FACTIONS_STATUS_FILE,
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
  const scriptIncome = ns.getScriptIncome();
  const mgrIncome = mgr?.derivedMetrics?.income || 0;
  ns.tprint(`  Income (money-Δ): $${fmt_money(mgrIncome)}/sec`);
  ns.tprint(`  Income (script):  $${fmt_money(scriptIncome[0])}/sec  (only counts running scripts)`);
  if (mgr && mgr.batchDiag) {
    const bd = mgr.batchDiag;
    ns.tprint(`  Skipped templates: ${bd.skippedTemplates || 0} (targets with non-finite analysis)`);
    ns.tprint(`  Failed execs: ${bd.failedExecs || 0}`);
  }

  // ── 10. Derived Metrics ─────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ DERIVED METRICS");
  const dm = mgr?.derivedMetrics;
  if (!dm) {
    ns.tprint("  No derived metrics available (manager may need restart)");
  } else {
    ns.tprint("  EFFICIENCY");
    ns.tprint(`    Income/GB:          ${fmt_income(dm.incomePerGB)}/GB`);
    ns.tprint(`    Extraction Ratio:   ${pct(dm.extractionRatio)}     ${health_tag(dm.extractionRatio, METRICS_THRESHOLDS.extractionRatio)}  (actual/theoretical income)`);
    ns.tprint(`    Weaken Tax:         ${pct(dm.weakenTax)}           (defensive thread overhead)`);

    ns.tprint("  UTILIZATION");
    ns.tprint(`    RAM:                ${pct(dm.ramUtilization)}     ${health_tag(dm.ramUtilization, METRICS_THRESHOLDS.ramUtilization)}`);
    ns.tprint(`    Host Activation:    ${pct(dm.hostActivation)}`);
    ns.tprint(`    Batch Slots:        ${pct(dm.batchSlotUtilization)}`);
    ns.tprint(`    Target Coverage:    ${pct(dm.targetCoverage)}`);
    ns.tprint(`    Host Fragmentation: ${pct(dm.hostFragmentation)}`);
    ns.tprint(`    Batch RAM Demand:   ${fmt_ram(dm.batchRamDemand || 0)}`);
    ns.tprint(`    Batch RAM Pressure: ${fmt_ratio(dm.batchRamPressure)}`);

    ns.tprint("  HEALTH");
    ns.tprint(`    Batch Success:      ${pct(dm.batchSuccessRate)}     ${health_tag(dm.batchSuccessRate, METRICS_THRESHOLDS.batchSuccessRate)}`);
    ns.tprint(`    Exec Failures:      ${pct(dm.execFailureRatio)}     ${health_tag_inv(dm.execFailureRatio, METRICS_THRESHOLDS.execFailureRatio)}`);
    ns.tprint(`    Prep Stability:     ${pct(dm.prepStability)}     ${health_tag(dm.prepStability, METRICS_THRESHOLDS.prepStability)}`);
    ns.tprint(`    Timing Clamp:       ${pct(dm.timingClampRatio)}`);
    ns.tprint(`    Avg Min Delay:      ${fmt_ms(dm.avgMinDelayMs)}`);
    ns.tprint(`    Avg Base Gap:       ${fmt_ms(dm.avgBaseGapMs)}`);
    ns.tprint(`    Prep/Batch Overlap: ${dm.prepBatchOverlapTargets || 0} target(s)`);
    ns.tprint(`    System Score:       ${score_letter(dm.systemScore)} (${(dm.systemScore * 100).toFixed(0)}%)`);

    ns.tprint("  PER-TARGET HEALTH");
    if (dm.perTarget && Object.keys(dm.perTarget).length > 0) {
      for (const [hn, t] of Object.entries(dm.perTarget)) {
        const drift_tag = t.securityDrift > METRICS_THRESHOLDS.securityDrift.warn ? "[WARN: drift]"
          : t.securityDrift > METRICS_THRESHOLDS.securityDrift.good ? "[drift]" : "[OK]";
        ns.tprint(`    ${pad(hn, 22)} secDrift:${t.securityDrift.toFixed(3)}  money:${pct(t.moneyRatio)}  batches:${t.liveBatches}  ${drift_tag}`);
      }
    } else {
      ns.tprint("    No target data");
    }

    ns.tprint("  PROGRESS");
    if (dm.prepETA !== null) {
      ns.tprint(`    Prep ETA:           ${dm.prepETA === -1 ? "STALLED" : fmt_eta(dm.prepETA)}`);
    }
    ns.tprint(`    Threads:            H${dm.hackThreads} G${dm.growThreads} W${dm.weakThreads} (${dm.totalThreads} total)`);
    ns.tprint(`    RAM:                ${fmt_ram(dm.totalUsedRam)} / ${fmt_ram(dm.totalMaxRam)} used`);
  }

  // ── 11. Control Analysis (--control flag) ───────────────
  const show_control = ns.args.includes("--control");
  if (show_control && dm) {
    ns.tprint(`${thin}`);
    ns.tprint("▸ CONTROL ANALYSIS");
    ns.tprint("  (Note: Control metrics require HUD ring buffer; this is a point-in-time estimate)");

    // Per-target damping estimate from current security data
    if (dm.perTarget) {
      ns.tprint("  STABILITY (per-target security state)");
      for (const [hn, t] of Object.entries(dm.perTarget)) {
        const drift = t.securityDrift;
        let damping_label = "stable";
        if (drift > 0.2) damping_label = "underdamped (high drift)";
        else if (drift > 0.05) damping_label = "settling";
        ns.tprint(`    ${pad(hn, 22)} drift:${drift.toFixed(3)}  state:${damping_label}`);
      }
    }

    // Pipeline pressure estimate
    if (mgr && mgr.batchDiag) {
      const demand = dm.batchRamDemand || 0;
      const pressure = dm.batchRamPressure || 0;
      ns.tprint("  PIPELINE");
      ns.tprint(`    Pressure index:     ${fmt_ratio(pressure)}  (template demand / runnable RAM)`);
      ns.tprint(`    Batch RAM demand:   ${fmt_ram(demand)}`);
      ns.tprint(`    Free RAM now:       ${fmt_ram(mgr.availableRam || 0)}  (post-scheduling)`);
    }

    // Income-RAM elasticity note
    ns.tprint("  TRANSFER CHARACTERISTICS");
    ns.tprint(`    Income/GB:          ${fmt_income(dm.incomePerGB)}/GB  (thread→money conversion proxy)`);
    ns.tprint(`    Threads/$/s:        ${dm.income > 0 ? (dm.totalThreads / dm.income).toFixed(2) : "n/a"}  (lower = more efficient)`);
    ns.tprint("  (Full frequency/damping analysis available in HUD after 2+ min of data)");
  }

  // ── 12. Stocks Status ──────────────────────────────────
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

  // ── 13. Factions Status ──────────────────────────────────
  ns.tprint(`${thin}`);
  ns.tprint("▸ FACTIONS & AUGMENTATIONS");
  const factions = read_json(ns, FACTIONS_STATUS_FILE, null);
  if (!factions) {
    ns.tprint("  No factions status file (module may not be running or no SF4)");
  } else {
    ns.tprint(`  Factions joined: ${factions.factionCount || 0}  |  Updated: ${factions.timestamp || "unknown"}`);
    ns.tprint(`  Augs available: ${factions.totalAugsAvailable || 0}  affordable: ${factions.affordableCount || 0}  need rep: ${factions.needRepCount || 0}`);
    ns.tprint(`  Pending install: ${factions.pendingInstall || 0}`);
    if (factions.joined && factions.joined.length > 0) {
      ns.tprint(`  Recently joined: ${factions.joined.join(", ")}`);
    }
    if (factions.purchased && factions.purchased.length > 0) {
      ns.tprint(`  Recently purchased: ${factions.purchased.join(", ")}`);
    }
    if (factions.workTarget) {
      const wt = factions.workTarget;
      ns.tprint(`  Working for: ${wt.faction}  (aug: ${wt.aug})`);
      ns.tprint(`    Rep: ${fmt_money(wt.repCurrent)} / ${fmt_money(wt.repNeeded)}  (${fmt_money(wt.repRemaining)} remaining)`);
    }
    if (factions.topAffordable && factions.topAffordable.length > 0) {
      ns.tprint("  Top affordable augs:");
      for (const a of factions.topAffordable) {
        ns.tprint(`    ${pad(a.name, 35)} ${pad(a.faction, 20)} $${fmt_money(a.price)}`);
      }
    }
    if (factions.topNeedRep && factions.topNeedRep.length > 0) {
      ns.tprint("  Top augs needing rep:");
      for (const a of factions.topNeedRep) {
        ns.tprint(`    ${pad(a.name, 35)} ${pad(a.faction, 20)} rep:${fmt_money(a.repCurrent)}/${fmt_money(a.repNeeded)}`);
      }
    }
  }

  ns.tprint(`${sep}`);
  ns.tprint("  END DIAGNOSTICS");
  ns.tprint(`${sep}`);
}

function build_json_snapshot(ns, worker_conflicts = collect_worker_target_conflicts(ns)) {
  const mgr = read_json(ns, MANAGER_STATUS_FILE, null);
  return {
    timestamp: new Date().toISOString(),
    moduleStatus: read_json(ns, MODULE_STATUS_FILE, null),
    managerStatus: mgr,
    derivedMetrics: mgr?.derivedMetrics || null,
    serverMap: read_json(ns, SERVER_MAP_FILE, []),
    income: { moneyDelta: mgr?.derivedMetrics?.income || 0, scriptApi: ns.getScriptIncome()[0] },
    stocks: parse_stocks_status(ns),
    factions: read_json(ns, FACTIONS_STATUS_FILE, null),
    workerConflicts: worker_conflicts,
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
      ROOTED_FILE, TARGETS_FILE, PREPPED_FILE, CONTRACTS_FILE, STOCKS_STATUS_FILE, FACTIONS_STATUS_FILE]
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

function collect_worker_target_conflicts(ns) {
  const prep_targets = new Set();
  const batch_targets = new Set();
  const all_hosts = ["home", ...read_lines(ns, ROOTED_FILE), ...ns.getPurchasedServers()];
  const seen = new Set();

  for (const host of all_hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    if (!ns.serverExists(host) || !ns.hasRootAccess(host)) continue;
    for (const proc of ns.ps(host)) {
      const target = proc.args.length > 0 ? String(proc.args[0]) : "";
      if (!target) continue;
      const normalized = normalize_script_filename(proc.filename);
      if (PREP_SCRIPTS.has(normalized)) prep_targets.add(target);
      if (BATCH_SCRIPTS.has(normalized)) batch_targets.add(target);
    }
  }

  const overlapTargets = Array.from(prep_targets)
    .filter((target) => batch_targets.has(target))
    .sort();

  return {
    prepTargets: Array.from(prep_targets).sort(),
    batchTargets: Array.from(batch_targets).sort(),
    overlapTargets,
  };
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

function fmt_income(per_sec) {
  const val = Number(per_sec);
  if (!Number.isFinite(val) || val <= 0) return "$0/s";
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}t/s`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}b/s`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}m/s`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}k/s`;
  return `$${val.toFixed(0)}/s`;
}

function fmt_ms(value) {
  const val = Number(value);
  if (!Number.isFinite(val)) return "n/a";
  if (val >= 1000) return `${(val / 1000).toFixed(2)}s`;
  return `${Math.round(val)}ms`;
}

function fmt_ratio(value) {
  const val = Number(value);
  if (!Number.isFinite(val)) return "n/a";
  return val.toFixed(2);
}

function fmt_eta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "stalled";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function pct(ratio) {
  const val = Number(ratio);
  if (!Number.isFinite(val)) return "n/a";
  return `${Math.round(val * 100)}%`;
}

function health_tag(value, threshold) {
  if (value >= threshold.good) return "[OK]";
  if (value >= threshold.warn) return "[WARN]";
  return "[CRIT]";
}

function health_tag_inv(value, threshold) {
  if (value <= threshold.good) return "[OK]";
  if (value <= threshold.warn) return "[WARN]";
  return "[CRIT]";
}

function score_letter(score) {
  if (score >= 0.9) return "A";
  if (score >= 0.75) return "B";
  if (score >= 0.6) return "C";
  if (score >= 0.4) return "D";
  return "F";
}
