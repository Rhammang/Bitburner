import { list_servers, get_hosts } from "/modules/utils.js";
import {
  MANAGER_BATCHES_PER_WINDOW_DEFAULT,
  MANAGER_HACK_PERCENT_DEFAULT,
  MANAGER_HOME_RESERVE_DEFAULT,
  MANAGER_LOOP_SLEEP_MS_DEFAULT,
  MANAGER_MIN_EXEC_RAM,
  MANAGER_MIN_INCOME_RAM,
  MANAGER_PREP_SLEEP_MS_DEFAULT,
  MANAGER_SCHEDULE_AHEAD_MS_DEFAULT,
  MANAGER_SERVER_MAP_WRITE_INTERVAL_MS,
  MANAGER_SPACING_MS_DEFAULT,
  MANAGER_STATUS_FILE,
  MANAGER_STATUS_WRITE_INTERVAL_MS,
  MANAGER_WORKER_SYNC_INTERVAL_MS,
  SERVER_MAP_FILE,
  WORKER_RAM_COSTS,
  WORKER_SOURCES,
  WORKERS,
  build_script_target_counts,
  get_worker_kind,
  is_prep_worker,
  load_config,
  script_target_counts_equal,
} from "/modules/runtime-contracts.js";

const RAM = WORKER_RAM_COSTS;
const MIN_EXEC_RAM = MANAGER_MIN_EXEC_RAM;
const MIN_INCOME_RAM = MANAGER_MIN_INCOME_RAM;
const WORKER_SYNC_INTERVAL_MS = MANAGER_WORKER_SYNC_INTERVAL_MS;
const SERVER_MAP_WRITE_INTERVAL_MS = MANAGER_SERVER_MAP_WRITE_INTERVAL_MS;
const STATUS_WRITE_INTERVAL_MS = MANAGER_STATUS_WRITE_INTERVAL_MS;

const argsSchema = [
  ["home-reserve", MANAGER_HOME_RESERVE_DEFAULT],
  ["spacing", MANAGER_SPACING_MS_DEFAULT],
  ["batches-per-window", MANAGER_BATCHES_PER_WINDOW_DEFAULT],
  ["schedule-ahead-time", MANAGER_SCHEDULE_AHEAD_MS_DEFAULT],
  ["loop-sleep", MANAGER_LOOP_SLEEP_MS_DEFAULT],
  ["prep-sleep", MANAGER_PREP_SLEEP_MS_DEFAULT],
  ["hack-percent", MANAGER_HACK_PERCENT_DEFAULT],
  ["verbose", false],
];

let batch_schedule = {}; // { target: [landing_time_ms, ...] }
let worker_sync_cache = {};
let last_server_map_payload = "";
let last_server_map_write_ms = 0;
let last_status_signature = "";
let last_status_write_ms = 0;
let cycle_failed_execs = 0;
let cached_income_target = ""; // stable income target across cycles (prevents oscillation)
const MAX_DIAG_HOSTS = 8;
const MAX_DIAG_TARGETS = 8;

// Money-delta income tracking — ns.getScriptIncome() only counts running
// scripts, so fire-and-forget batch workers are invisible. Track player
// money changes for a reliable income rate.
let prev_money = -1;
let prev_money_time = 0;
let money_delta_income = 0; // EMA-smoothed $/sec

export function autocomplete(data, args) {
  data.flags(argsSchema);
  return [];
}

