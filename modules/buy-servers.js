import {
  BUY_SERVERS_BUDGET_FRACTION,
  BUY_SERVERS_LOOP_MS,
  BUY_SERVERS_MIN_RAM,
  BUY_SERVERS_SERVER_PREFIX,
} from "/modules/runtime-contracts.js";

const LOOP_MS = BUY_SERVERS_LOOP_MS;
const SERVER_PREFIX = BUY_SERVERS_SERVER_PREFIX;
const MIN_RAM = BUY_SERVERS_MIN_RAM;
const BUDGET_FRACTION = BUY_SERVERS_BUDGET_FRACTION;

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  while (true) {
    try_buy_server(ns);
    await ns.sleep(LOOP_MS);
  }
}

function try_buy_server(ns) {
  const purchased = ns.getPurchasedServers();
  const limit = ns.getPurchasedServerLimit();
  const money = ns.getServerMoneyAvailable("home");
  const budget = money * BUDGET_FRACTION;
  const max_ram = ns.getPurchasedServerMaxRam();

  if (purchased.length < limit) {
    let best_ram = 0;
    for (let ram = MIN_RAM; ram <= max_ram; ram *= 2) {
      if (ns.getPurchasedServerCost(ram) <= budget) {
        best_ram = ram;
      } else {
        break;
      }
    }
    if (best_ram < MIN_RAM) return;
    const new_name = `${SERVER_PREFIX}${purchased.length}`;
    const result = ns.purchaseServer(new_name, best_ram);
    if (result) {
      ns.tprint(`BUY-SERVERS: purchased ${result} (${best_ram}GB)`);
    }
    return;
  }

  // At capacity — upgrade the weakest server.
  const weakest = purchased.reduce((min, s) =>
    ns.getServerMaxRam(s) < ns.getServerMaxRam(min) ? s : min
  );
  const current_ram = ns.getServerMaxRam(weakest);
  if (current_ram >= max_ram) return;

  let best_upgrade = 0;
  for (let ram = current_ram * 2; ram <= max_ram; ram *= 2) {
    if (ns.getPurchasedServerUpgradeCost(weakest, ram) <= budget) {
      best_upgrade = ram;
    } else {
      break;
    }
  }
  if (best_upgrade <= current_ram) return;

  if (ns.upgradePurchasedServer(weakest, best_upgrade)) {
    ns.tprint(`BUY-SERVERS: upgraded ${weakest} ${current_ram}GB → ${best_upgrade}GB`);
  }
}
