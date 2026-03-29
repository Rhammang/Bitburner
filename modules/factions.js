/**
 * Singularity progression automation module.
 * Requires Source-File 4 (Singularity API).
 *
 * Strategy:
 *   1. Buy TOR + darkweb programs when affordable
 *   2. Backdoor faction servers when rooted and eligible
 *   3. Accept all pending faction invitations
 *   4. Survey augmentations across joined factions
 *   5. Work for the faction offering the most valuable unowned aug
 *   6. Fall back to training/company work when no faction rep target exists
 *   7. Buy augs in descending price order (most expensive first)
 *   8. Report status - player decides when to install
 *
 * @param {NS} ns
 */

import { find_server_path } from "/modules/utils.js";
import {
  FACTIONS_STATUS_FILE,
  SINGULARITY_BACKDOOR_TARGETS,
  SINGULARITY_COMPANY_TARGETS,
  SINGULARITY_PROGRAM_PURCHASE_ORDER,
  load_config,
} from "/modules/runtime-contracts.js";

const LOOP_MS = 30000;
const STATUS_FILE = FACTIONS_STATUS_FILE;
const COMPANY_FIELDS = [
  "Software",
  "IT",
  "Security Engineer",
  "Network Engineer",
  "Business",
  "Security",
  "Agent",
  "Employee",
];

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (typeof ns.singularity === "undefined") {
    ns.tprint("FACTIONS: Singularity API not available (need Source-File 4). Disabling.");
    return;
  }

  while (true) {
    try {
      const result = await run_cycle(ns);
      await write_status(ns, result);
    } catch (e) {
      ns.print(`FACTIONS: cycle error: ${e}`);
    }
    await ns.sleep(LOOP_MS);
  }
}

async function run_cycle(ns) {
  const cfg = load_config(ns).factions || {};
  const auto_buy = cfg.autoBuy !== false;
  const cash_reserve = Math.max(0, Number(cfg.cashReserve) || 50_000_000);
  const work_focus = String(cfg.workFocus || "hacking");
  const auto_programs = cfg.autoPrograms !== false;
  const program_reserve = Math.max(0, Number(cfg.programReserve) || 1_000_000);
  const auto_backdoor = cfg.autoBackdoor !== false;
  const auto_training = cfg.autoTraining !== false;
  const auto_company = cfg.autoCompany !== false;
  const training_hacking_level = Math.max(1, Number(cfg.trainingHackingLevel) || 50);
  const training_city = String(cfg.trainingCity || "Sector-12");
  const training_university = String(cfg.trainingUniversity || "Rothman University");
  const training_course = String(cfg.trainingCourse || "Algorithms");
  const skip_factions = new Set(cfg.skipFactions || []);
  const joined = new Set();

  let player = ns.getPlayer();
  const program_status = auto_programs
    ? buy_programs(ns, program_reserve)
    : summarize_programs(ns);
  player = ns.getPlayer();

  join_pending_factions(ns, skip_factions, joined);
  player = ns.getPlayer();

  const backdoor_status = auto_backdoor
    ? await run_backdoor_pass(ns, skip_factions)
    : summarize_backdoors(ns, skip_factions);
  join_pending_factions(ns, skip_factions, joined);
  player = ns.getPlayer();

  const current_work = ns.singularity.getCurrentWork();
  const { allAugs, affordable, needRep } = survey_augmentations(ns, player, skip_factions);

  let work_target = null;
  let activity = null;
  let company_target = null;
  let training_target = null;

  if (needRep.length > 0) {
    const target = needRep[0];
    work_target = {
      faction: target.faction,
      aug: target.name,
      repNeeded: target.repReq,
      repCurrent: target.currentRep,
      repRemaining: target.repReq - target.currentRep,
    };
    activity = start_faction_work(ns, target.faction, work_focus, current_work);
  } else if (auto_training && player.skills.hacking < training_hacking_level) {
    training_target = {
      city: training_city,
      university: training_university,
      course: training_course,
      targetHackingLevel: training_hacking_level,
      currentHackingLevel: player.skills.hacking,
    };
    activity = start_training(ns, current_work, training_target);
  } else if (auto_company) {
    const company_result = start_company_work(ns, player, current_work, skip_factions);
    company_target = company_result.target;
    activity = company_result.activity;
  }

  const purchased = [];
  if (auto_buy && affordable.length > 0) {
    for (const aug of affordable) {
      const price = ns.singularity.getAugmentationPrice(aug.name);
      if (ns.getPlayer().money - price < cash_reserve) continue;
      if (ns.singularity.purchaseAugmentation(aug.faction, aug.name)) {
        purchased.push(aug.name);
        ns.tprint(`FACTIONS: Purchased ${aug.name} from ${aug.faction} ($${ns.formatNumber(price)})`);
      }
    }
  }

  player = ns.getPlayer();
  const installed = new Set(ns.singularity.getOwnedAugmentations(false));
  const all_owned = ns.singularity.getOwnedAugmentations(true);
  const pending_install = all_owned.filter((aug) => !installed.has(aug));
  const final_work = ns.singularity.getCurrentWork();

  return {
    joined: Array.from(joined),
    factionCount: player.factions.length,
    totalAugsAvailable: allAugs.length,
    affordableCount: affordable.length,
    needRepCount: needRep.length,
    workTarget: work_target,
    purchased,
    pendingInstall: pending_install.length,
    pendingInstallNames: pending_install.slice(0, 10),
    topAffordable: affordable.slice(0, 5).map((aug) => ({
      name: aug.name,
      faction: aug.faction,
      price: aug.price,
    })),
    topNeedRep: needRep.slice(0, 5).map((aug) => ({
      name: aug.name,
      faction: aug.faction,
      price: aug.price,
      repNeeded: aug.repReq,
      repCurrent: Math.floor(aug.currentRep),
    })),
    tor: program_status.hasTor,
    programsPurchased: program_status.purchased,
    missingPrograms: program_status.missing.slice(0, 10),
    backdoor: backdoor_status,
    companyTarget: company_target,
    trainingTarget: training_target,
    activity: activity || summarize_current_work(final_work),
  };
}