/**
 * The main controller script for the hacking operation.
 * Manages state, prepping, and a pipelined, distributed batching system.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const options = get_options(ns);
  ensure_local_worker_scripts(ns);
  ns.tprint(
    `MANAGER v2.1: Starting up. reserve=${options.homeReserve}GB spacing=${options.spacingMs}ms`
  );

  while (true) {
    const cycle_start = Date.now();
    ensure_local_worker_scripts(ns);
    const player = ns.getPlayer();

    // Update money-delta income tracker
    if (prev_money >= 0 && cycle_start > prev_money_time) {
      const dt = (cycle_start - prev_money_time) / 1000;
      const raw = (player.money - prev_money) / dt;
      if (raw >= 0) money_delta_income = money_delta_income === 0 ? raw : 0.15 * raw + 0.85 * money_delta_income;
    }
    prev_money = player.money;
    prev_money_time = cycle_start;

    const server_map = build_server_map(ns, player);
    await write_server_map_if_needed(ns, server_map, cycle_start);

    cleanup_schedule();

    const prep_targets = server_map.filter((s) => s.hasAdminRights && s.state === "PREP");
    const hack_targets = server_map.filter((s) => s.hasAdminRights && s.state === "HACK");
    const prep_target = prep_targets[0];
    const hybrid_mode = Boolean(prep_target && hack_targets.length > 0);
    const prep_hosts = get_prep_hosts(ns, hybrid_mode);
    const prep_income_target =
      prep_target && !hybrid_mode ? pick_prep_income_target(ns, hack_targets) : "";
    const prepDiag = prep_target
      ? await run_prep_workers(ns, prep_target, prep_income_target, options.homeReserve, prep_hosts, hybrid_mode)
      : { state: "idle" };

    if (!prep_target) {
      stop_prep_workers(ns);
    }

    const hosts = get_hosts(ns)
      .map((h) => ({
        hostname: h,
        ram: ns.getServerMaxRam(h) - ns.getServerUsedRam(h),
      }))
      .sort(sort_hosts);
    apply_home_reserve(hosts, options.homeReserve);
    const runnable_hosts = hosts.filter((h) => h.ram >= MIN_EXEC_RAM);
    sync_workers_to_hosts(ns, runnable_hosts, cycle_start);

    cycle_failed_execs = 0;
    let launched_batches = 0;
    const batch_results = [];
    for (const target of hack_targets) {
      const result = launch_batches_for_target(ns, target, runnable_hosts, options);
      launched_batches += result.launched;
      batch_results.push(result);
    }

    const available_ram = runnable_hosts.reduce((acc, h) => acc + h.ram, 0);
    const batchDiag = build_batch_diag(
      hack_targets,
      batch_results,
      launched_batches,
      cycle_failed_execs,
      runnable_hosts,
      hosts,
      available_ram
    );
    const derivedMetrics = compute_derived_metrics(
      ns, hosts, runnable_hosts, hack_targets,
      launched_batches, cycle_failed_execs, batch_results,
      prepDiag, options
    );
    await write_manager_status(ns, {
      mode: prep_target ? (hybrid_mode ? "HYBRID" : "PREP") : "HACK",
      prepTarget: prep_target ? prep_target.hostname : "",
      prepIncomeTarget: prep_income_target,
      totalTargets: server_map.length,
      prepTargets: prep_targets.length,
      hackTargets: hack_targets.length,
      launchedBatches: launched_batches,
      scheduledTargets: Object.keys(batch_schedule).length,
      homeReserve: options.homeReserve,
      prepHostCount: prep_target ? prep_hosts.length : 0,
      hostCount: hosts.length,
      runnableHostCount: runnable_hosts.length,
      availableRam: Math.floor(available_ram),
      failedExecs: cycle_failed_execs,
      prepDiag,
      batchDiag,
      derivedMetrics,
    }, cycle_start);

    if (options.verbose) {
      ns.print(
        `Batches launched: ${launched_batches} | hosts: ${runnable_hosts.length}/${hosts.length} | avail RAM: ${Math.floor(available_ram)}`
      );
    }

    const elapsed = Date.now() - cycle_start;
    const target_sleep = prep_target && !hybrid_mode ? options.prepSleepMs : options.loopSleepMs;
    await ns.sleep(Math.max(50, target_sleep - elapsed));
  }
}

function get_options(ns) {
  const cfg = load_config(ns).manager;
  const flags = ns.flags(argsSchema);
  return {
    homeReserve: Math.max(0, Number(flags["home-reserve"]) || cfg.homeReserve),
    spacingMs: Math.max(50, Number(flags.spacing) || cfg.spacing),
    batchesPerWindow: Math.max(1, Math.floor(Number(flags["batches-per-window"]) || cfg.batchesPerWindow)),
    scheduleAheadMs: Math.max(1000, Number(flags["schedule-ahead-time"]) || cfg.scheduleAheadTime),
    loopSleepMs: Math.max(200, Number(flags["loop-sleep"]) || cfg.loopSleep),
    prepSleepMs: Math.max(200, Number(flags["prep-sleep"]) || cfg.prepSleep),
    hackPercent: clamp(Number(flags["hack-percent"]) || cfg.hackPercent, 0.01, 0.9),
    verbose: Boolean(flags.verbose),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sort_hosts(a, b) {
  if (a.hostname === "home") return -1;
  if (b.hostname === "home") return 1;
  return b.ram - a.ram;
}

function apply_home_reserve(hosts, reserve) {
  const home = hosts.find((h) => h.hostname === "home");
  if (!home) return;
  home.ram = Math.max(0, home.ram - reserve);
}

function build_server_map(ns, player) {
  return list_servers(ns)
    .filter((s) => !s.startsWith("pserv-"))
    .map((s) => ns.getServer(s))
    .filter((so) => so.moneyMax > 0 && so.requiredHackingSkill <= player.skills.hacking)
    .map((so) => ({
      hostname: so.hostname,
      hasAdminRights: so.hasAdminRights,
      maxMoney: so.moneyMax,
      minDifficulty: so.minDifficulty,
      state:
        so.moneyAvailable >= so.moneyMax * 0.99 && so.hackDifficulty <= so.minDifficulty + 0.5
          ? "HACK"
          : "PREP",
      score: so.moneyMax / ns.getWeakenTime(so.hostname),
    }))
    .sort((a, b) => b.score - a.score);
}

function cleanup_schedule() {
  const now = Date.now();
  for (const target of Object.keys(batch_schedule)) {
    batch_schedule[target] = batch_schedule[target].filter((time) => time > now);
    if (batch_schedule[target].length === 0) {
      delete batch_schedule[target];
    }
  }
}

async function run_prep_workers(ns, target, income_target, home_reserve, prep_hosts, hybrid_mode) {
  // Don't fall back to hacking the prep target — it's counterproductive
  const income_host = income_target || "";
  const needs_grow = target_needs_grow(ns, target.hostname);
  // Check security state to determine if grow workers should run.
  // When security is very high, grow is too inefficient — weaken only.
  let sec_drift = 0;
  try {
    const srv = ns.getServer(target.hostname);
    sec_drift = srv.hackDifficulty - srv.minDifficulty;
  } catch { /* use 0 */ }
  const wants_grow = needs_grow && sec_drift <= 5;
  const prep_host_set = new Set(prep_hosts);
  const diag = {
    state: "stable",
    target: target.hostname,
    incomeTarget: income_host,
    hybridMode: Boolean(hybrid_mode),
    needsGrow: needs_grow,
    prepHostCount: prep_hosts.length,
    unchangedHosts: 0,
    adjustedHosts: 0,
    ramLimitedHosts: 0,
    staleHostsCleared: 0,
    staleWorkersKilled: 0,
    totalHackThreads: 0,
    totalGrowThreads: 0,
    totalWeakThreads: 0,
    hosts: [],
  };

  // Sync worker scripts to purchased servers if missing
  const scripts = Object.values(WORKERS);
  for (const hostname of get_hosts(ns)) {
    if (prep_host_set.has(hostname)) continue;
    let cleared = 0;
    for (const proc of ns.ps(hostname)) {
      if (is_prep_script(proc.filename)) {
        ns.kill(proc.pid);
        cleared += 1;
      }
    }
    if (cleared > 0) {
      diag.staleHostsCleared += 1;
      diag.staleWorkersKilled += cleared;
    }
  }

  for (const hostname of prep_hosts) {
    if (hostname === "home") continue;
    if (scripts.some((s) => !ns.fileExists(s, hostname))) {
      try { ns.scp(scripts, hostname, "home"); } catch { /* ignore */ }
    }
  }

  // Check and fix each host's worker state
  for (const hostname of prep_hosts) {
    const procs = ns.ps(hostname);
    const is_home = hostname === "home";
    const host_max_ram = ns.getServerMaxRam(hostname);
    const wants_income = income_host && income_host !== target.hostname && host_max_ram >= MIN_INCOME_RAM;

    // Build expected worker configuration for this host
    const expected = [];
    if (wants_grow) expected.push({ script: WORKERS.PREP_GROW, target: target.hostname });
    expected.push({ script: WORKERS.PREP_WEAK, target: target.hostname });
    if (wants_income) {
      expected.push({ script: WORKERS.PREP_HACK, target: income_host });
      expected.push({ script: WORKERS.PREP_GROW, target: income_host });
      expected.push({ script: WORKERS.PREP_WEAK, target: income_host });
    }

    // Check if current workers match expected state exactly
    const prep_procs = procs.filter((p) => is_prep_script(p.filename));
    const expected_counts = build_script_target_counts(expected);
    const actual_counts = build_script_target_counts(
      prep_procs.map((p) => ({ script: p.filename, target: p.args[0] }))
    );

    if (script_target_counts_equal(expected_counts, actual_counts)) {
      // Check if the grow:weaken thread ratio is appropriate for current security.
      // If security phase has changed, the old ratio may be counterproductive.
      const grow_procs = prep_procs.filter((p) => get_worker_kind(p.filename) === "grow");
      const weak_procs = prep_procs.filter((p) => get_worker_kind(p.filename) === "weak");
      const host_grow = grow_procs.reduce((s, p) => s + (p.threads || 0), 0);
      const host_weak = weak_procs.reduce((s, p) => s + (p.threads || 0), 0);
      const ratio = host_weak > 0 ? host_grow / host_weak : Infinity;
      // In high-sec phases (drift>1) the ratio should be ≤ ~0.5:1 grow:weak.
      // In grow-heavy phase (drift≤1) the ratio is ~12.5:1.
      // If we're in high-sec but the ratio is grow-heavy, force relaunch.
      let sec_drift = 0;
      try {
        const srv = ns.getServer(target.hostname);
        sec_drift = srv.hackDifficulty - srv.minDifficulty;
      } catch { /* use 0 */ }
      const ratio_ok = sec_drift > 5
        ? host_grow === 0  // Should be weaken-only
        : sec_drift > 1
          ? ratio <= 1.0   // Should be weaken-heavy
          : true;          // Grow-heavy is fine

      if (ratio_ok) {
        diag.unchangedHosts += 1;
        capture_prep_host_diag(ns, diag, hostname, "stable", expected.length);
        continue;
      }
      // Security phase changed — fall through to kill and relaunch
    }

    // Workers are wrong — kill all prep scripts and relaunch
    prep_procs.forEach((p) => ns.kill(p.pid));
    if (prep_procs.length > 0) await ns.sleep(50);

    const available_ram = Math.max(
      0,
      ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname) - (is_home ? home_reserve : 0)
    );
    diag.adjustedHosts += 1;

    if (is_home) {
      const launch = launch_home_prep(ns, target.hostname, income_host, available_ram);
      capture_prep_host_diag(ns, diag, hostname, launch.state, expected.length, available_ram);
    } else {
      const launch = launch_remote_prep(ns, hostname, target.hostname, available_ram, income_host);
      capture_prep_host_diag(ns, diag, hostname, launch.state, expected.length, available_ram);
    }
  }

  if (diag.ramLimitedHosts >= prep_hosts.length && prep_hosts.length > 0) {
    diag.state = "ram-limited";
  } else if (diag.adjustedHosts > 0 || diag.staleWorkersKilled > 0) {
    diag.state = "adjusting";
  }

  return diag;
}

