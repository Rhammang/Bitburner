/** @param {NS} ns
 *  ═══════════════════════════════════════════════════════════════════
 *  Bitburner DAEMON v5.1 — Manager-based Architecture
 *  ═══════════════════════════════════════════════════════════════════
 *  Usage: run daemon.js
 *
 *  This script is the entry point. It ensures that all core modules
 *  are running. The primary logic is now in /modules/manager.js.
 *  ═══════════════════════════════════════════════════════════════════
 */

const MODULES_DIR = "/modules/";
const DATA_DIR = "/data/";
const MODULE_STATUS_FILE = DATA_DIR + "module_status.json";
const DISABLED_PREFIX = DATA_DIR + "disabled_";
const LOOP_MS = 5000;
const WARN_THROTTLE_MS = 60000;

// A lean list of core modules. The manager will handle hack-related scripts.
const CORE_MODULES = [
  { file: "root.js", desc: "Root Access Manager", interval: 5000, bootCritical: true },
  { file: "manager.js", desc: "Main Logic Controller", interval: 3000, bootCritical: true },
  { file: "hud.js", desc: "Runtime HUD", interval: 10000, bootCritical: false },
  { file: "buy-servers.js", desc: "Server Purchase Manager", interval: 20000, bootCritical: false },
  { file: "contracts.js", desc: "Contract Solver", interval: 60000, bootCritical: false },
];

const LITE_BOOT_MODULES = [
  { file: "root-lite.js", desc: "Root Bootstrap", interval: 8000, protects: "root.js" },
  { file: "deploy-lite.js", desc: "Deploy Bootstrap", interval: 10000, protects: "manager.js" },
];

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tprint("DAEMON v5.1: Starting up...");

  // Write the essential worker scripts to disk.
  writeWorkerScripts(ns);
  clear_disabled_flags(ns);

  const last_run = {};
  const last_lite_run = {};
  const last_warn = {};
  const status = {};
  const boot = { rootReady: false, managerReady: false };

  for (const mod of CORE_MODULES) {
    last_run[mod.file] = 0;
    status[mod.file] = { state: "init" };
  }
  for (const lite of LITE_BOOT_MODULES) {
    last_lite_run[lite.file] = 0;
    status[lite.file] = { state: "init" };
  }

  while (true) {
    const now = Date.now();
    const boot_complete = boot.rootReady && boot.managerReady;

    if (!boot_complete) {
      run_lite_boot_modules(ns, now, last_lite_run, last_warn, status, boot);
    } else {
      for (const lite of LITE_BOOT_MODULES) {
        if (status[lite.file]?.state !== "standby") {
          status[lite.file] = { state: "standby" };
        }
      }
    }

    for (const mod of CORE_MODULES) {
      if (now - last_run[mod.file] < mod.interval) continue;
      last_run[mod.file] = now;

      const scriptPath = MODULES_DIR + mod.file;
      const flag = ns.read(DISABLED_PREFIX + mod.file);
      if (flag && flag.trim() === "true") {
        status[mod.file] = { state: "disabled" };
        continue;
      }

      if (!ns.fileExists(scriptPath)) {
        status[mod.file] = { state: "missing" };
        warn_throttled(
          ns,
          last_warn,
          `missing:${mod.file}`,
          `WARN: Core module ${scriptPath} not found!`,
          now
        );
        continue;
      }

      if (!ns.isRunning(scriptPath, "home")) {
        const script_ram = ns.getScriptRam(scriptPath, "home");
        const free_ram = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

        if (!mod.bootCritical) {
          const boot_reserve = get_boot_reserve(ns, boot);
          if (free_ram - script_ram < boot_reserve) {
            status[mod.file] = {
              state: "ram-blocked",
              freeRam: free_ram,
              neededRam: script_ram,
              bootReserve: boot_reserve,
            };
            continue;
          }
        }

        if (free_ram < script_ram) {
          status[mod.file] = {
            state: "ram-blocked",
            freeRam: free_ram,
            neededRam: script_ram,
          };
          continue;
        }

        const pid = ns.exec(scriptPath, "home", 1);
        if (pid > 0) {
          ns.tprint(`SUCCESS: Launched ${mod.desc} (${mod.file})`);
          status[mod.file] = { state: "ok", pid };

          if (mod.file === "root.js") boot.rootReady = true;
          if (mod.file === "manager.js") boot.managerReady = true;
        } else {
          warn_throttled(
            ns,
            last_warn,
            `exec-failed:${mod.file}`,
            `ERROR: Failed to launch ${mod.file}. Not enough RAM?`,
            now
          );
          status[mod.file] = { state: "exec-failed" };
        }
      } else {
        status[mod.file] = { state: "running" };

        if (mod.file === "root.js") boot.rootReady = true;
        if (mod.file === "manager.js") boot.managerReady = true;
      }
    }

    await ns.write(
      MODULE_STATUS_FILE,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          boot,
          modules: status,
        },
        null,
        2
      ),
      "w"
    );

    await ns.sleep(LOOP_MS);
  }
}

