import { list_servers } from "/modules/utils.js";

const ROOTED_FILE = "/data/rooted.txt";
const WORKER_FILE = "/w-lite-cycle.js";
const LOOP_MS = 5000;
const HOME_RESERVE = 16;
const WORKER_RAM = 1.75;
const WORKER_SYNC_INTERVAL_MS = 120000;
let worker_sync_cache = {};

const WORKER_SOURCE =
  "export async function main(ns) { const target = ns.args[0]; while (true) { if (!ns.serverExists(target)) return; const maxMoney = ns.getServerMaxMoney(target); const money = ns.getServerMoneyAvailable(target); const minSec = ns.getServerMinSecurityLevel(target); const sec = ns.getServerSecurityLevel(target); if (sec > minSec + 5) { await ns.weaken(target); } else if (money < maxMoney * 0.85) { await ns.grow(target); } else { await ns.hack(target); } } }";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ensure_worker(ns);

  while (true) {
    if (ns.isRunning("/modules/manager.js", "home")) return;

    const rooted_hosts = read_rooted_hosts(ns);
    const target = pick_target(ns, rooted_hosts);
    if (!target) {
      await ns.sleep(LOOP_MS);
      continue;
    }

    const now = Date.now();
    const active_hosts = new Set(rooted_hosts);
    for (const hostname of Object.keys(worker_sync_cache)) {
      if (!active_hosts.has(hostname)) {
        delete worker_sync_cache[hostname];
      }
    }

    for (const host of rooted_hosts) {
      if (!ns.serverExists(host) || !ns.hasRootAccess(host)) continue;
      if (ns.getServerMaxRam(host) < WORKER_RAM) continue;

      if (host !== "home") {
        const last_sync = worker_sync_cache[host] || 0;
        const needs_sync =
          !ns.fileExists(WORKER_FILE, host) || now - last_sync >= WORKER_SYNC_INTERVAL_MS;
        if (!needs_sync) {
          // Continue to execution checks without syncing.
        } else {
          try {
            if (!ns.scp(WORKER_FILE, host, "home")) continue;
            worker_sync_cache[host] = now;
          } catch {
            continue;
          }
        }
      }

      const available_ram = Math.max(
        0,
        ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - (host === "home" ? HOME_RESERVE : 0)
      );
      const threads = Math.floor(available_ram / WORKER_RAM);
      if (threads < 1) continue;

      const processes = ns.ps(host);
      const running_same_target = processes.some(
        (p) => p.filename === WORKER_FILE && p.args[0] === target
      );
      if (running_same_target) continue;

      for (const process of processes) {
        if (process.filename === WORKER_FILE) {
          ns.kill(process.pid);
        }
      }

      ns.exec(WORKER_FILE, host, threads, target);
    }

    await ns.sleep(LOOP_MS);
  }
}

function ensure_worker(ns) {
  if (!ns.fileExists(WORKER_FILE, "home")) {
    ns.write(WORKER_FILE, WORKER_SOURCE, "w");
  }
}

function read_rooted_hosts(ns) {
  const lines = ns
    .read(ROOTED_FILE)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 0) return lines;
  return list_servers(ns).filter((host) => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0);
}

function pick_target(ns, hosts) {
  const candidates = hosts
    .filter(
      (host) =>
        ns.serverExists(host) &&
        host !== "home" &&
        ns.hasRootAccess(host) &&
        ns.getServerMaxMoney(host) > 0 &&
        ns.getServerRequiredHackingLevel(host) <= ns.getHackingLevel()
    )
    .sort((a, b) => score_target(ns, b) - score_target(ns, a));

  return candidates.length > 0 ? candidates[0] : null;
}

function score_target(ns, host) {
  return ns.getServerMaxMoney(host) / Math.max(1, ns.getWeakenTime(host));
}
