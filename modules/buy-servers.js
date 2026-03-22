import {
  BUY_SERVERS_LOOP_MS,
  load_config,
} from "/modules/runtime-contracts.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  while (true) {
    try_buy_server(ns);
    await ns.sleep(BUY_SERVERS_LOOP_MS);
  }
}

function try_buy_server(ns) {
  const cfg = load_config(ns).buyServers;
  const purchased = ns.getPurchasedServers();
  const limit = ns.getPurchasedServerLimit();
  const money = ns.getServerMoneyAvailable("home");
  const budget = money * cfg.budgetFraction;
  const max_ram = ns.getPurchasedServerMaxRam();

  if (purchased.length < limit) {
    let best_ram = 0;
    for (let ram = cfg.minRam; ram <= max_ram; ram *= 2) {
      if (ns.getPurchasedServerCost(ram) <= budget) {
        best_ram = ram;
      } else {
        break;
      }
    }
    if (best_ram < cfg.minRam) return;
    const new_name = `${cfg.serverPrefix}${purchased.length}`;
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