/**
 * Writes the basic one-shot and loop worker scripts to disk.
 * These are used by the prepper and batcher modules.
 * @param {NS} ns
 */
function writeWorkerScripts(ns) {
  // Loop workers for prepping
  ns.write("/w-weak.js", "export async function main(ns) { while (true) { await ns.weaken(ns.args[0]); } }", "w");
  ns.write("/w-grow.js", "export async function main(ns) { while (true) { await ns.grow(ns.args[0]); } }", "w");
  ns.write("/w-hack.js", "export async function main(ns) { while (true) { await ns.hack(ns.args[0]); } }", "w");

  // Batch workers (one-shot)
  ns.write("/b-hack.js", "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.hack(ns.args[0]); }", "w");
  ns.write("/b-grow.js", "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.grow(ns.args[0]); }", "w");
  ns.write("/b-weak.js", "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.weaken(ns.args[0]); }", "w");
}

function clear_disabled_flags(ns) {
  for (const file of ns.ls("home", DISABLED_PREFIX)) {
    ns.rm(file, "home");
  }
}

function get_boot_reserve(ns, boot) {
  let reserve = 1;
  if (!boot.rootReady && ns.fileExists(MODULES_DIR + "root.js", "home")) {
    reserve += ns.getScriptRam(MODULES_DIR + "root.js", "home");
  }
  if (!boot.managerReady && ns.fileExists(MODULES_DIR + "manager.js", "home")) {
    reserve += ns.getScriptRam(MODULES_DIR + "manager.js", "home");
  }
  return reserve;
}

function run_lite_boot_modules(ns, now, last_lite_run, last_warn, status, boot) {
  for (const lite of LITE_BOOT_MODULES) {
    const protecting_root = lite.protects === "root.js";
    const protecting_manager = lite.protects === "manager.js";

    if (protecting_root && boot.rootReady) continue;
    if (protecting_manager && boot.managerReady) continue;
    if (now - last_lite_run[lite.file] < lite.interval) continue;
    last_lite_run[lite.file] = now;

    const lite_path = MODULES_DIR + lite.file;
    if (!ns.fileExists(lite_path, "home")) {
      status[lite.file] = { state: "missing" };
      continue;
    }

    if (ns.isRunning(lite_path, "home")) {
      status[lite.file] = { state: "running" };
      continue;
    }

    const script_ram = ns.getScriptRam(lite_path, "home");
    const free_ram = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    if (free_ram < script_ram) {
      status[lite.file] = { state: "ram-blocked", freeRam: free_ram, neededRam: script_ram };
      continue;
    }

    const pid = ns.exec(lite_path, "home", 1);
    if (pid > 0) {
      status[lite.file] = { state: "ok", pid };
      ns.tprint(`BOOT: Launched ${lite.desc} (${lite.file})`);
    } else {
      status[lite.file] = { state: "exec-failed" };
      warn_throttled(
        ns,
        last_warn,
        `lite-exec:${lite.file}`,
        `WARN: Failed to launch ${lite.file}`,
        now
      );
    }
  }
}

function warn_throttled(ns, last_warn, key, message, now) {
  if (!last_warn[key] || now - last_warn[key] >= WARN_THROTTLE_MS) {
    ns.tprint(message);
    last_warn[key] = now;
  }
}