function get_prep_hosts(ns, hybrid_mode) {
  const hosts = get_hosts(ns).sort((a, b) => sort_hosts(
    {
      hostname: a,
      ram: ns.getServerMaxRam(a) - ns.getServerUsedRam(a),
    },
    {
      hostname: b,
      ram: ns.getServerMaxRam(b) - ns.getServerUsedRam(b),
    }
  ));

  // In pure PREP mode, use all hosts (nothing to batch on).
  // In HYBRID mode, reserve purchased servers for batch workers.
  if (!hybrid_mode) return hosts;

  const purchased_hosts = new Set(ns.getPurchasedServers());
  const prep_hosts = hosts.filter((hostname) => hostname === "home" || !purchased_hosts.has(hostname));
  return prep_hosts.length > 0 ? prep_hosts : hosts.slice(0, 1);
}

function is_prep_script(filename) {
  return is_prep_worker(filename);
}

function target_needs_grow(ns, hostname) {
  try {
    const srv = ns.getServer(hostname);
    return srv.moneyMax > 0 && srv.moneyAvailable < srv.moneyMax * 0.99;
  } catch {
    return true;
  }
}

function launch_income_workers(ns, hostname, income_host, available_ram) {
  // Sustainable loop hacking: ~1% hack, ~87% grow (sustain money), ~12% weaken (offset security)
  // Hack runs 4x faster than weaken and 3x faster than grow, so a small hack allocation
  // produces disproportionate drain — keep it minimal to prevent depleting the income target.
  const min_income_ram = RAM.PREP_HACK + RAM.PREP_GROW + RAM.PREP_WEAK;
  if (available_ram < min_income_ram) {
    return { launched: false, hackThreads: 0, growThreads: 0, weakThreads: 0 };
  }

  const hack_threads = Math.max(1, Math.floor((available_ram * 0.01) / RAM.PREP_HACK));
  const weak_threads = Math.max(1, Math.floor((available_ram * 0.12) / RAM.PREP_WEAK));
  const remaining_ram = available_ram - hack_threads * RAM.PREP_HACK - weak_threads * RAM.PREP_WEAK;
  const grow_threads = Math.max(1, Math.floor(remaining_ram / RAM.PREP_GROW));

  const total = hack_threads * RAM.PREP_HACK + grow_threads * RAM.PREP_GROW + weak_threads * RAM.PREP_WEAK;
  if (total > available_ram) {
    return { launched: false, hackThreads: 0, growThreads: 0, weakThreads: 0 };
  }

  ns.exec(WORKERS.PREP_HACK, hostname, hack_threads, income_host);
  ns.exec(WORKERS.PREP_GROW, hostname, grow_threads, income_host);
  ns.exec(WORKERS.PREP_WEAK, hostname, weak_threads, income_host);
  return {
    launched: true,
    hackThreads: hack_threads,
    growThreads: grow_threads,
    weakThreads: weak_threads,
  };
}