function join_pending_factions(ns, skip_factions, joined) {
  const invites = ns.singularity.checkFactionInvitations();
  for (const faction of invites) {
    if (skip_factions.has(faction)) continue;
    if (ns.singularity.joinFaction(faction)) {
      joined.add(faction);
      ns.tprint(`FACTIONS: Joined ${faction}`);
    }
  }
}

function buy_programs(ns, reserve) {
  const status = summarize_programs(ns);
  if (!status.hasTor && ns.getPlayer().money - 200_000 >= reserve) {
    if (ns.singularity.purchaseTor()) {
      status.hasTor = true;
      status.purchased.push("TOR");
      ns.tprint("FACTIONS: Purchased TOR router");
    }
  }

  const missing = [];
  for (const program of SINGULARITY_PROGRAM_PURCHASE_ORDER) {
    if (ns.fileExists(program, "home")) continue;
    if (!status.hasTor) {
      missing.push(program);
      continue;
    }

    let cost = Infinity;
    try {
      cost = ns.singularity.getDarkwebProgramCost(program);
    } catch {
      missing.push(program);
      continue;
    }

    if (!Number.isFinite(cost) || cost < 0) {
      missing.push(program);
      continue;
    }

    if (ns.getPlayer().money - cost < reserve) {
      missing.push(program);
      continue;
    }

    if (ns.singularity.purchaseProgram(program)) {
      status.purchased.push(program);
      ns.tprint(`FACTIONS: Purchased ${program} ($${ns.formatNumber(cost)})`);
    } else {
      missing.push(program);
    }
  }

  status.missing = missing;
  return status;
}

function summarize_programs(ns) {
  return {
    hasTor: has_tor_router(ns),
    purchased: [],
    missing: SINGULARITY_PROGRAM_PURCHASE_ORDER.filter((program) => !ns.fileExists(program, "home")),
  };
}

function has_tor_router(ns) {
  try {
    if (typeof ns.hasTorRouter === "function") return ns.hasTorRouter();
  } catch {
    // Fall through to player inspection.
  }
  try {
    return Boolean(ns.getPlayer().tor);
  } catch {
    return false;
  }
}

async function run_backdoor_pass(ns, skip_factions) {
  const summary = summarize_backdoors(ns, skip_factions);
  if (!summary.nextEligible) return summary;

  const target = summary.nextEligible;
  const current_server = get_current_server(ns);
  const route_to_target = find_server_path(ns, current_server, target.server);
  const route_home = find_server_path(ns, target.server, "home");
  if (route_to_target.length === 0 || route_home.length === 0) {
    return {
      ...summary,
      error: `route-unavailable:${target.server}`,
    };
  }

  if (ns.singularity.isBusy()) {
    ns.singularity.stopAction();
  }

  if (!connect_path(ns, route_to_target)) {
    connect_path(ns, find_server_path(ns, get_current_server(ns), "home"));
    return {
      ...summary,
      error: `connect-failed:${target.server}`,
    };
  }

  ns.tprint(`FACTIONS: Installing backdoor on ${target.server}`);
  try {
    await ns.singularity.installBackdoor();
  } catch {
    // Re-check installed state below.
  }
  connect_path(ns, route_home);

  const installed = safe_get_server(ns, target.server)?.backdoorInstalled === true;
  if (installed) {
    ns.tprint(`FACTIONS: Backdoored ${target.server}${target.faction ? ` (${target.faction})` : ""}`);
  }

  const updated = summarize_backdoors(ns, skip_factions);
  return {
    ...updated,
    lastInstalled: installed ? target.server : "",
  };
}

