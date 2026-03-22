/**
 * Factions & augmentation automation module.
 * Requires Source-File 4 (Singularity API).
 *
 * Strategy:
 *   1. Accept all pending faction invitations
 *   2. Survey available augmentations across joined factions
 *   3. Work for the faction offering the most valuable unowned aug
 *   4. Buy augs in descending price order (most expensive first to
 *      minimize compounding 1.9x price multiplier)
 *   5. Report status — player decides when to install
 *
 * @param {NS} ns
 */

import {
  FACTIONS_STATUS_FILE,
  load_config,
} from "/modules/runtime-contracts.js";

const LOOP_MS = 30000;
const STATUS_FILE = FACTIONS_STATUS_FILE;

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Verify singularity API access
  if (typeof ns.singularity === "undefined") {
    ns.tprint("FACTIONS: Singularity API not available (need Source-File 4). Disabling.");
    return;
  }

  while (true) {
    try {
      const result = run_cycle(ns);
      await write_status(ns, result);
    } catch (e) {
      ns.print(`FACTIONS: cycle error: ${e}`);
    }
    await ns.sleep(LOOP_MS);
  }
}

function run_cycle(ns) {
  const cfg = load_config(ns).factions || {};
  const auto_buy = cfg.autoBuy !== false;
  const cash_reserve = cfg.cashReserve || 50_000_000;
  const work_focus = cfg.workFocus || "hacking"; // hacking | field | security
  const skip_factions = new Set(cfg.skipFactions || []);

  // 1. Accept pending invitations
  const invites = ns.singularity.checkFactionInvitations();
  const joined = [];
  for (const faction of invites) {
    if (skip_factions.has(faction)) continue;
    if (ns.singularity.joinFaction(faction)) {
      joined.push(faction);
      ns.tprint(`FACTIONS: Joined ${faction}`);
    }
  }

  // 2. Survey augmentations across all joined factions
  const player = ns.getPlayer();
  const owned = new Set(ns.singularity.getOwnedAugmentations(true));
  const aug_map = new Map(); // augName -> { name, faction, price, repReq, currentRep, affordable }

  for (const faction of player.factions) {
    if (skip_factions.has(faction)) continue;
    const rep = ns.singularity.getFactionRep(faction);
    let faction_augs;
    try {
      faction_augs = ns.singularity.getAugmentationsFromFaction(faction);
    } catch { continue; }

    for (const aug of faction_augs) {
      if (owned.has(aug)) continue;
      if (aug === "NeuroFlux Governor") continue; // handle separately

      const price = ns.singularity.getAugmentationPrice(aug);
      const repReq = ns.singularity.getAugmentationRepReq(aug);
      const existing = aug_map.get(aug);

      // Keep the version from the faction where we have the most rep
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

  const all_augs = [...aug_map.values()];
  const affordable = all_augs.filter((a) => a.affordable).sort((a, b) => b.price - a.price);
  const need_rep = all_augs.filter((a) => !a.affordable).sort((a, b) => b.price - a.price);

  // 3. Work for faction with highest-value unaffordable aug
  let work_target = null;
  const current_work = ns.singularity.getCurrentWork();
  const is_faction_work = current_work && current_work.type === "FACTION";

  if (need_rep.length > 0) {
    const target = need_rep[0];
    work_target = {
      faction: target.faction,
      aug: target.name,
      repNeeded: target.repReq,
      repCurrent: target.currentRep,
      repRemaining: target.repReq - target.currentRep,
    };

    // Start working if not already working for this faction
    if (!is_faction_work || current_work.factionName !== target.faction) {
      start_faction_work(ns, target.faction, work_focus);
    }
  }

  // 4. Buy augmentations (most expensive first)
  const purchased = [];
  if (auto_buy && affordable.length > 0) {
    for (const aug of affordable) {
      const price = ns.singularity.getAugmentationPrice(aug.name);
      if (player.money - price < cash_reserve) continue;

      if (ns.singularity.purchaseAugmentation(aug.faction, aug.name)) {
        purchased.push(aug.name);
        ns.tprint(`FACTIONS: Purchased ${aug.name} from ${aug.faction} ($${ns.formatNumber(price)})`);
        // Re-read money after purchase (prices compound 1.9x)
        player.money = ns.getPlayer().money;
      }
    }
  }

  // 5. Count purchased-but-not-installed
  const installed = new Set(ns.singularity.getOwnedAugmentations(false));
  const all_owned = ns.singularity.getOwnedAugmentations(true);
  const pending_install = all_owned.filter((a) => !installed.has(a));

  return {
    joined,
    factionCount: player.factions.length,
    totalAugsAvailable: all_augs.length,
    affordableCount: affordable.length,
    needRepCount: need_rep.length,
    workTarget: work_target,
    purchased,
    pendingInstall: pending_install.length,
    pendingInstallNames: pending_install.slice(0, 10),
    topAffordable: affordable.slice(0, 5).map((a) => ({ name: a.name, faction: a.faction, price: a.price })),
    topNeedRep: need_rep.slice(0, 5).map((a) => ({
      name: a.name,
      faction: a.faction,
      price: a.price,
      repNeeded: a.repReq,
      repCurrent: Math.floor(a.currentRep),
    })),
  };
}

function start_faction_work(ns, faction, preferred_type) {
  // Try preferred type first, then fallback chain
  const types = [preferred_type, "hacking", "field", "security"].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  for (const type of types) {
    try {
      if (ns.singularity.workForFaction(faction, type)) {
        ns.tprint(`FACTIONS: Working for ${faction} (${type})`);
        return;
      }
    } catch { /* type not available for this faction */ }
  }
}

async function write_status(ns, result) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...result,
  }, null, 2);
  await ns.write(STATUS_FILE, payload, "w");
}