/**
 * Compute grow/weaken thread counts for prep, aware of current security state.
 *
 * Three phases based on security drift (curSec - minSec):
 *   1. drift > 5  → weaken-only (grow is extremely inefficient at high sec)
 *   2. drift > 1  → weaken-heavy (70% weaken, 30% grow)
 *   3. drift ≤ 1  → grow-heavy with just enough weaken to offset grow's sec
 *
 * Also leaves a 2% RAM buffer to prevent silent exec failures from RAM
 * estimate rounding.
 */
function compute_prep_threads(ns, target_host, prep_ram, needs_grow) {
  const usable = prep_ram * 0.98; // 2% buffer for RAM estimate rounding
  if (usable < RAM.PREP_WEAK) return { grow: 0, weak: 0 };

  let sec_drift = 0;
  try {
    const srv = ns.getServer(target_host);
    sec_drift = srv.hackDifficulty - srv.minDifficulty;
  } catch { /* use 0 */ }

  // Phase 1: Security very high — weaken only (grow is too inefficient)
  if (sec_drift > 5) {
    return { grow: 0, weak: Math.floor(usable / RAM.PREP_WEAK) };
  }

  // Phase 2: Security elevated — weaken-heavy to bring it down while growing
  if (sec_drift > 1) {
    const weak_frac = 0.7;
    const weak_threads = Math.max(1, Math.floor((usable * weak_frac) / RAM.PREP_WEAK));
    const grow_threads = needs_grow
      ? Math.floor((usable * (1 - weak_frac)) / RAM.PREP_GROW)
      : 0;
    return { grow: grow_threads, weak: weak_threads };
  }

  // Phase 3: Security near minimum — grow-heavy (standard prep)
  if (needs_grow) {
    let grow_threads = Math.floor(usable / (RAM.PREP_GROW + RAM.PREP_WEAK / 12));
    let weak_threads = Math.max(1, Math.ceil(grow_threads * 0.004 / 0.05));
    while (
      grow_threads > 0 &&
      grow_threads * RAM.PREP_GROW + weak_threads * RAM.PREP_WEAK > usable
    ) {
      grow_threads -= 1;
      weak_threads = Math.max(1, Math.ceil(grow_threads * 0.004 / 0.05));
    }
    return { grow: grow_threads, weak: weak_threads };
  }

  // Money full — weaken only
  return { grow: 0, weak: Math.floor(usable / RAM.PREP_WEAK) };
}