function summarize_backdoors(ns, skip_factions) {
  const entries = [];
  for (const target of SINGULARITY_BACKDOOR_TARGETS) {
    if (skip_factions.has(target.faction)) continue;
    const server = safe_get_server(ns, target.server);
    if (!server) continue;

    const ready =
      server.hasAdminRights &&
      ns.getHackingLevel() >= server.requiredHackingSkill &&
      !server.backdoorInstalled;
    entries.push({
      server: target.server,
      faction: target.faction,
      installed: Boolean(server.backdoorInstalled),
      eligible: ready,
      rooted: Boolean(server.hasAdminRights),
      hackingLevel: ns.getHackingLevel(),
      requiredHackingLevel: server.requiredHackingSkill,
    });
  }

  const installed_count = entries.filter((entry) => entry.installed).length;
  const next_eligible = entries.find((entry) => entry.eligible) || null;
  const next_pending = entries.find((entry) => !entry.installed) || null;
  return {
    installed: installed_count,
    total: entries.length,
    remaining: entries.length - installed_count,
    nextEligible: next_eligible ? {
      server: next_eligible.server,
      faction: next_eligible.faction,
      requiredHackingLevel: next_eligible.requiredHackingLevel,
    } : null,
    nextPending: next_pending ? {
      server: next_pending.server,
      faction: next_pending.faction,
      rooted: next_pending.rooted,
      requiredHackingLevel: next_pending.requiredHackingLevel,
    } : null,
  };
}

function survey_augmentations(ns, player, skip_factions) {
  const owned = new Set(ns.singularity.getOwnedAugmentations(true));
  const aug_map = new Map();

  for (const faction of player.factions) {
    if (skip_factions.has(faction)) continue;

    const rep = ns.singularity.getFactionRep(faction);
    let faction_augs = [];
    try {
      faction_augs = ns.singularity.getAugmentationsFromFaction(faction);
    } catch {
      continue;
    }

    for (const aug of faction_augs) {
      if (owned.has(aug) || aug === "NeuroFlux Governor") continue;

      const price = ns.singularity.getAugmentationPrice(aug);
      const repReq = ns.singularity.getAugmentationRepReq(aug);
      const existing = aug_map.get(aug);
      if (!existing || rep > existing.currentRep) {
        aug_map.set(aug, {
          name: aug,
          faction,
          price,
          repReq,
          currentRep: rep,
          affordable: rep >= repReq,
        });
      }
    }
  }

  const allAugs = [...aug_map.values()];
  return {
    allAugs,
    affordable: allAugs
      .filter((aug) => aug.affordable)
      .sort((left, right) => right.price - left.price),
    needRep: allAugs
      .filter((aug) => !aug.affordable)
      .sort((left, right) => right.price - left.price),
  };
}

function start_faction_work(ns, faction, preferred_type, current_work) {
  if (current_work && current_work.type === "FACTION" && current_work.factionName === faction) {
    return {
      type: "faction",
      target: faction,
      detail: String(current_work.factionWorkType || preferred_type || ""),
    };
  }

  const types = [preferred_type, "hacking", "field", "security"].filter(
    (value, index, arr) => value && arr.indexOf(value) === index
  );
  for (const type of types) {
    try {
      if (ns.singularity.workForFaction(faction, type)) {
        ns.tprint(`FACTIONS: Working for ${faction} (${type})`);
        return {
          type: "faction",
          target: faction,
          detail: type,
        };
      }
    } catch {
      // Not all factions support all work types.
    }
  }
  return summarize_current_work(ns.singularity.getCurrentWork());
}

function start_training(ns, current_work, target) {
  if (
    current_work &&
    current_work.type === "CLASS" &&
    String(current_work.location || "") === target.university &&
    String(current_work.classType || "") === target.course
  ) {
    return {
      type: "training",
      target: target.university,
      detail: `${target.course} @ ${target.city}`,
    };
  }

  if (!ensure_city(ns, target.city)) {
    return {
      type: "training",
      target: target.university,
      detail: `travel-blocked:${target.city}`,
    };
  }

  if (ns.singularity.universityCourse(target.university, target.course, false)) {
    ns.tprint(`FACTIONS: Training hacking at ${target.university} (${target.course})`);
    return {
      type: "training",
      target: target.university,
      detail: `${target.course} @ ${target.city}`,
    };
  }

  return summarize_current_work(ns.singularity.getCurrentWork()) || {
    type: "training",
    target: target.university,
    detail: `blocked:${target.course}`,
  };
}

