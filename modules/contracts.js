import { list_servers } from "/modules/utils.js";
import {
  CONTRACTS_STATUS_FILE,
} from "/modules/runtime-contracts.js";

const STATUS_FILE = CONTRACTS_STATUS_FILE;
const LOOP_MS = 60000;

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  let last_count = -1;

  while (true) {
    const contracts = find_contracts(ns);
    const lines = contracts.map((entry) => `${entry.host}\t${entry.file}\t${entry.type}`);

    await ns.write(STATUS_FILE, lines.join("\n"), "w");
    if (contracts.length !== last_count && contracts.length > 0) {
      ns.tprint(`CONTRACTS: discovered ${contracts.length} contract(s)`);
    }
    last_count = contracts.length;

    await ns.sleep(LOOP_MS);
  }
}

function find_contracts(ns) {
  const found = [];
  for (const host of list_servers(ns)) {
    for (const file of ns.ls(host, ".cct")) {
      const type = ns.codingcontract.getContractType(file, host);
      found.push({ host, file, type });
    }
  }
  return found;
}
