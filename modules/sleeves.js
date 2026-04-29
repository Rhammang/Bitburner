/**
 * Sleeve control module. Requires Source-File 10.
 *
 * Per cycle, for each sleeve:
 *   1. Buy sleeve augmentations when affordable (above sleeves.cashReserve).
 *   2. Shock recovery if shock > sleeves.shockThreshold.
 *   3. Bladeburner specialization (gated, real selection in Task 5.1).
 *   4. Pick a task per sleeves.prioritize: train-hacking, crime, faction, idle.
 *
 * @param {NS} ns
 */

import {
  SLEEVES_LOOP_MS,
  SLEEVES_STATUS_FILE,
  FACTIONS_STATUS_FILE,
  load_config,
} from "/modules/runtime-contracts.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (typeof ns.sleeve === "undefined" || typeof ns.sleeve.getNumSleeves !== "function") {
    ns.tprint("SLEEVES: Sleeve API unavailable (need Source-File 10). Disabling.");
    await write_status(ns, {
      enabled: false,
      apiAvailable: false,
      bladeburnerAvailable: false,
      karma: 0,
      summary: empty_summary(),
      sleeves: [],
      reason: "sleeve-api-missing",
    });
    return;
  }

  while (true) {
    try {
      const status = await run_cycle(ns);
      await write_status(ns, status);
    } catch (e) {
      ns.print(`SLEEVES: cycle error: ${e}`);
    }
    await ns.sleep(SLEEVES_LOOP_MS);
  }
}

async function run_cycle(ns) {
  const cfg = load_config(ns).sleeves || {};
  if (cfg.enabled === false) {
    return {
      enabled: false,
      apiAvailable: true,
      bladeburnerAvailable: false,
      karma: 0,
      summary: empty_summary(),
      sleeves: [],
      reason: "disabled-by-config",
    };
  }

  const context = collect_context(ns);
  const num = ns.sleeve.getNumSleeves();
  const summary = empty_summary();
  const sleeves = [];

  for (let i = 0; i < num; i++) {
    const augsPurchased = try_buy_sleeve_augs(ns, i, cfg.cashReserve);
    const task = pick_sleeve_task(ns, i, cfg, context);
    summary[task.type] = (summary[task.type] || 0) + 1;
    sleeves.push({ ...summarize_sleeve(ns, i), task, augsPurchased });
  }

  return {
    enabled: true,
    apiAvailable: true,
    bladeburnerAvailable: context.bladeburnerAvailable,
    karma: context.karma,
    summary,
    sleeves,
  };
}

function empty_summary() {
  return { shock: 0, training: 0, crime: 0, faction: 0, idle: 0, bladeburner: 0 };
}

function collect_context(ns) {
  let karma = 0;
  try {
    karma = ns.heart.break();
  } catch {
    karma = 0;
  }
  let bladeburnerAvailable = false;
  try {
    bladeburnerAvailable =
      typeof ns.bladeburner !== "undefined" &&
      typeof ns.bladeburner.getCurrentAction === "function";
  } catch {
    bladeburnerAvailable = false;
  }
  let factionsStatus = null;
  try {
    const raw = ns.read(FACTIONS_STATUS_FILE);
    factionsStatus = raw ? JSON.parse(raw) : null;
  } catch {
    factionsStatus = null;
  }
  return { karma, bladeburnerAvailable, factionsStatus };
}

function try_buy_sleeve_augs(ns, sleeveIndex, reserve) {
  const minReserve = Math.max(0, Number(reserve) || 0);
  let purchased = 0;
  let augs = [];
  try {
    augs = ns.sleeve.getSleevePurchasableAugs(sleeveIndex);
  } catch {
    return 0;
  }
  if (!Array.isArray(augs) || augs.length === 0) return 0;
  augs.sort((a, b) => a.cost - b.cost);
  for (const aug of augs) {
    if (ns.getPlayer().money - aug.cost < minReserve) break;
    if (ns.sleeve.purchaseSleeveAug(sleeveIndex, aug.name)) {
      purchased += 1;
    } else {
      break;
    }
  }
  return purchased;
}

function summarize_sleeve(ns, sleeveIndex) {
  let info = null;
  try {
    info = ns.sleeve.getSleeve(sleeveIndex);
  } catch {
    info = null;
  }
  return {
    index: sleeveIndex,
    shock: info?.shock ?? null,
    sync: info?.sync ?? null,
    stats: info ? {
      hacking: info.skills?.hacking ?? null,
      strength: info.skills?.strength ?? null,
      defense: info.skills?.defense ?? null,
      dexterity: info.skills?.dexterity ?? null,
      agility: info.skills?.agility ?? null,
      charisma: info.skills?.charisma ?? null,
    } : null,
    moneyRate: null,
  };
}

async function write_status(ns, status) {
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), ...status }, null, 2);
  await ns.write(SLEEVES_STATUS_FILE, payload, "w");
}

function pick_sleeve_task(ns, sleeveIndex, cfg, context) {
  // Phase 4.3 fills in real assignment logic.
  return { type: "idle", detail: "stub" };
}
