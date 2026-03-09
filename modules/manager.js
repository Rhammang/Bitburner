import { list_servers, get_hosts } from "/modules/utils.js";

const SERVER_MAP_FILE = "/data/server_map.json";
const MANAGER_STATUS_FILE = "/data/manager_status.json";

// Script paths
const WORKERS = {
  PREP_WEAK: "/w-weak.js",
  PREP_GROW: "/w-grow.js",
  HACK: "/b-hack.js",
  WEAK: "/b-weak.js",
  GROW: "/b-grow.js",
};

// Script RAM costs
const RAM = {
  PREP_WEAK: 1.75,
  PREP_GROW: 1.75,
  HACK: 1.7,
  WEAK: 1.75,
  GROW: 1.75,
};

const argsSchema = [
  ["home-reserve", 64],
  ["spacing", 200],
  ["batches-per-window", 5],
  ["schedule-ahead-time", 20000],
  ["loop-sleep", 1000],
  ["prep-sleep", 2000],
  ["hack-percent", 0.15],
  ["verbose", false],
];

let batch_schedule = {}; // { target: [landing_time_ms, ...] }

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
  ns.tprint(
    `MANAGER v2.1: Starting up. reserve=${options.homeReserve}GB spacing=${options.spacingMs}ms`
  );

  while (true) {
    const cycle_start = Date.now();
    const player = ns.getPlayer();
    const server_map = build_server_map(ns, player);
    await ns.write(SERVER_MAP_FILE, JSON.stringify(server_map, null, 2), "w");

    cleanup_schedule();

    const prep_targets = server_map.filter((s) => s.hasAdminRights && s.state === "PREP");
    const hack_targets = server_map.filter((s) => s.hasAdminRights && s.state === "HACK");
    const prep_target = prep_targets[0];

    if (prep_target) {
      await run_prep_workers(ns, prep_target, options.homeReserve);
      await write_manager_status(ns, {
        mode: "PREP",
        prepTarget: prep_target.hostname,
        totalTargets: server_map.length,
        prepTargets: prep_targets.length,
        hackTargets: hack_targets.length,
        launchedBatches: 0,
        scheduledTargets: Object.keys(batch_schedule).length,
        homeReserve: options.homeReserve,
      });
      await ns.sleep(options.prepSleepMs);
      continue;
    }

    const hosts = get_hosts(ns)
      .map((h) => ({
        hostname: h,
        ram: ns.getServerMaxRam(h) - ns.getServerUsedRam(h),
      }))
      .sort(sort_hosts);
    apply_home_reserve(hosts, options.homeReserve);

    let launched_batches = 0;
    for (const target of hack_targets) {
      launched_batches += launch_batches_for_target(ns, target, hosts, options);
    }

    const available_ram = hosts.reduce((acc, h) => acc + h.ram, 0);
    await write_manager_status(ns, {
      mode: "HACK",
      totalTargets: server_map.length,
      prepTargets: prep_targets.length,
      hackTargets: hack_targets.length,
      launchedBatches: launched_batches,
      scheduledTargets: Object.keys(batch_schedule).length,
      homeReserve: options.homeReserve,
      hostCount: hosts.length,
      availableRam: Math.floor(available_ram),
    });

    if (options.verbose) {
      ns.print(
        `Batches launched: ${launched_batches} | hosts: ${hosts.length} | avail RAM: ${Math.floor(available_ram)}`
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

async function run_prep_workers(ns, target, home_reserve) {
  ns.kill(WORKERS.PREP_WEAK, "home");
  ns.kill(WORKERS.PREP_GROW, "home");
  await ns.sleep(200);

  const available_ram = Math.max(
    0,
    ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - home_reserve
  );
  if (available_ram < RAM.PREP_GROW) return;

  const grow_threads = Math.floor(available_ram / (RAM.PREP_GROW + RAM.PREP_WEAK / 12));
  const weak_threads = Math.max(1, Math.ceil(grow_threads / 12));

  if (grow_threads > 0) ns.exec(WORKERS.PREP_GROW, "home", grow_threads, target.hostname);
  if (weak_threads > 0) ns.exec(WORKERS.PREP_WEAK, "home", weak_threads, target.hostname);
}

function launch_batches_for_target(ns, target, hosts, options) {
  let launched = 0;
  const window_end = Date.now() + options.scheduleAheadMs;
  if (!batch_schedule[target.hostname]) batch_schedule[target.hostname] = [];

  for (let i = 0; i < options.batchesPerWindow; i++) {
    const landing_time = find_next_available_window(target.hostname, options.spacingMs);
    if (landing_time > window_end) continue;

    const jobs = calculate_batch_jobs(ns, target, landing_time, options);
    if (!jobs) break;

    const plan = plan_job_allocations(jobs, hosts);
    if (!plan) break;

    const launched_ok = execute_planned_jobs(ns, jobs, hosts, plan);
    if (!launched_ok) break;

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

function calculate_batch_jobs(ns, target, landing_time, options) {
  const hack_percent = options.hackPercent;
  const money_to_hack = target.maxMoney * hack_percent;

  const hack_threads = safe_threads(Math.floor(ns.hackAnalyzeThreads(target.hostname, money_to_hack)));
  const weak1_threads = safe_threads(Math.ceil(ns.hackAnalyzeSecurity(hack_threads) / 0.05));
  const grow_threads = safe_threads(Math.ceil(ns.growthAnalyze(target.hostname, 1 / (1 - hack_percent))));
  const weak2_threads = safe_threads(Math.ceil(ns.growthAnalyzeSecurity(grow_threads) / 0.05));

  const weaken_time = ns.getWeakenTime(target.hostname);
  const grow_time = ns.getGrowTime(target.hostname);
  const hack_time = ns.getHackTime(target.hostname);

  return [
    {
      script: WORKERS.HACK,
      threads: hack_threads,
      ram: RAM.HACK,
      delay: Math.max(0, landing_time - options.spacingMs - hack_time),
      target: target.hostname,
    },
    {
      script: WORKERS.WEAK,
      threads: weak1_threads,
      ram: RAM.WEAK,
      delay: Math.max(0, landing_time - weaken_time),
      target: target.hostname,
    },
    {
      script: WORKERS.GROW,
      threads: grow_threads,
      ram: RAM.GROW,
      delay: Math.max(0, landing_time + options.spacingMs - grow_time),
      target: target.hostname,
    },
    {
      script: WORKERS.WEAK,
      threads: weak2_threads,
      ram: RAM.WEAK,
      delay: Math.max(0, landing_time + options.spacingMs * 2 - weaken_time),
      target: target.hostname,
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
  const batch_id = `${Date.now()}-${Math.random()}`;

  for (const alloc of plan) {
    const job = jobs[alloc.jobIndex];
    const pid = ns.exec(job.script, alloc.hostname, alloc.threads, job.target, job.delay, batch_id);
    if (pid <= 0) {
      for (const started_pid of started_pids) {
        ns.kill(started_pid);
      }
      return false;
    }

    started_pids.push(pid);
    const host = host_map.get(alloc.hostname);
    if (host) {
      host.ram = Math.max(0, host.ram - alloc.threads * job.ram);
    }
  }

  return true;
}

async function write_manager_status(ns, status) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...status,
  };
  await ns.write(MANAGER_STATUS_FILE, JSON.stringify(payload, null, 2), "w");
}