function launch_prep_workers(ns, hostname, target_host, prep_ram, needs_grow) {
  const { grow, weak } = compute_prep_threads(ns, target_host, prep_ram, needs_grow);
  if (grow > 0 && !ns.exec(WORKERS.PREP_GROW, hostname, grow, target_host)) {
    // Grow exec failed — fall back to weaken-only with full RAM
    const fallback_weak = Math.floor(prep_ram * 0.98 / RAM.PREP_WEAK);
    if (fallback_weak > 0) ns.exec(WORKERS.PREP_WEAK, hostname, fallback_weak, target_host);
    return;
  }
  if (weak > 0 && !ns.exec(WORKERS.PREP_WEAK, hostname, weak, target_host)) {
    // Weaken exec failed (likely RAM) — kill grow, retry with fewer grow threads
    if (grow > 0) {
      for (const p of ns.ps(hostname)) {
        if (get_worker_kind(p.filename) === "grow" && p.args[0] === target_host) ns.kill(p.pid);
      }
    }
    const reduced_grow = Math.max(0, grow - Math.ceil(weak * RAM.PREP_WEAK / RAM.PREP_GROW) - 1);
    const reduced_weak = weak;
    if (reduced_grow > 0) ns.exec(WORKERS.PREP_GROW, hostname, reduced_grow, target_host);
    if (reduced_weak > 0) ns.exec(WORKERS.PREP_WEAK, hostname, reduced_weak, target_host);
  }
}

function launch_home_prep(ns, target_host, income_host, available_ram) {
  if (available_ram < MIN_EXEC_RAM) {
    return { state: "ram-limited" };
  }

  const needs_grow = target_needs_grow(ns, target_host);
  const has_income = income_host && income_host !== target_host;

  // Reserve a portion for sustainable income workers when we have a valid income target
  let income_ram = 0;
  if (has_income) {
    income_ram = Math.floor(available_ram * 0.15);
    launch_income_workers(ns, "home", income_host, income_ram);
  }

  const prep_ram = available_ram - income_ram;
  if (prep_ram < MIN_EXEC_RAM) {
    return { state: "ram-limited" };
  }

  launch_prep_workers(ns, "home", target_host, prep_ram, needs_grow);
  return { state: "launched" };
}

function launch_remote_prep(ns, hostname, target_host, available_ram, income_host) {
  if (available_ram < RAM.PREP_WEAK) {
    return { state: "ram-limited" };
  }

  const needs_grow = target_needs_grow(ns, target_host);
  const has_income = income_host && income_host !== target_host;

  // Reserve a portion for income workers when we have a valid income target
  let income_ram = 0;
  if (has_income) {
    income_ram = Math.floor(available_ram * 0.15);
    launch_income_workers(ns, hostname, income_host, income_ram);
  }

  const prep_ram = available_ram - income_ram;
  if (prep_ram < RAM.PREP_WEAK) {
    return { state: "ram-limited" };
  }

  launch_prep_workers(ns, hostname, target_host, prep_ram, needs_grow);
  return { state: "launched" };
}

function ensure_local_worker_scripts(ns) {
  for (const [script, source] of Object.entries(WORKER_SOURCES)) {
    if (!ns.fileExists(script, "home")) {
      ns.write(script, source, "w");
    }
  }
}

function sync_workers_to_hosts(ns, hosts, now) {
  const scripts = Object.values(WORKERS);
  const active_hosts = new Set(hosts.map((h) => h.hostname));
  for (const hostname of Object.keys(worker_sync_cache)) {
    if (!active_hosts.has(hostname)) {
      delete worker_sync_cache[hostname];
    }
  }

  for (const host of hosts) {
    if (host.hostname === "home") continue;
    const missing_script = scripts.some((script) => !ns.fileExists(script, host.hostname));
    const last_sync = worker_sync_cache[host.hostname] || 0;
    if (!missing_script && now - last_sync < WORKER_SYNC_INTERVAL_MS) {
      continue;
    }
    try {
      if (!ns.scp(scripts, host.hostname, "home")) {
        host.ram = 0;
      } else {
        worker_sync_cache[host.hostname] = now;
      }
    } catch {
      host.ram = 0;
    }
  }
}

function stop_prep_workers(ns) {
  for (const hostname of get_prep_hosts(ns)) {
    for (const proc of ns.ps(hostname)) {
      if (is_prep_script(proc.filename)) {
        ns.kill(proc.pid);
      }
    }
  }
}

function launch_batches_for_target(ns, target, hosts, options) {
  let launched = 0;
  const window_end = Date.now() + options.scheduleAheadMs;
  const template = calculate_batch_template(ns, target, options);
  if (!template) {
    return { target: target.hostname, launched, reason: "no-template" };
  }
  if (!batch_schedule[target.hostname]) batch_schedule[target.hostname] = [];
  let reason = "no-capacity";

  for (let i = 0; i < options.batchesPerWindow; i++) {
    const landing_time = find_next_available_window(target.hostname, options.spacingMs);
    if (landing_time > window_end) {
      reason = "window-full";
      continue;
    }

    const jobs = build_batch_jobs(template, target.hostname, landing_time, options.spacingMs);

    const plan = plan_job_allocations(jobs, hosts);
    if (!plan) {
      reason = "no-capacity";
      break;
    }

    const launched_ok = execute_planned_jobs(ns, jobs, hosts, plan);
    if (!launched_ok) {
      cycle_failed_execs += 1;
      reason = "exec-failed";
      break;
    }

    batch_schedule[target.hostname].push(
      landing_time - options.spacingMs,
      landing_time,
      landing_time + options.spacingMs,
      landing_time + 2 * options.spacingMs
    );
    launched += 1;
    reason = launched >= options.batchesPerWindow ? "launched" : "partial";
  }

  return { target: target.hostname, launched, reason };
}

function find_next_available_window(target, spacing_ms) {
  const now = Date.now();
  const schedule = batch_schedule[target] || [];
  const last_landing_time = Math.max(now, ...schedule.filter((t) => t).concat(now));
  return last_landing_time + spacing_ms * 4;
}

