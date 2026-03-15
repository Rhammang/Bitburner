import { list_servers, get_hosts } from "/modules/utils.js";

const SERVER_MAP_FILE = "/data/server_map.json";
const MANAGER_STATUS_FILE = "/data/manager_status.json";

// Script paths
const WORKERS = {
  PREP_WEAK: "/w-weak.js",
  PREP_GROW: "/w-grow.js",
  PREP_HACK: "/w-hack.js",
  HACK: "/b-hack.js",
  WEAK: "/b-weak.js",
  GROW: "/b-grow.js",
};

const WORKER_SOURCES = {
  [WORKERS.PREP_WEAK]:
    "export async function main(ns) { while (true) { await ns.weaken(ns.args[0]); } }",
  [WORKERS.PREP_GROW]:
    "export async function main(ns) { while (true) { await ns.grow(ns.args[0]); } }",
  [WORKERS.PREP_HACK]:
    "export async function main(ns) { while (true) { await ns.hack(ns.args[0]); } }",
  [WORKERS.HACK]:
    "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.hack(ns.args[0]); }",
  [WORKERS.WEAK]:
    "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.weaken(ns.args[0]); }",
  [WORKERS.GROW]:
    "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.grow(ns.args[0]); }",
};

// Script RAM costs
const RAM = {
  PREP_WEAK: 1.75,
  PREP_GROW: 1.75,
  PREP_HACK: 1.7,
  HACK: 1.7,
  WEAK: 1.75,
  GROW: 1.75,
};

const MIN_EXEC_RAM = 1.7;
const WORKER_SYNC_INTERVAL_MS = 120000;
const SERVER_MAP_WRITE_INTERVAL_MS = 5000;
const STATUS_WRITE_INTERVAL_MS = 5000;

const argsSchema = [
  ["home-reserve", 16],
  ["spacing", 200],
  ["batches-per-window", 5],
  ["schedule-ahead-time", 20000],
  ["loop-sleep", 1000],
  ["prep-sleep", 2000],
  ["hack-percent", 0.15],
  ["verbose", false],
];

let batch_schedule = {}; // { target: [landing_time_ms, ...] }
let worker_sync_cache = {};
let last_server_map_payload = "";
let last_server_map_write_ms = 0;
let last_status_signature = "";
let last_status_write_ms = 0;
let cycle_failed_execs = 0;

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
    const server_map = build_server_map(ns, player);
    await write_server_map_if_needed(ns, server_map, cycle_start);

    cleanup_schedule();

    const prep_targets = server_map.filter((s) => s.hasAdminRights && s.state === "PREP");
    const hack_targets = server_map.filter((s) => s.hasAdminRights && s.state === "HACK");
    const prep_target = prep_targets[0];
    const prep_income_target = prep_target ? pick_prep_income_target(prep_target, hack_targets) : "";

    if (prep_target) {
      await run_prep_workers(ns, prep_target, prep_income_target, options.homeReserve);
      await write_manager_status(ns, {
        mode: "PREP",
        prepTarget: prep_target.hostname,
        prepIncomeTarget: prep_income_target,
        totalTargets: server_map.length,
        prepTargets: prep_targets.length,
        hackTargets: hack_targets.length,
        launchedBatches: 0,
        scheduledTargets: Object.keys(batch_schedule).length,
        homeReserve: options.homeReserve,
      }, cycle_start);
      await ns.sleep(options.prepSleepMs);
      continue;
    }

    stop_prep_workers(ns);

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
    for (const target of hack_targets) {
      launched_batches += launch_batches_for_target(ns, target, runnable_hosts, options);
    }

    const available_ram = runnable_hosts.reduce((acc, h) => acc + h.ram, 0);
    await write_manager_status(ns, {
      mode: "HACK",
      totalTargets: server_map.length,
      prepTargets: prep_targets.length,
      hackTargets: hack_targets.length,
      launchedBatches: launched_batches,
      scheduledTargets: Object.keys(batch_schedule).length,
      homeReserve: options.homeReserve,
      hostCount: hosts.length,
      runnableHostCount: runnable_hosts.length,
      availableRam: Math.floor(available_ram),
      failedExecs: cycle_failed_execs,
    }, cycle_start);

    if (options.verbose) {
      ns.print(
        `Batches launched: ${launched_batches} | hosts: ${runnable_hosts.length}/${hosts.length} | avail RAM: ${Math.floor(available_ram)}`
      );
    }

    const elapsed = Date.now() - cycle_start;
    await ns.sleep(Math.max(50, options.loopSleepMs - elapsed));
  }
}

