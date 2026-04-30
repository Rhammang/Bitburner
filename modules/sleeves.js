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

function is_factions_status_fresh(factionsStatus, maxAgeMs = 5 * 60 * 1000) {
  if (!factionsStatus || !factionsStatus.timestamp) return false;
  const ts = Date.parse(factionsStatus.timestamp);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= maxAgeMs;
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
  let info = null;
  try {
    info = ns.sleeve.getSleeve(sleeveIndex);
  } catch {
    return { type: "idle", detail: "no-info" };
  }

  if (info?.shock != null && info.shock > Number(cfg.shockThreshold ?? 50)) {
    if (assign_shock_recovery(ns, sleeveIndex)) {
      return { type: "shock", detail: `shock=${info.shock.toFixed(1)}` };
    }
  }

  if (
    cfg.bladeburnerSleeve === true &&
    sleeveIndex === Number(cfg.bladeburnerSleeveIndex || 0) &&
    context.bladeburnerAvailable
  ) {
    const bb = assign_bladeburner(ns, sleeveIndex, context);
    if (bb) return { type: "bladeburner", detail: bb };
  }

  const priorities = Array.isArray(cfg.prioritize) && cfg.prioritize.length > 0
    ? cfg.prioritize
    : ["train-hacking", "crime", "faction", "idle"];

  for (const priority of priorities) {
    if (priority === "train-hacking") {
      const targetLevel = Number(cfg.trainingHackingLevel || 100);
      const hacking = info?.skills?.hacking ?? 0;
      if (hacking < targetLevel) {
        if (assign_hacking_training(ns, sleeveIndex)) {
          return { type: "training", detail: `hacking ${hacking}/${targetLevel}` };
        }
      }
    } else if (priority === "crime") {
      const crime = pick_crime_task(ns, sleeveIndex, context);
      if (crime && assign_crime(ns, sleeveIndex, crime)) {
        return { type: "crime", detail: crime };
      }
    } else if (priority === "faction") {
      const result = assign_faction_mirror(ns, sleeveIndex, context);
      if (result) return { type: "faction", detail: result };
    } else if (priority === "idle") {
      try {
        ns.sleeve.setToIdle(sleeveIndex);
      } catch {
        // ignore
      }
      return { type: "idle", detail: "configured" };
    }
  }
  return { type: "idle", detail: "fallthrough" };
}

function assign_shock_recovery(ns, sleeveIndex) {
  try {
    return ns.sleeve.setToShockRecovery(sleeveIndex) === true;
  } catch {
    return false;
  }
}

function assign_hacking_training(ns, sleeveIndex) {
  try {
    if (!ns.sleeve.travel(sleeveIndex, "Sector-12")) return false;
    return ns.sleeve.setToUniversityCourse(sleeveIndex, "Rothman University", "Algorithms") === true;
  } catch {
    return false;
  }
}

function pick_crime_task(ns, sleeveIndex, context) {
  if (context.karma > -54000) {
    return "Homicide";
  }
  // After Daedalus karma met, fall back to the historically best money/sec crime.
  return "Heist";
}

function assign_crime(ns, sleeveIndex, crime) {
  try {
    return ns.sleeve.setToCommitCrime(sleeveIndex, crime) === true;
  } catch {
    return false;
  }
}

function assign_faction_mirror(ns, sleeveIndex, context) {
  if (!is_factions_status_fresh(context.factionsStatus)) return null;
  const work = context.factionsStatus?.workTarget;
  if (!work || !work.faction) return null;

  // Prefer the exact work type the main player is doing, fall back to the
  // legacy ordered list if workType wasn't recorded.
  const preferred = work.workType ? [String(work.workType)] : [];
  const fallback = ["hacking", "field", "security"];
  const types = [...preferred, ...fallback.filter((t) => !preferred.includes(t))];

  for (const type of types) {
    try {
      if (ns.sleeve.setToFactionWork(sleeveIndex, work.faction, type) === true) {
        return `${work.faction}:${type}`;
      }
    } catch {
      // try next type
    }
  }
  return null;
}

function assign_bladeburner(ns, sleeveIndex, context) {
  try {
    if (typeof ns.bladeburner?.inBladeburner === "function" && !ns.bladeburner.inBladeburner()) {
      return null;
    }
  } catch {
    return null;
  }

  // Bladeburner contract type names changed over Bitburner versions; probe
  // both spellings rather than commit to one.
  const get_chance = (name) => {
    for (const type of ["Contract", "Contracts"]) {
      try {
        return ns.bladeburner.getActionEstimatedSuccessChance(type, name, sleeveIndex);
      } catch {
        // try next
      }
    }
    return null;
  };

  const get_remaining = (name) => {
    for (const type of ["Contract", "Contracts"]) {
      try {
        return ns.bladeburner.getActionCountRemaining(type, name);
      } catch {
        // try next
      }
    }
    return null;
  };

  // Easiest contracts first; Operations are intentionally not picked here
  // until the sleeve API path for them is runtime-verified.
  let needs_analysis = false;
  for (const name of ["Bounty Hunter", "Retirement", "Tracking"]) {
    const remaining = get_remaining(name);
    if (remaining != null && remaining <= 0) continue;

    const chance = get_chance(name);
    if (!chance) continue;

    const [min_chance, max_chance] = chance;
    if (max_chance - min_chance > 0.15) needs_analysis = true;
    if (min_chance < 0.70) continue;

    try {
      if (ns.sleeve.setToBladeburnerAction(sleeveIndex, "Take on contracts", name)) {
        return `contract:${name} ${Math.round(min_chance * 100)}-${Math.round(max_chance * 100)}%`;
      }
    } catch {
      // try next contract
    }
  }

  // Wide chance variance means low intel — Field Analysis tightens estimates.
  if (needs_analysis) {
    try {
      if (ns.sleeve.setToBladeburnerAction(sleeveIndex, "Field analysis")) {
        return "general:field-analysis";
      }
    } catch {
      // fall through
    }
  }

  // Last resort: Training keeps the sleeve productive without risking failure
  // penalties on contracts the chance gate rejected.
  try {
    if (ns.sleeve.setToBladeburnerAction(sleeveIndex, "Training")) {
      return "general:training";
    }
  } catch {
    // ignore
  }

  return null;
}