function calculate_batch_template(ns, target, options) {
  const hack_percent = options.hackPercent;
  const money_to_hack = target.maxMoney * hack_percent;

  const raw_hack = ns.hackAnalyzeThreads(target.hostname, money_to_hack);
  const raw_grow = ns.growthAnalyze(target.hostname, 1 / (1 - hack_percent));
  if (!Number.isFinite(raw_hack) || !Number.isFinite(raw_grow) || raw_hack <= 0 || raw_grow <= 0) {
    return null;
  }

  const hack_threads = safe_threads(Math.floor(raw_hack));
  const weak1_threads = safe_threads(Math.ceil(ns.hackAnalyzeSecurity(hack_threads) / 0.05));
  const grow_threads = safe_threads(Math.ceil(raw_grow));
  const weak2_threads = safe_threads(Math.ceil(ns.growthAnalyzeSecurity(grow_threads) / 0.05));

  const weaken_time = ns.getWeakenTime(target.hostname);
  const grow_time = ns.getGrowTime(target.hostname);
  const hack_time = ns.getHackTime(target.hostname);

  if (!Number.isFinite(weaken_time) || !Number.isFinite(grow_time) || !Number.isFinite(hack_time)) {
    return null;
  }

  return {
    hackThreads: hack_threads,
    weak1Threads: weak1_threads,
    growThreads: grow_threads,
    weak2Threads: weak2_threads,
    weakenTime: weaken_time,
    growTime: grow_time,
    hackTime: hack_time,
  };
}

function build_batch_jobs(template, target, landing_time, spacing_ms) {
  const now = Date.now();
  return [
    {
      script: WORKERS.HACK,
      threads: template.hackThreads,
      ram: RAM.HACK,
      delay: Math.max(0, landing_time - spacing_ms - template.hackTime - now),
      target,
    },
    {
      script: WORKERS.WEAK,
      threads: template.weak1Threads,
      ram: RAM.WEAK,
      delay: Math.max(0, landing_time - template.weakenTime - now),
      target,
    },
    {
      script: WORKERS.GROW,
      threads: template.growThreads,
      ram: RAM.GROW,
      delay: Math.max(0, landing_time + spacing_ms - template.growTime - now),
      target,
    },
    {
      script: WORKERS.WEAK,
      threads: template.weak2Threads,
      ram: RAM.WEAK,
      delay: Math.max(0, landing_time + spacing_ms * 2 - template.weakenTime - now),
      target,
    },
  ];
}

function safe_threads(value) {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.max(1, Math.floor(value));
}

function plan_job_allocations(jobs, hosts) {
  const virtual_hosts = hosts.map((h) => ({ hostname: h.hostname, ram: h.ram }));
  const allocations = [];

  for (let job_index = 0; job_index < jobs.length; job_index++) {
    const job = jobs[job_index];
    let threads_remaining = job.threads;

    for (const host of virtual_hosts) {
      if (threads_remaining <= 0) break;
      if (host.ram < job.ram) continue;

      const threads_to_run = Math.min(threads_remaining, Math.floor(host.ram / job.ram));
      if (threads_to_run <= 0) continue;

      allocations.push({
        jobIndex: job_index,
        hostname: host.hostname,
        threads: threads_to_run,
      });
      host.ram -= threads_to_run * job.ram;
      threads_remaining -= threads_to_run;
    }

    if (threads_remaining > 0) {
      return null;
    }
  }

  return allocations;
}

function execute_planned_jobs(ns, jobs, hosts, plan) {
  const host_map = new Map(hosts.map((h) => [h.hostname, h]));
  const started_pids = [];
  const committed = [];
  const batch_id = `${Date.now()}-${Math.random()}`;

  for (const alloc of plan) {
    const job = jobs[alloc.jobIndex];
    const pid = ns.exec(job.script, alloc.hostname, alloc.threads, job.target, job.delay, batch_id);
    if (pid <= 0) {
      for (const started_pid of started_pids) {
        ns.kill(started_pid);
      }
      for (const item of committed) {
        const host = host_map.get(item.hostname);
        if (host) {
          host.ram += item.threads * item.ram;
        }
      }
      return false;
    }

    started_pids.push(pid);
    committed.push({ hostname: alloc.hostname, threads: alloc.threads, ram: job.ram });
    const host = host_map.get(alloc.hostname);
    if (host) {
      host.ram = Math.max(0, host.ram - alloc.threads * job.ram);
    }
  }

  return true;
}

async function write_server_map_if_needed(ns, server_map, now) {
  const payload = JSON.stringify(server_map);
  const stale = now - last_server_map_write_ms >= SERVER_MAP_WRITE_INTERVAL_MS;
  if (payload === last_server_map_payload && !stale) return;

  last_server_map_payload = payload;
  last_server_map_write_ms = now;
  await ns.write(SERVER_MAP_FILE, JSON.stringify(server_map, null, 2), "w");
}

function pick_prep_income_target(ns, hack_targets) {
  // Prefer to keep the current target stable — only evict it if it drops out of HACK state
  // entirely or falls below 95% money. This prevents per-cycle oscillation when money
  // fluctuates near the 99% HACK threshold.
  if (cached_income_target) {
    const still_hack = hack_targets.some((t) => t.hostname === cached_income_target);
    if (still_hack) {
      try {
        const srv = ns.getServer(cached_income_target);
        const money_ratio = srv.moneyMax > 0 ? srv.moneyAvailable / srv.moneyMax : 0;
        if (money_ratio >= 0.95) return cached_income_target;
      } catch { /* fall through */ }
    }
    cached_income_target = "";
  }

  for (const t of hack_targets) {
    try {
      const srv = ns.getServer(t.hostname);
      const money_ratio = srv.moneyMax > 0 ? srv.moneyAvailable / srv.moneyMax : 0;
      if (money_ratio < 0.995) continue;
    } catch { continue; }
    cached_income_target = t.hostname;
    return t.hostname;
  }
  // No suitable income target — caller will skip income workers entirely
  return "";
}