function get_options(ns) {
  const flags = ns.flags(argsSchema);
  return {
    homeReserve: Math.max(0, Number(flags["home-reserve"]) || 0),
    spacingMs: Math.max(50, Number(flags.spacing) || 200),
    batchesPerWindow: Math.max(1, Math.floor(Number(flags["batches-per-window"]) || 5)),
    scheduleAheadMs: Math.max(1000, Number(flags["schedule-ahead-time"]) || 20000),
    loopSleepMs: Math.max(200, Number(flags["loop-sleep"]) || 1000),
    prepSleepMs: Math.max(200, Number(flags["prep-sleep"]) || 2000),
    hackPercent: clamp(Number(flags["hack-percent"]) || 0.15, 0.01, 0.9),
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

async function run_prep_workers(ns, target, income_target, home_reserve) {
  const income_host = income_target || target.hostname;
  const processes = ns.ps("home");
  const grow_running = processes.some(
    (p) => p.filename === WORKERS.PREP_GROW && p.args[0] === target.hostname
  );
  const weak_running = processes.some(
    (p) => p.filename === WORKERS.PREP_WEAK && p.args[0] === target.hostname
  );
  const hack_running = processes.some(
    (p) => p.filename === WORKERS.PREP_HACK && p.args[0] === income_host
  );
  if (grow_running && weak_running && hack_running) return;

  const any_prep_running = processes.some(
    (p) =>
      p.filename === WORKERS.PREP_GROW ||
      p.filename === WORKERS.PREP_WEAK ||
      p.filename === WORKERS.PREP_HACK
  );
  if (any_prep_running) {
    stop_prep_workers(ns);
    await ns.sleep(50);
  }

  const available_ram = Math.max(
    0,
    ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - home_reserve
  );
  if (available_ram < RAM.PREP_HACK) return;

  const max_hack_threads = Math.max(1, Math.floor(available_ram / RAM.PREP_HACK));
  const hack_threads = clamp(Math.floor(max_hack_threads * 0.12), 1, 8);
  const prep_ram = Math.max(0, available_ram - hack_threads * RAM.PREP_HACK);

  let grow_threads = Math.floor(prep_ram / (RAM.PREP_GROW + RAM.PREP_WEAK / 12));
  let weak_threads = Math.max(1, Math.ceil((grow_threads * 0.004 + hack_threads * 0.002) / 0.05));

  while (
    grow_threads > 0 &&
    grow_threads * RAM.PREP_GROW + weak_threads * RAM.PREP_WEAK + hack_threads * RAM.PREP_HACK >
      available_ram
  ) {
    grow_threads -= 1;
    weak_threads = Math.max(1, Math.ceil((grow_threads * 0.004 + hack_threads * 0.002) / 0.05));
  }

  if (grow_threads > 0) ns.exec(WORKERS.PREP_GROW, "home", grow_threads, target.hostname);
  if (weak_threads > 0) ns.exec(WORKERS.PREP_WEAK, "home", weak_threads, target.hostname);
  if (hack_threads > 0) ns.exec(WORKERS.PREP_HACK, "home", hack_threads, income_host);
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
  const prep_scripts = new Set([WORKERS.PREP_GROW, WORKERS.PREP_WEAK, WORKERS.PREP_HACK]);
  for (const proc of ns.ps("home")) {
    if (prep_scripts.has(proc.filename)) {
      ns.kill(proc.pid);
    }
  }
}

function launch_batches_for_target(ns, target, hosts, options) {
  let launched = 0;
  const window_end = Date.now() + options.scheduleAheadMs;
  const template = calculate_batch_template(ns, target, options);
  if (!template) return launched;
  if (!batch_schedule[target.hostname]) batch_schedule[target.hostname] = [];

  for (let i = 0; i < options.batchesPerWindow; i++) {
    const landing_time = find_next_available_window(target.hostname, options.spacingMs);
    if (landing_time > window_end) continue;

    const jobs = build_batch_jobs(template, target.hostname, landing_time, options.spacingMs);

    const plan = plan_job_allocations(jobs, hosts);
    if (!plan) break;

    const launched_ok = execute_planned_jobs(ns, jobs, hosts, plan);
    if (!launched_ok) { cycle_failed_execs += 1; break; }

    batch_schedule[target.hostname].push(
      landing_time - options.spacingMs,
      landing_time,
      landing_time + options.spacingMs,
      landing_time + 2 * options.spacingMs
    );
    launched += 1;
  }

  return launched;
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

  const hack_threads = safe_threads(Math.floor(ns.hackAnalyzeThreads(target.hostname, money_to_hack)));
  const weak1_threads = safe_threads(Math.ceil(ns.hackAnalyzeSecurity(hack_threads) / 0.05));
  const grow_threads = safe_threads(Math.ceil(ns.growthAnalyze(target.hostname, 1 / (1 - hack_percent))));
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

function pick_prep_income_target(prep_target, hack_targets) {
  if (hack_targets.length > 0) {
    return hack_targets[0].hostname;
  }
  return prep_target.hostname;
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
