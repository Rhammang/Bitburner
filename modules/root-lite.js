import { list_servers } from "/modules/utils.js";
import {
  DEPLOY_LITE_WORKER_FILE,
  DEPLOY_LITE_WORKER_RAM,
  DEPLOY_LITE_WORKER_SOURCE,
  DEPLOY_LITE_WORKER_SYNC_INTERVAL_MS,
  ROOTED_FILE,
  ROOT_LITE_LOOP_MS,
  ROOT_MODULE_FILE,
} from "/modules/runtime-contracts.js";

const WORKER_FILE = DEPLOY_LITE_WORKER_FILE;
const WORKER_SOURCE = DEPLOY_LITE_WORKER_SOURCE;
const LOOP_MS = ROOT_LITE_LOOP_MS;
const WORKER_RAM = DEPLOY_LITE_WORKER_RAM;
const WORKER_SYNC_INTERVAL_MS = DEPLOY_LITE_WORKER_SYNC_INTERVAL_MS;
let last_rooted_payload = "";

const PORT_OPENERS = [
  { program: "BruteSSH.exe", open: (ns, host) => ns.brutessh(host) },
  { program: "FTPCrack.exe", open: (ns, host) => ns.ftpcrack(host) },
  { program: "relaySMTP.exe", open: (ns, host) => ns.relaysmtp(host) },
  { program: "HTTPWorm.exe", open: (ns, host) => ns.httpworm(host) },
  { program: "SQLInject.exe", open: (ns, host) => ns.sqlinject(host) },
];

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  while (true) {
    if (ns.isRunning(ROOT_MODULE_FILE, "home")) return;

    const all_servers = list_servers(ns);
    let rooted_this_pass = 0;
    for (const host of all_servers) {
      if (host === "home" || ns.hasRootAccess(host)) continue;
      if (try_root_host(ns, host)) rooted_this_pass += 1;
    }

    const rooted_hosts = all_servers.filter(
      (host) => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0
    );
    const payload = rooted_hosts.join("\n");
    if (payload !== last_rooted_payload) {
      last_rooted_payload = payload;
      await ns.write(ROOTED_FILE, payload, "w");
    }

    if (rooted_this_pass > 0) {
      ns.tprint(`ROOT-LITE: gained access on ${rooted_this_pass} server(s)`);
    }

    await ns.sleep(LOOP_MS);
  }
}

function try_root_host(ns, host) {
  if (ns.getHackingLevel() < ns.getServerRequiredHackingLevel(host)) return false;

  for (const opener of PORT_OPENERS) {
    if (!ns.fileExists(opener.program, "home")) continue;
    try {
      opener.open(ns, host);
    } catch {
      // Keep trying with available openers.
    }
  }

  const needed_ports = ns.getServerNumPortsRequired(host);
  if (needed_ports > count_open_ports(ns, host)) return false;

  try {
    ns.nuke(host);
  } catch {
    return false;
  }

  return ns.hasRootAccess(host);
}

function count_open_ports(ns, host) {
  const server = ns.getServer(host);
  let open = 0;
  if (server.sshPortOpen) open += 1;
  if (server.ftpPortOpen) open += 1;
  if (server.smtpPortOpen) open += 1;
  if (server.httpPortOpen) open += 1;
  if (server.sqlPortOpen) open += 1;
  return open;
}