function capture_prep_host_diag(ns, diag, hostname, action, expected_count, available_ram = null) {
  const prep_procs = ns.ps(hostname).filter((p) => is_prep_script(p.filename));
  let hack_threads = 0;
  let grow_threads = 0;
  let weak_threads = 0;
  for (const proc of prep_procs) {
    const script = String(proc.filename || "");
    if (script.endsWith("w-hack.js") || script === "w-hack.js") hack_threads += Number(proc.threads) || 0;
    if (script.endsWith("w-grow.js") || script === "w-grow.js") grow_threads += Number(proc.threads) || 0;
    if (script.endsWith("w-weak.js") || script === "w-weak.js") weak_threads += Number(proc.threads) || 0;
  }

  diag.totalHackThreads += hack_threads;
  diag.totalGrowThreads += grow_threads;
  diag.totalWeakThreads += weak_threads;
  if (action === "ram-limited") {
    diag.ramLimitedHosts += 1;
  }
  if (diag.hosts.length < MAX_DIAG_HOSTS) {
    diag.hosts.push({
      hostname,
      action,
      expectedScripts: expected_count,
      actualScripts: prep_procs.length,
      availableRam: available_ram === null ? null : Math.floor(available_ram),
      hackThreads: hack_threads,
      growThreads: grow_threads,
      weakThreads: weak_threads,
    });
  }
}

function build_batch_diag(hack_targets, batch_results, launched_batches, failed_execs, runnable_hosts, hosts, available_ram) {
  const blockedTargets = batch_results.filter((result) => result.reason !== "launched" && result.reason !== "partial").length;
  const skippedTemplates = batch_results.filter((result) => result.reason === "no-template").length;
  let state = "idle";
  if (hack_targets.length > 0) {
    state = launched_batches > 0 ? (blockedTargets > 0 ? "partial" : "running") : "blocked";
  }
  return {
    state,
    hackTargetCount: hack_targets.length,
    launchedBatches: launched_batches,
    blockedTargets,
    skippedTemplates,
    failedExecs: failed_execs,
    runnableHostCount: runnable_hosts.length,
    hostCount: hosts.length,
    availableRam: Math.floor(available_ram),
    targets: batch_results.slice(0, MAX_DIAG_TARGETS),
  };
}

