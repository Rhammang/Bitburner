const LOOP_MS = 30000;
const SERVER_PREFIX = "pserv-";
const MIN_RAM = 8;
const BUDGET_FRACTION = 0.25;

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
  if (purchased.length >= limit) return;

  const money = ns.getServerMoneyAvailable("home");
  const budget = money * BUDGET_FRACTION;
  const max_ram = ns.getPurchasedServerMaxRam();

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
}
