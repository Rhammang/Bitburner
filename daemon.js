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

import {
  CORE_MODULES,
  DISABLED_PREFIX,
  LITE_BOOT_MODULES,
  MANAGER_MODULE_FILE,
  MODULE_FILES,
  MODULES_DIR,
  MODULE_STATUS_FILE,
  ROOT_MODULE_FILE,
  WORKER_SOURCES,
  load_config,
} from "/modules/runtime-contracts.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tprint("DAEMON v5.1: Starting up...");

  const cfg = load_config(ns).daemon;
  const LOOP_MS = cfg.loopMs;
  const WARN_THROTTLE_MS = cfg.warnThrottleMs;

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
      run_lite_boot_modules(ns, now, last_lite_run, last_warn, status, boot, WARN_THROTTLE_MS);
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
          now,
          WARN_THROTTLE_MS
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

          if (mod.file === MODULE_FILES.ROOT) boot.rootReady = true;
          if (mod.file === MODULE_FILES.MANAGER) boot.managerReady = true;
        } else {
          warn_throttled(
            ns,
            last_warn,
            `exec-failed:${mod.file}`,
            `ERROR: Failed to launch ${mod.file}. Not enough RAM?`,
            now,
            WARN_THROTTLE_MS
          );
          status[mod.file] = { state: "exec-failed" };
        }
      } else {
        status[mod.file] = { state: "running" };

        if (mod.file === MODULE_FILES.ROOT) boot.rootReady = true;
        if (mod.file === MODULE_FILES.MANAGER) boot.managerReady = true;
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
  for (const [script, source] of Object.entries(WORKER_SOURCES)) {
    ns.write(script, source, "w");
  }
}

function clear_disabled_flags(ns) {
  for (const file of ns.ls("home", DISABLED_PREFIX)) {
    ns.rm(file, "home");
  }
}

function get_boot_reserve(ns, boot) {
  let reserve = 1;
  if (!boot.rootReady && ns.fileExists(ROOT_MODULE_FILE, "home")) {
    reserve += ns.getScriptRam(ROOT_MODULE_FILE, "home");
  }
  if (!boot.managerReady && ns.fileExists(MANAGER_MODULE_FILE, "home")) {
    reserve += ns.getScriptRam(MANAGER_MODULE_FILE, "home");
  }
  return reserve;
}

function run_lite_boot_modules(ns, now, last_lite_run, last_warn, status, boot, WARN_THROTTLE_MS) {
  for (const lite of LITE_BOOT_MODULES) {
    const protecting_root = lite.protects === MODULE_FILES.ROOT;
    const protecting_manager = lite.protects === MODULE_FILES.MANAGER;

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
        now,
        WARN_THROTTLE_MS
      );
    }
  }
}

function warn_throttled(ns, last_warn, key, message, now, throttle_ms) {
  if (!last_warn[key] || now - last_warn[key] >= throttle_ms) {
    ns.tprint(message);
    last_warn[key] = now;
  }
}