function compute_derived_metrics(ns, hosts, runnable_hosts, hack_targets, launched_batches, failed_execs, batch_results, prepDiag, options) {
  const income = money_delta_income;

  // RAM totals
  let totalUsedRam = 0;
  let totalMaxRam = 0;
  let strandedRam = 0;
  for (const h of hosts) {
    const maxR = ns.getServerMaxRam(h.hostname);
    totalMaxRam += maxR;
    totalUsedRam += maxR - h.ram;
    if (h.ram > 0 && h.ram < MIN_EXEC_RAM) strandedRam += h.ram;
  }
  const totalFreeRam = totalMaxRam - totalUsedRam;

  // Efficiency
  const incomePerGB = totalUsedRam > 0 ? income / totalUsedRam : 0;

  // Theoretical income: sum of (maxMoney * hackPercent / batchCycleTime) across hack targets
  let theoreticalIncome = 0;
  for (const t of hack_targets) {
    const wt = ns.getWeakenTime(t.hostname);
    if (Number.isFinite(wt) && wt > 0) {
      const cycleTime = (wt + options.spacingMs * 4) / 1000;
      theoreticalIncome += (t.maxMoney * options.hackPercent) / cycleTime;
    }
  }
  const extractionRatio = theoreticalIncome > 0 ? Math.min(1, income / theoreticalIncome) : 0;

  // Thread census from live processes
  let hackThreads = 0, growThreads = 0, weakThreads = 0;
  for (const h of hosts) {
    for (const proc of ns.ps(h.hostname)) {
      const kind = get_worker_kind(proc.filename);
      if (kind === "hack") hackThreads += proc.threads;
      else if (kind === "grow") growThreads += proc.threads;
      else if (kind === "weak") weakThreads += proc.threads;
    }
  }
  const totalThreads = hackThreads + growThreads + weakThreads;
  const weakenTax = totalThreads > 0 ? weakThreads / totalThreads : 0;

  // Utilization
  const ramUtilization = totalMaxRam > 0 ? totalUsedRam / totalMaxRam : 0;
  const hostActivation = hosts.length > 0 ? runnable_hosts.length / hosts.length : 0;
  const maxSlots = hack_targets.length * options.batchesPerWindow;
  const batchSlotUtilization = maxSlots > 0 ? launched_batches / maxSlots : 0;
  const scheduledTargets = Object.keys(batch_schedule).length;
  const targetCoverage = hack_targets.length > 0 ? scheduledTargets / hack_targets.length : 0;
  const hostFragmentation = totalFreeRam > 0 ? strandedRam / totalFreeRam : 0;

  // Health
  const blockedTargets = batch_results.filter((r) => r.reason !== "launched" && r.reason !== "partial").length;
  const totalAttempts = launched_batches + failed_execs + blockedTargets;
  const batchSuccessRate = totalAttempts > 0 ? launched_batches / totalAttempts : 1;
  const execFailureRatio = (launched_batches + failed_execs) > 0 ? failed_execs / (launched_batches + failed_execs) : 0;
  const blockedRatio = hack_targets.length > 0 ? blockedTargets / hack_targets.length : 0;

  // Prep stability
  const totalPrepHosts = (prepDiag.unchangedHosts || 0) + (prepDiag.adjustedHosts || 0) + (prepDiag.ramLimitedHosts || 0);
  const prepStability = totalPrepHosts > 0 ? (prepDiag.unchangedHosts || 0) / totalPrepHosts : 1;

  // Per-target health
  const perTarget = {};
  for (const t of hack_targets.concat(prepDiag.target ? [{ hostname: prepDiag.target }] : [])) {
    const hn = t.hostname;
    if (perTarget[hn]) continue;
    const srv = ns.getServer(hn);
    const secDrift = srv.minDifficulty > 0 ? (srv.hackDifficulty - srv.minDifficulty) / srv.minDifficulty : 0;
    const moneyRatio = srv.moneyMax > 0 ? srv.moneyAvailable / srv.moneyMax : 0;
    const batchResult = batch_results.find((r) => r.target === hn);
    perTarget[hn] = {
      securityDrift: Math.round(secDrift * 1000) / 1000,
      moneyRatio: Math.round(moneyRatio * 1000) / 1000,
      liveBatches: batchResult ? batchResult.launched : 0,
    };
  }

  // Prep ETA (for primary prep target)
  let prepETA = null;
  if (prepDiag.target && prepDiag.state !== "idle") {
    const srv = ns.getServer(prepDiag.target);
    const secOverhead = srv.hackDifficulty - srv.minDifficulty;
    const netWeaken = (prepDiag.totalWeakThreads || 0) * 0.05 - (prepDiag.totalGrowThreads || 0) * 0.004;
    const wt = ns.getWeakenTime(prepDiag.target);
    const secETA = netWeaken > 0 && secOverhead > 0 ? (secOverhead / netWeaken) * (wt / 1000) : (secOverhead > 0 ? Infinity : 0);

    // Money ETA — grow is multiplicative, use ns.growthAnalyze for accuracy
    const growThreads = prepDiag.totalGrowThreads || 0;
    const gt = ns.getGrowTime(prepDiag.target);
    const moneyRatio = srv.moneyMax > 0 ? srv.moneyAvailable / srv.moneyMax : 0;
    let moneyETA = 0;
    if (moneyRatio < 0.99 && growThreads > 0) {
      const currentMoney = Math.max(1, srv.moneyAvailable);
      const targetMult = (srv.moneyMax * 0.99) / currentMoney;
      const threadsNeeded = ns.growthAnalyze(prepDiag.target, targetMult);
      if (Number.isFinite(threadsNeeded) && threadsNeeded > 0) {
        const cycles = Math.ceil(threadsNeeded / growThreads);
        moneyETA = cycles * gt / 1000;
      } else {
        moneyETA = Infinity;
      }
    } else if (moneyRatio < 0.99) {
      moneyETA = Infinity;
    }

    prepETA = Math.max(secETA, moneyETA);
    if (!Number.isFinite(prepETA)) prepETA = -1; // -1 signals "stalled"
    else prepETA = Math.round(prepETA);
  }

  // Composite system score
  const systemScore =
    extractionRatio * 0.30 +
    ramUtilization * 0.20 +
    batchSuccessRate * 0.20 +
    (1 - blockedRatio) * 0.15 +
    prepStability * 0.15;

  return {
    income: Math.round(income),
    incomePerGB: Math.round(incomePerGB * 100) / 100,
    extractionRatio: Math.round(extractionRatio * 1000) / 1000,
    weakenTax: Math.round(weakenTax * 1000) / 1000,
    ramUtilization: Math.round(ramUtilization * 1000) / 1000,
    hostActivation: Math.round(hostActivation * 1000) / 1000,
    batchSlotUtilization: Math.round(batchSlotUtilization * 1000) / 1000,
    targetCoverage: Math.round(targetCoverage * 1000) / 1000,
    hostFragmentation: Math.round(hostFragmentation * 1000) / 1000,
    batchSuccessRate: Math.round(batchSuccessRate * 1000) / 1000,
    execFailureRatio: Math.round(execFailureRatio * 1000) / 1000,
    blockedRatio: Math.round(blockedRatio * 1000) / 1000,
    prepStability: Math.round(prepStability * 1000) / 1000,
    prepETA,
    systemScore: Math.round(systemScore * 1000) / 1000,
    totalThreads,
    hackThreads,
    growThreads,
    weakThreads,
    totalUsedRam: Math.floor(totalUsedRam),
    totalMaxRam: Math.floor(totalMaxRam),
    perTarget,
  };
}

async function write_manager_status(ns, status, now = Date.now()) {
  const signature = JSON.stringify(status);
  const stale = now - last_status_write_ms >= STATUS_WRITE_INTERVAL_MS;
  if (signature === last_status_signature && !stale) return;

  last_status_signature = signature;
  last_status_write_ms = now;
  const payload = {
    timestamp: new Date().toISOString(),
    ...status,
  };
  await ns.write(MANAGER_STATUS_FILE, JSON.stringify(payload, null, 2), "w");
}