function start_company_work(ns, player, current_work, skip_factions) {
  if (current_work && current_work.type === "COMPANY") {
    const current = SINGULARITY_COMPANY_TARGETS.find((entry) => entry.company === current_work.companyName);
    if (current && !skip_factions.has(current.faction) && !player.factions.includes(current.faction)) {
      return {
        target: {
          company: current.company,
          faction: current.faction,
          city: current.city,
          employed: has_company_job(player, current.company),
        },
        activity: {
          type: "company",
          target: current.company,
          detail: `rep-for:${current.faction}`,
        },
      };
    }
  }

  const candidate = pick_company_target(player, skip_factions);
  if (!candidate) {
    return { target: null, activity: summarize_current_work(ns.singularity.getCurrentWork()) };
  }

  const employed = has_company_job(player, candidate.company);
  if (!employed && !ensure_city(ns, candidate.city)) {
    return {
      target: {
        company: candidate.company,
        faction: candidate.faction,
        city: candidate.city,
        employed: false,
      },
      activity: {
        type: "company",
        target: candidate.company,
        detail: `travel-blocked:${candidate.city}`,
      },
    };
  }

  const hired = employed || apply_to_company(ns, candidate.company);
  if (!hired) {
    return {
      target: {
        company: candidate.company,
        faction: candidate.faction,
        city: candidate.city,
        employed: false,
      },
      activity: {
        type: "company",
        target: candidate.company,
        detail: `awaiting-hire:${candidate.faction}`,
      },
    };
  }

  if (ns.singularity.workForCompany(candidate.company, false)) {
    ns.tprint(`FACTIONS: Working for ${candidate.company} (${candidate.faction})`);
    return {
      target: {
        company: candidate.company,
        faction: candidate.faction,
        city: candidate.city,
        employed: true,
      },
      activity: {
        type: "company",
        target: candidate.company,
        detail: `rep-for:${candidate.faction}`,
      },
    };
  }

  return {
    target: {
      company: candidate.company,
      faction: candidate.faction,
      city: candidate.city,
      employed: hired,
    },
    activity: summarize_current_work(ns.singularity.getCurrentWork()) || {
      type: "company",
      target: candidate.company,
      detail: `blocked:${candidate.faction}`,
    },
  };
}

function pick_company_target(player, skip_factions) {
  const current_city = String(player.city || "");
  const active_jobs = SINGULARITY_COMPANY_TARGETS.filter(
    (entry) =>
      !skip_factions.has(entry.faction) &&
      !player.factions.includes(entry.faction) &&
      has_company_job(player, entry.company)
  );
  if (active_jobs.length > 0) return active_jobs[0];

  const available = SINGULARITY_COMPANY_TARGETS.filter(
    (entry) => !skip_factions.has(entry.faction) && !player.factions.includes(entry.faction)
  );
  if (available.length === 0) return null;

  const same_city = available.find((entry) => entry.city === current_city);
  return same_city || available[0];
}

function has_company_job(player, company) {
  return Boolean(player.jobs && player.jobs[company]);
}

function apply_to_company(ns, company) {
  for (const field of COMPANY_FIELDS) {
    try {
      if (ns.singularity.applyToCompany(company, field)) {
        return true;
      }
    } catch {
      // Keep trying the next field.
    }
  }
  return false;
}

function ensure_city(ns, city) {
  const current_city = String(ns.getPlayer().city || "");
  if (!city || current_city === city) return true;
  try {
    return ns.singularity.travelToCity(city);
  } catch {
    return false;
  }
}

function summarize_current_work(current_work) {
  if (!current_work) return null;
  if (current_work.type === "FACTION") {
    return {
      type: "faction",
      target: String(current_work.factionName || ""),
      detail: String(current_work.factionWorkType || ""),
    };
  }
  if (current_work.type === "COMPANY") {
    return {
      type: "company",
      target: String(current_work.companyName || ""),
      detail: String(current_work.companyPositionName || ""),
    };
  }
  if (current_work.type === "CLASS") {
    return {
      type: "training",
      target: String(current_work.location || ""),
      detail: String(current_work.classType || ""),
    };
  }
  return {
    type: String(current_work.type || "busy").toLowerCase(),
    target: "",
    detail: "",
  };
}

function connect_path(ns, path) {
  if (!Array.isArray(path) || path.length === 0) return false;
  for (let i = 1; i < path.length; i++) {
    if (!ns.singularity.connect(path[i])) {
      return false;
    }
  }
  return true;
}

function get_current_server(ns) {
  try {
    return String(ns.singularity.getCurrentServer() || "home");
  } catch {
    return "home";
  }
}

function safe_get_server(ns, hostname) {
  try {
    if (!ns.serverExists(hostname)) return null;
    return ns.getServer(hostname);
  } catch {
    return null;
  }
}

async function write_status(ns, result) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...result,
  }, null, 2);
  await ns.write(STATUS_FILE, payload, "w");
}
