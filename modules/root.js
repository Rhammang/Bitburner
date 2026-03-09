import { list_servers } from "/modules/utils.js";

const SERVERS_FILE = "/data/servers.txt";
const ROOTED_FILE = "/data/rooted.txt";
const TARGETS_FILE = "/data/targets.txt";
const PREPPED_FILE = "/data/prepped.txt";
const LOOP_MS = 5000;
let last_outputs = {
  servers: "",
  rooted: "",
  targets: "",
  prepped: "",
};

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
    const all_servers = list_servers(ns);
    let rooted_this_pass = 0;

    for (const host of all_servers) {
      if (host === "home" || ns.hasRootAccess(host)) continue;
      if (try_root_host(ns, host)) rooted_this_pass += 1;
    }

    const rooted_hosts = all_servers.filter(
      (host) => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0
    );
    const target_hosts = all_servers
      .filter(
        (host) =>
          ns.hasRootAccess(host) &&
          ns.getServerMaxMoney(host) > 0 &&
          ns.getServerRequiredHackingLevel(host) <= ns.getHackingLevel()
      )
      .map((host) => ({ host, score: score_target(ns, host) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.host);
    const prepped_hosts = target_hosts.filter((host) => is_prepped(ns, host));

    await write_if_changed(ns, SERVERS_FILE, all_servers.join("\n"), "servers");
    await write_if_changed(ns, ROOTED_FILE, rooted_hosts.join("\n"), "rooted");
    await write_if_changed(ns, TARGETS_FILE, target_hosts.join("\n"), "targets");
    await write_if_changed(ns, PREPPED_FILE, prepped_hosts.join("\n"), "prepped");

    if (rooted_this_pass > 0) {
      ns.tprint(`ROOT: gained access on ${rooted_this_pass} server(s)`);
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
      // Keep trying with available openers; nuke check gates final success.
    }
  }

  if (ns.getServerNumPortsRequired(host) > count_open_ports(ns, host)) return false;

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

function score_target(ns, host) {
  const max_money = Math.max(1, ns.getServerMaxMoney(host));
  const weaken_time = Math.max(1, ns.getWeakenTime(host));
  return max_money / weaken_time;
}

function is_prepped(ns, host) {
  const max_money = ns.getServerMaxMoney(host);
  const money_now = ns.getServerMoneyAvailable(host);
  const min_sec = ns.getServerMinSecurityLevel(host);
  const sec_now = ns.getServerSecurityLevel(host);
  return money_now >= max_money * 0.99 && sec_now <= min_sec + 0.5;
}

async function write_if_changed(ns, path, payload, key) {
  if (last_outputs[key] === payload) return;
  last_outputs[key] = payload;
  await ns.write(path, payload, "w");
}
