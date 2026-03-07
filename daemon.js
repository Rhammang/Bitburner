/** @param {NS} ns
 *  ═══════════════════════════════════════════════════════════════════
 *  Bitburner DAEMON v4.1 — Hybrid Hack + HWGW Batch
 *  ═══════════════════════════════════════════════════════════════════
 *  Architecture:
 *    Phase 1 (immediate): Loop workers hack/grow/weaken for income
 *    Phase 2 (prepped):   HWGW batches replace loop workers
 *
 *  Money flows from minute 1. Batches take over as targets get prepped.
 *
 *  Usage: run daemon.js
 *  ═══════════════════════════════════════════════════════════════════
 */

var MODULES_DIR = "/modules/";
var DATA_DIR = "/data/";

var MODULES = [
  { file: "root.js",        interval: 10000,  desc: "Root servers" },
  { file: "deploy.js",      interval: 15000,  desc: "Deploy workers" },
  { file: "batch.js",       interval: 5000,   desc: "HWGW batches" },
  { file: "programs.js",    interval: 30000,  desc: "Buy programs" },
  { file: "buy-servers.js", interval: 20000,  desc: "Buy servers" },
  { file: "hacknet.js",     interval: 30000,  desc: "Hacknet" },
  { file: "factions.js",    interval: 30000,  desc: "Factions" },
  { file: "augs.js",        interval: 30000,  desc: "Buy augs" },
  { file: "aug-install.js", interval: 60000,  desc: "Aug install" },
  { file: "backdoor.js",    interval: 60000,  desc: "Backdoors" },
  { file: "contracts.js",   interval: 60000,  desc: "Contracts" },
  { file: "stocks.js",      interval: 60000,  desc: "Stocks" },
  { file: "gang.js",        interval: 20000,  desc: "Gang" },
  { file: "sleeves.js",     interval: 30000,  desc: "Sleeves" },
  { file: "travel.js",      interval: 60000,  desc: "Travel" },
];

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  await writeAllModules(ns);
  await writeWorkerScripts(ns);
  await ns.write(DATA_DIR + "servers.txt", "[]", "w");
  await ns.write(DATA_DIR + "rooted.txt", "[]", "w");
  await ns.write(DATA_DIR + "targets.txt", "[]", "w");
  await ns.write(DATA_DIR + "prepped.txt", "[]", "w");
  await ns.write(DATA_DIR + "stocks_status.txt", "waiting-tix", "w");
  await ns.write(DATA_DIR + "module_status.json", JSON.stringify({
    root: { state: "init" },
    deploy: { state: "init" },
    stocks: { state: "init" }
  }, null, 2), "w");

  for (var m of MODULES) {
    ns.rm(DATA_DIR + "disabled_" + m.file);
  }

  var disabled = new Set();
  var lastRun = {};
  for (var m of MODULES) lastRun[m.file] = 0;
  var liteLastRun = { "root-lite.js": 0, "deploy-lite.js": 0 };
  var bootState = { rootReady: false, deployReady: false };
  var moduleStatus = {
    root: { state: "init" },
    deploy: { state: "init" },
    stocks: { state: "init" }
  };

  ns.tprint("═══════════════════════════════════════════════");
  ns.tprint("  DAEMON v4.1 — Hybrid Hack + HWGW Batch");
  ns.tprint("═══════════════════════════════════════════════");

  while (true) {
    var now = Date.now();
    var rootedCount = 0;
    try { rootedCount = JSON.parse(ns.read(DATA_DIR + "rooted.txt")).length; } catch(e) {}

    for (var m of MODULES) {
      if (!disabled.has(m.file)) {
        var flag = ns.read(DATA_DIR + "disabled_" + m.file);
        if (flag && flag.trim() === "true") {
          disabled.add(m.file);
          ns.tprint("DISABLED " + m.desc + " — missing required API");
          if (m.file === "root.js") moduleStatus.root = { state: "disabled" };
          if (m.file === "deploy.js") moduleStatus.deploy = { state: "disabled" };
          if (m.file === "stocks.js") moduleStatus.stocks = { state: "disabled" };
        }
      }
    }

    if (!disabled.has("root.js") && bootState.rootReady) {
      moduleStatus.root = { state: "ok" };
    }
    if (!disabled.has("deploy.js")) {
      if (rootedCount === 0) moduleStatus.deploy = { state: "no-targets" };
      else if (bootState.deployReady) moduleStatus.deploy = { state: "ok" };
    }

    var rootRam = ns.getScriptRam(MODULES_DIR + "root.js", "home");
    var deployRam = ns.getScriptRam(MODULES_DIR + "deploy.js", "home");
    var bootComplete = bootState.rootReady && bootState.deployReady;
    var bootReserve = bootComplete ? 0 : (rootRam + deployRam + 1);

    if (!bootComplete) {
      if (!bootState.rootReady && now - liteLastRun["root-lite.js"] >= 8000) {
        var rootLitePath = MODULES_DIR + "root-lite.js";
        if (!ns.isRunning(rootLitePath, "home")) {
          var rootLiteRam = ns.getScriptRam(rootLitePath, "home");
          var rootLiteFree = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
          if (rootLiteFree >= rootLiteRam) {
            var rootLitePid = ns.exec(rootLitePath, "home", 1);
            if (rootLitePid > 0) liteLastRun["root-lite.js"] = now;
          } else {
            moduleStatus.root = { state: "ram-blocked", freeRam: rootLiteFree, neededRam: rootLiteRam };
          }
        }
      }
      if (!bootState.deployReady && now - liteLastRun["deploy-lite.js"] >= 10000) {
        if (rootedCount === 0) {
          moduleStatus.deploy = { state: "no-targets" };
        } else {
          var deployLitePath = MODULES_DIR + "deploy-lite.js";
          if (!ns.isRunning(deployLitePath, "home")) {
            var deployLiteRam = ns.getScriptRam(deployLitePath, "home");
            var deployLiteFree = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
            if (deployLiteFree >= deployLiteRam) {
              var deployLitePid = ns.exec(deployLitePath, "home", 1);
              if (deployLitePid > 0) liteLastRun["deploy-lite.js"] = now;
            } else {
              moduleStatus.deploy = { state: "ram-blocked", freeRam: deployLiteFree, neededRam: deployLiteRam };
            }
          }
        }
      }
    }

    for (var i = 0; i < MODULES.length; i++) {
      var mod = MODULES[i];
      var tracked = mod.file === "root.js" ? "root" : (mod.file === "deploy.js" ? "deploy" : (mod.file === "stocks.js" ? "stocks" : null));
      if (disabled.has(mod.file)) continue;
      if (now - lastRun[mod.file] < mod.interval) continue;
      var scriptPath = MODULES_DIR + mod.file;
      if (ns.isRunning(scriptPath, "home")) {
        if (tracked) moduleStatus[tracked] = { state: "running" };
        continue;
      }
      var scriptRam = ns.getScriptRam(scriptPath, "home");
      var freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      if (mod.file === "deploy.js" && rootedCount === 0) {
        moduleStatus.deploy = { state: "no-targets", freeRam: freeRam, neededRam: scriptRam };
        lastRun[mod.file] = now;
        continue;
      }
      if (!bootComplete && mod.file !== "root.js" && mod.file !== "deploy.js") {
        if (freeRam - scriptRam < bootReserve) continue;
      }
      if (freeRam < scriptRam) {
        if (tracked) moduleStatus[tracked] = { state: "ram-blocked", freeRam: freeRam, neededRam: scriptRam };
        continue;
      }
      var pid = ns.exec(scriptPath, "home", 1);
      if (pid > 0) {
        lastRun[mod.file] = now;
        if (mod.file === "root.js") bootState.rootReady = true;
        if (mod.file === "deploy.js") bootState.deployReady = true;
        if (tracked) moduleStatus[tracked] = { state: "ok" };
      } else if (tracked) {
        moduleStatus[tracked] = { state: "exec-failed", freeRam: freeRam, neededRam: scriptRam };
      }
    }

    await ns.write(DATA_DIR + "module_status.json", JSON.stringify({
      timestamp: now,
      boot: { rootReady: bootState.rootReady, deployReady: bootState.deployReady },
      root: moduleStatus.root,
      deploy: moduleStatus.deploy,
      stocks: moduleStatus.stocks
    }, null, 2), "w");

    printStatus(ns, disabled, moduleStatus, bootState);
    await ns.sleep(5000);
  }
}

function printStatus(ns, disabled, moduleStatus, bootState) {
  ns.clearLog();
  ns.print("════════════════════════════════════════════");
  ns.print("      D A E M O N  v4.1 — Hybrid+HWGW     ");
  ns.print("════════════════════════════════════════════");
  ns.print(" Hack Level : " + ns.getHackingLevel());
  ns.print(" Money      : $" + ns.formatNumber(ns.getServerMoneyAvailable("home")));
  ns.print(" RAM        : " + ns.formatRam(ns.getServerMaxRam("home") - ns.getServerUsedRam("home")) + " free / " + ns.formatRam(ns.getServerMaxRam("home")));
  ns.print("────────────────────────────────────────────");
  var active = 0;
  for (var m of MODULES) { if (!disabled.has(m.file)) active++; }
  ns.print(" Modules    : " + active + "/" + MODULES.length + " active");
  if (disabled.size > 0) {
    var names = [];
    for (var f of disabled) names.push(f.replace(".js", ""));
    ns.print(" Disabled   : " + names.join(", "));
  }
  var rootState = moduleStatus && moduleStatus.root ? moduleStatus.root.state : "unknown";
  var deployState = moduleStatus && moduleStatus.deploy ? moduleStatus.deploy.state : "unknown";
  ns.print(" Root/Deploy: " + rootState + " / " + deployState);
  var stocksState = "unknown";
  try {
    var rawStocks = ns.read("/data/stocks_status.txt");
    if (rawStocks) stocksState = rawStocks.trim() || "unknown";
  } catch(e) {}
  ns.print(" Stocks     : " + stocksState);
  ns.print("────────────────────────────────────────────");
  // Count workers
  var rooted = [];
  try { rooted = JSON.parse(ns.read("/data/rooted.txt")); } catch(e) {}
  var allHosts = ["home"].concat(ns.getPurchasedServers(), rooted);
  var loopTargets = {};
  var batchTargets = {};
  var totalLoop = 0;
  var totalBatch = 0;
  for (var h of allHosts) {
    try {
      var procs = ns.ps(h);
      for (var p of procs) {
        if (p.filename === "/w-hack.js" || p.filename === "/w-weak.js" || p.filename === "/w-grow.js") {
          var t = p.args[0] || "?";
          loopTargets[t] = (loopTargets[t] || 0) + p.threads;
          totalLoop += p.threads;
        }
        if (p.filename === "/b-hack.js" || p.filename === "/b-weak.js" || p.filename === "/b-grow.js") {
          var t = p.args[0] || "?";
          batchTargets[t] = (batchTargets[t] || 0) + p.threads;
          totalBatch += p.threads;
        }
      }
    } catch(e) {}
  }
  if (totalLoop > 0) {
    ns.print(" Loop Workers: " + totalLoop + " threads");
    for (var t in loopTargets) ns.print("   LOOP " + t + ": " + loopTargets[t] + "t");
  }
  if (totalBatch > 0) {
    ns.print(" Batches     : " + totalBatch + " threads");
    for (var t in batchTargets) ns.print("   HWGW " + t + ": " + batchTargets[t] + "t");
  }
  if (totalLoop === 0 && totalBatch === 0) {
    var block = null;
    if (moduleStatus && moduleStatus.root && moduleStatus.root.state === "ram-blocked") block = moduleStatus.root;
    if (moduleStatus && moduleStatus.deploy && moduleStatus.deploy.state === "ram-blocked") block = moduleStatus.deploy;
    if (block && typeof block.freeRam === "number" && typeof block.neededRam === "number") {
      ns.print(" Workers    : RAM blocked (root/deploy) " + ns.formatRam(block.freeRam) + " free / " + ns.formatRam(block.neededRam) + " needed");
    } else if (moduleStatus && moduleStatus.deploy && moduleStatus.deploy.state === "no-targets") {
      ns.print(" Workers    : No rooted targets yet");
    } else if (bootState && (!bootState.rootReady || !bootState.deployReady)) {
      ns.print(" Workers    : Bootstrapping root/deploy");
    } else {
      ns.print(" Workers    : Idle (see module status)");
    }
  }
  ns.print("════════════════════════════════════════════");
}

// ──────────────────── WORKER SCRIPTS ────────────────────────────────

function writeWorkerScripts(ns) {
  // Loop workers for immediate income
  ns.write("/w-weak.js", [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  while (true) { await ns.weaken(ns.args[0]); }",
    "}"
  ].join("\n"), "w");

  ns.write("/w-grow.js", [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  while (true) { await ns.grow(ns.args[0]); }",
    "}"
  ].join("\n"), "w");

  ns.write("/w-hack.js", [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  while (true) { await ns.hack(ns.args[0]); }",
    "}"
  ].join("\n"), "w");

  // Batch workers — one-shot with delay for HWGW timing
  ns.write("/b-hack.js", [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  if (ns.args[1] > 0) await ns.sleep(ns.args[1]);",
    "  await ns.hack(ns.args[0]);",
    "}"
  ].join("\n"), "w");

  ns.write("/b-grow.js", [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  if (ns.args[1] > 0) await ns.sleep(ns.args[1]);",
    "  await ns.grow(ns.args[0]);",
    "}"
  ].join("\n"), "w");

  ns.write("/b-weak.js", [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  if (ns.args[1] > 0) await ns.sleep(ns.args[1]);",
    "  await ns.weaken(ns.args[0]);",
    "}"
  ].join("\n"), "w");
}

// ──────────────────── MODULE WRITERS ────────────────────────────────

async function writeAllModules(ns) {
  await writeRootLite(ns);
  await writeDeployLite(ns);
  await writeRoot(ns);
  await writeDeploy(ns);
  await writeBatch(ns);
  await writePrograms(ns);
  await writeBuyServers(ns);
  await writeHacknet(ns);
  await writeFactions(ns);
  await writeAugs(ns);
  await writeAugInstall(ns);
  await writeBackdoor(ns);
  await writeContracts(ns);
  await writeStocks(ns);
  await writeGang(ns);
  await writeSleeves(ns);
  await writeTravel(ns);
}

// ═══════════════════════════════════════════════════════════════════
// BOOTSTRAP LITE MODULES
// ═══════════════════════════════════════════════════════════════════
async function writeRootLite(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var visited = new Set(['home']);",
    "  var queue = ['home'];",
    "  while (queue.length > 0) {",
    "    var host = queue.shift();",
    "    for (var n of ns.scan(host)) {",
    "      if (!visited.has(n)) { visited.add(n); queue.push(n); }",
    "    }",
    "  }",
    "  var pservs = ns.getPurchasedServers();",
    "  var servers = [...visited].filter(function(s) { return s !== 'home' && pservs.indexOf(s) === -1; });",
    "  await ns.write('/data/servers.txt', JSON.stringify(servers), 'w');",
    "  var rooted = [];",
    "  for (var host of servers) {",
    "    if (!ns.serverExists(host)) continue;",
    "    if (ns.hasRootAccess(host)) { rooted.push(host); continue; }",
    "    if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) continue;",
    "    var ports = 0;",
    "    if (ns.fileExists('BruteSSH.exe','home'))  { ns.brutessh(host);  ports++; }",
    "    if (ns.fileExists('FTPCrack.exe','home'))  { ns.ftpcrack(host);  ports++; }",
    "    if (ns.fileExists('relaySMTP.exe','home')) { ns.relaysmtp(host); ports++; }",
    "    if (ns.fileExists('HTTPWorm.exe','home'))  { ns.httpworm(host);  ports++; }",
    "    if (ns.fileExists('SQLInject.exe','home')) { ns.sqlinject(host); ports++; }",
    "    if (ports >= ns.getServerNumPortsRequired(host)) {",
    "      try { ns.nuke(host); } catch(e) {}",
    "      if (ns.hasRootAccess(host)) rooted.push(host);",
    "    }",
    "  }",
    "  await ns.write('/data/rooted.txt', JSON.stringify(rooted), 'w');",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "root-lite.js", code, "w");
}

async function writeDeployLite(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var rooted = [];",
    "  try { rooted = JSON.parse(ns.read('/data/rooted.txt')); } catch(e) { return; }",
    "  if (rooted.length === 0) return;",
    "  var candidates = rooted.filter(function(h) {",
    "    return ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= ns.getHackingLevel();",
    "  });",
    "  if (candidates.length === 0) return;",
    "  candidates.sort(function(a, b) { return ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a); });",
    "  var target = candidates[0];",
    "  await ns.write('/data/targets.txt', JSON.stringify([target]), 'w');",
    "  var hasLoopWorker = ns.ps('home').some(function(p) {",
    "    return p.filename === '/w-hack.js' || p.filename === '/w-grow.js' || p.filename === '/w-weak.js';",
    "  });",
    "  if (hasLoopWorker) return;",
    "  var weakRam = ns.getScriptRam('/w-weak.js', 'home');",
    "  var growRam = ns.getScriptRam('/w-grow.js', 'home');",
    "  var hackRam = ns.getScriptRam('/w-hack.js', 'home');",
    "  var reserve = Math.min(ns.getServerMaxRam('home') * 0.10, 4);",
    "  var freeRam = ns.getServerMaxRam('home') - ns.getServerUsedRam('home') - reserve;",
    "  if (freeRam < Math.min(weakRam, growRam, hackRam)) return;",
    "  var bundleRam = weakRam + growRam + hackRam;",
    "  var bundles = Math.floor(freeRam / bundleRam);",
    "  if (bundles <= 0) {",
    "    if (freeRam >= weakRam) ns.exec('/w-weak.js', 'home', 1, target);",
    "    return;",
    "  }",
    "  ns.exec('/w-hack.js', 'home', bundles, target);",
    "  ns.exec('/w-grow.js', 'home', bundles, target);",
    "  ns.exec('/w-weak.js', 'home', bundles, target);",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "deploy-lite.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════
async function writeRoot(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var visited = new Set(['home']);",
    "  var queue = ['home'];",
    "  while (queue.length > 0) {",
    "    var host = queue.shift();",
    "    for (var n of ns.scan(host)) {",
    "      if (!visited.has(n)) { visited.add(n); queue.push(n); }",
    "    }",
    "  }",
    "  var pservs = ns.getPurchasedServers();",
    "  var servers = [...visited].filter(function(s) { return s !== 'home' && pservs.indexOf(s) === -1; });",
    "  await ns.write('/data/servers.txt', JSON.stringify(servers), 'w');",
    "  var rooted = [];",
    "  for (var host of servers) {",
    "    if (!ns.serverExists(host)) continue;",
    "    if (ns.hasRootAccess(host)) { rooted.push(host); continue; }",
    "    if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) continue;",
    "    var ports = 0;",
    "    if (ns.fileExists('BruteSSH.exe','home'))  { ns.brutessh(host);  ports++; }",
    "    if (ns.fileExists('FTPCrack.exe','home'))  { ns.ftpcrack(host);  ports++; }",
    "    if (ns.fileExists('relaySMTP.exe','home')) { ns.relaysmtp(host); ports++; }",
    "    if (ns.fileExists('HTTPWorm.exe','home'))  { ns.httpworm(host);  ports++; }",
    "    if (ns.fileExists('SQLInject.exe','home')) { ns.sqlinject(host); ports++; }",
    "    if (ports >= ns.getServerNumPortsRequired(host)) {",
    "      ns.nuke(host);",
    "      ns.tprint('SUCCESS  Rooted ' + host);",
    "      rooted.push(host);",
    "    }",
    "  }",
    "  await ns.write('/data/rooted.txt', JSON.stringify(rooted), 'w');",
    "}",
    "/** end */"
  ].join("\n");
  await ns.write(MODULES_DIR + "root.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// DEPLOY — Hybrid: loop workers for immediate income + prep
//
// Strategy:
//   - ALL hackable targets get loop workers right away (money from minute 1)
//   - Thread ratios adapt to server state:
//       needs weakening → 70% weak, 20% grow, 10% hack
//       needs growing   → 20% weak, 60% grow, 20% hack
//       prepped         → 20% weak, 25% grow, 55% hack
//   - When batch.js takes over a prepped target, those loop workers
//     get killed and reassigned on the next deploy cycle
// ═══════════════════════════════════════════════════════════════════
async function writeDeploy(ns) {
  var code = [
    "/** @param {NS} ns — Hybrid deploy: immediate income + prep */",
    "export async function main(ns) {",
    "  var rooted = [];",
    "  try { rooted = JSON.parse(ns.read('/data/rooted.txt')); } catch(e) { return; }",
    "  if (rooted.length === 0) return;",
    "",
    "  var playerHack = ns.getHackingLevel();",
    "",
    "  // Score targets — maxMoney weighted, no growth inflation",
    "  var candidates = rooted",
    "    .filter(function(h) {",
    "      return ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= playerHack;",
    "    })",
    "    .map(function(h) {",
    "      var maxMoney = ns.getServerMaxMoney(h);",
    "      var minSec = ns.getServerMinSecurityLevel(h);",
    "      var curSec = ns.getServerSecurityLevel(h);",
    "      var curMoney = ns.getServerMoneyAvailable(h);",
    "      var hackTime = ns.getHackTime(h);",
    "      var prepped = curSec <= minSec + 0.5 && curMoney >= maxMoney * 0.95;",
    "      var needsWeak = curSec > minSec + 5;",
    "      var needsGrow = curMoney < maxMoney * 0.75;",
    "      var score = maxMoney / ((minSec + 1) * Math.max(hackTime, 1));",
    "      return { host: h, score: score, prepped: prepped,",
    "               needsWeak: needsWeak, needsGrow: needsGrow };",
    "    })",
    "    .sort(function(a, b) { return b.score - a.score; })",
    "    .slice(0, 10);",
    "",
    "  if (candidates.length === 0) return;",
    "",
    "  // Write target lists for dashboard and batch module",
    "  var targetHosts = candidates.map(function(t) { return t.host; });",
    "  await ns.write('/data/targets.txt', JSON.stringify(targetHosts), 'w');",
    "  var preppedHosts = candidates.filter(function(t) { return t.prepped; }).map(function(t) { return t.host; });",
    "  await ns.write('/data/prepped.txt', JSON.stringify(preppedHosts), 'w');",
    "",
    "  var weakRam = ns.getScriptRam('/w-weak.js', 'home');",
    "  var growRam = ns.getScriptRam('/w-grow.js', 'home');",
    "  var hackRam = ns.getScriptRam('/w-hack.js', 'home');",
    "  if (weakRam === 0) return;",
    "",
    "  // Pick primary target for this host (round-robin across hosts)",
    "  // Each host focuses on one target for efficiency",
    "  var allHosts = ['home'].concat(rooted);",
    "  var hostIdx = 0;",
    "",
    "  for (var hi = 0; hi < allHosts.length; hi++) {",
    "    var host = allHosts[hi];",
    "    if (!ns.serverExists(host)) continue;",
    "    if (!ns.hasRootAccess(host)) continue;",
    "    if (host !== 'home') {",
    "      await ns.scp(['/w-weak.js', '/w-grow.js', '/w-hack.js'], host, 'home');",
    "    }",
    "",
    "    // Reserve RAM on home for daemon + modules + batch controller",
    "    var homeMax = ns.getServerMaxRam('home');",
    "    var reserved = host === 'home' ? Math.min(homeMax * 0.15, 8) : 0;",
    "    var maxRam = ns.getServerMaxRam(host);",
    "    if (maxRam <= 0) continue;",
    "",
    "    // Check existing workers",
    "    var procs = ns.ps(host);",
    "    var loopWorkers = procs.filter(function(p) {",
    "      return p.filename==='/w-weak.js'||p.filename==='/w-grow.js'||p.filename==='/w-hack.js';",
    "    });",
    "    var batchWorkers = procs.filter(function(p) {",
    "      return p.filename==='/b-hack.js'||p.filename==='/b-grow.js'||p.filename==='/b-weak.js';",
    "    });",
    "",
    "    // If batch is running on this host, don't interfere",
    "    if (batchWorkers.length > 0) continue;",
    "",
    "    if (loopWorkers.length > 0) {",
    "      // Check if workers are on a current target",
    "      var onGoodTarget = loopWorkers.some(function(p) {",
    "        return targetHosts.indexOf(p.args[0]) !== -1;",
    "      });",
    "      if (onGoodTarget) continue; // leave them alone",
    "      // Kill workers on stale targets",
    "      for (var wi = 0; wi < loopWorkers.length; wi++) {",
    "        ns.kill(loopWorkers[wi].pid);",
    "      }",
    "    }",
    "",
    "    var freeRam = maxRam - ns.getServerUsedRam(host) - reserved;",
    "    if (freeRam < weakRam) continue;",
    "",
    "    // Assign this host to a target (distribute across targets)",
    "    var target = candidates[hostIdx % candidates.length];",
    "    hostIdx++;",
    "",
    "    // Calculate thread ratios based on server state",
    "    var totalT = Math.floor(freeRam / Math.max(weakRam, growRam, hackRam));",
    "    if (totalT <= 0) continue;",
    "",
    "    var wPct, gPct, hPct;",
    "    if (target.needsWeak) {",
    "      // Heavy weaken, but still hack for income",
    "      wPct = 0.70; gPct = 0.15; hPct = 0.15;",
    "    } else if (target.needsGrow) {",
    "      // Heavy grow with weaken compensation, some hack",
    "      wPct = 0.20; gPct = 0.55; hPct = 0.25;",
    "    } else {",
    "      // Prepped or close — maximize hacking",
    "      wPct = 0.15; gPct = 0.25; hPct = 0.60;",
    "    }",
    "",
    "    var wt = Math.max(1, Math.floor(totalT * wPct));",
    "    var gt = Math.max(1, Math.floor(totalT * gPct));",
    "    var ht = Math.max(1, totalT - wt - gt);",
    "",
    "    // Launch workers — hack first for immediate income",
    "    if (ht > 0 && freeRam >= hackRam * ht) {",
    "      ns.exec('/w-hack.js', host, ht, target.host);",
    "      freeRam -= ht * hackRam;",
    "    }",
    "    if (gt > 0 && freeRam >= growRam * gt) {",
    "      ns.exec('/w-grow.js', host, gt, target.host);",
    "      freeRam -= gt * growRam;",
    "    }",
    "    if (wt > 0 && freeRam >= weakRam * wt) {",
    "      ns.exec('/w-weak.js', host, wt, target.host);",
    "      freeRam -= wt * weakRam;",
    "    }",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "deploy.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// BATCH — HWGW on prepped targets (bonus income on top of loop workers)
// ═══════════════════════════════════════════════════════════════════
async function writeBatch(ns) {
  var code = [
    "/** @param {NS} ns — HWGW Batch controller */",
    "export async function main(ns) {",
    "  var prepped = [];",
    "  try { prepped = JSON.parse(ns.read('/data/prepped.txt')); } catch(e) { return; }",
    "  if (prepped.length === 0) return;",
    "",
    "  var SPACING = 50;",
    "  var HACK_PCT = 0.25;",
    "",
    "  var bHackRam = ns.getScriptRam('/b-hack.js', 'home');",
    "  var bGrowRam = ns.getScriptRam('/b-grow.js', 'home');",
    "  var bWeakRam = ns.getScriptRam('/b-weak.js', 'home');",
    "  if (bHackRam === 0) return;",
    "",
    "  var rooted = [];",
    "  try { rooted = JSON.parse(ns.read('/data/rooted.txt')); } catch(e) {}",
    "  var pservs = ns.getPurchasedServers();",
    "",
    "  for (var ti = 0; ti < prepped.length; ti++) {",
    "    var target = prepped[ti];",
    "",
    "    // Skip if any batch hack already running for this target",
    "    var alreadyRunning = false;",
    "    var checkHosts = ['home'].concat(pservs);",
    "    for (var ci = 0; ci < checkHosts.length; ci++) {",
    "      if (!ns.serverExists(checkHosts[ci])) continue;",
    "      var procs = ns.ps(checkHosts[ci]);",
    "      for (var pi = 0; pi < procs.length; pi++) {",
    "        if (procs[pi].filename === '/b-hack.js' && procs[pi].args[0] === target) {",
    "          alreadyRunning = true; break;",
    "        }",
    "      }",
    "      if (alreadyRunning) break;",
    "    }",
    "    if (alreadyRunning) continue;",
    "",
    "    // Calculate threads",
    "    var hackAnalyze = ns.hackAnalyze(target);",
    "    if (hackAnalyze <= 0) continue;",
    "    var hackThreads = Math.max(1, Math.floor(HACK_PCT / hackAnalyze));",
    "    var weaken1Threads = Math.max(1, Math.ceil(hackThreads * 0.002 / 0.05));",
    "    var growFactor = 1 / (1 - HACK_PCT);",
    "    var growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, growFactor)));",
    "    var weaken2Threads = Math.max(1, Math.ceil(growThreads * 0.004 / 0.05));",
    "",
    "    var totalRam = (hackThreads * bHackRam) + (weaken1Threads * bWeakRam) +",
    "                   (growThreads * bGrowRam) + (weaken2Threads * bWeakRam);",
    "",
    "    // Calculate timing",
    "    var hackTime = ns.getHackTime(target);",
    "    var growTime = ns.getGrowTime(target);",
    "    var weakenTime = ns.getWeakenTime(target);",
    "    var hackDelay   = Math.max(0, Math.round(weakenTime - SPACING - hackTime));",
    "    var weaken1Delay = 0;",
    "    var growDelay    = Math.max(0, Math.round(weakenTime + SPACING - growTime));",
    "    var weaken2Delay = Math.round(SPACING * 2);",
    "",
    "    // Find host — prefer purchased servers first",
    "    var batchHost = null;",
    "    for (var si = 0; si < pservs.length; si++) {",
    "      if (!ns.serverExists(pservs[si])) continue;",
    "      var free = ns.getServerMaxRam(pservs[si]) - ns.getServerUsedRam(pservs[si]);",
    "      if (free >= totalRam) { batchHost = pservs[si]; break; }",
    "    }",
    "    if (!batchHost) {",
    "      var homeMax = ns.getServerMaxRam('home');",
    "      var homeReserve = Math.min(homeMax * 0.15, 8);",
    "      var homeFree = homeMax - ns.getServerUsedRam('home') - homeReserve;",
    "      if (homeFree >= totalRam) batchHost = 'home';",
    "    }",
    "    if (!batchHost) {",
    "      for (var ri = 0; ri < rooted.length; ri++) {",
    "        if (!ns.serverExists(rooted[ri])) continue;",
    "        var free = ns.getServerMaxRam(rooted[ri]) - ns.getServerUsedRam(rooted[ri]);",
    "        if (free >= totalRam) { batchHost = rooted[ri]; break; }",
    "      }",
    "    }",
    "    if (!batchHost) continue;",
    "",
    "    if (batchHost !== 'home') {",
    "      await ns.scp(['/b-hack.js', '/b-grow.js', '/b-weak.js'], batchHost, 'home');",
    "    }",
    "",
    "    // Kill any loop workers targeting this server on the batch host",
    "    // to free RAM and avoid conflicts",
    "    var hostProcs = ns.ps(batchHost);",
    "    for (var pi = 0; pi < hostProcs.length; pi++) {",
    "      var p = hostProcs[pi];",
    "      if ((p.filename==='/w-hack.js'||p.filename==='/w-grow.js'||p.filename==='/w-weak.js') && p.args[0]===target) {",
    "        ns.kill(p.pid);",
    "      }",
    "    }",
    "",
    "    var batchId = Date.now() + '_' + ti;",
    "    var ok = true;",
    "    var p1 = ns.exec('/b-weak.js', batchHost, weaken1Threads, target, weaken1Delay, batchId+'_w1');",
    "    if (p1 === 0) ok = false;",
    "    var p2 = ns.exec('/b-weak.js', batchHost, weaken2Threads, target, weaken2Delay, batchId+'_w2');",
    "    if (p2 === 0) ok = false;",
    "    var p3 = ns.exec('/b-grow.js', batchHost, growThreads, target, growDelay, batchId+'_g');",
    "    if (p3 === 0) ok = false;",
    "    var p4 = ns.exec('/b-hack.js', batchHost, hackThreads, target, hackDelay, batchId+'_h');",
    "    if (p4 === 0) ok = false;",
    "",
    "    if (ok) {",
    "      ns.tprint('BATCH    '+target+' on '+batchHost+' [H:'+hackThreads+' W:'+weaken1Threads+' G:'+growThreads+' W:'+weaken2Threads+'] ~'+Math.round(weakenTime/1000)+'s');",
    "    }",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "batch.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// PROGRAMS (needs SF-4)
// ═══════════════════════════════════════════════════════════════════
async function writePrograms(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { ns.singularity.getOwnedAugmentations(); }",
    "  catch(e) { await ns.write('/data/disabled_programs.js', 'true', 'w'); return; }",
    "  var money = function() { return ns.getServerMoneyAvailable('home'); };",
    "  if (!ns.hasTorRouter()) {",
    "    if (money() >= 200000) { ns.singularity.purchaseTor(); ns.tprint('BOUGHT   TOR Router'); }",
    "    return;",
    "  }",
    "  var progs = [",
    "    ['BruteSSH.exe',500000],['FTPCrack.exe',1500000],['relaySMTP.exe',5000000],",
    "    ['HTTPWorm.exe',30000000],['SQLInject.exe',250000000],",
    "    ['ServerProfiler.exe',500000],['DeepscanV1.exe',500000],",
    "    ['DeepscanV2.exe',25000000],['AutoLink.exe',1000000],['Formulas.exe',5000000000]",
    "  ];",
    "  for (var p of progs) {",
    "    if (ns.fileExists(p[0],'home')) continue;",
    "    if (money() >= p[1]) {",
    "      if (ns.singularity.purchaseProgram(p[0])) ns.tprint('BOUGHT   '+p[0]);",
    "    }",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "programs.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// BUY-SERVERS — conservative early, aggressive later
// ═══════════════════════════════════════════════════════════════════
async function writeBuyServers(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var money = function() { return ns.getServerMoneyAvailable('home'); };",
    "  var maxServers = ns.getPurchasedServerLimit();",
    "  var owned = ns.getPurchasedServers();",
    "  var tiers = [8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536,131072,262144,524288,1048576];",
    "",
    "  // Early game: don't spend more than 10% on servers",
    "  // Late game: can spend up to 20%",
    "  var spendPct = money() > 50000000 ? 0.20 : 0.10;",
    "",
    "  // Buy new servers until at max",
    "  while (owned.length < maxServers) {",
    "    var bestRam = 8;",
    "    for (var r of tiers) {",
    "      if (ns.getPurchasedServerCost(r) <= money() * spendPct) bestRam = r;",
    "    }",
    "    if (money() < ns.getPurchasedServerCost(bestRam)) break;",
    "    var name = 'pserv-' + Date.now().toString(36);",
    "    var h = ns.purchaseServer(name, bestRam);",
    "    if (!h) break;",
    "    ns.tprint('BOUGHT   Server ' + h + ' (' + ns.formatRam(bestRam) + ')');",
    "    owned = ns.getPurchasedServers();",
    "    await ns.sleep(100);",
    "  }",
    "",
    "  // Upgrade weakest if we can afford 2x+ better",
    "  if (owned.length === 0) return;",
    "  var weakest = owned.reduce(function(a,b){return ns.getServerMaxRam(a)<ns.getServerMaxRam(b)?a:b;});",
    "  var weakRam = ns.getServerMaxRam(weakest);",
    "  var bestUpgrade = weakRam;",
    "  for (var r of tiers) {",
    "    if (r > weakRam && ns.getPurchasedServerCost(r) <= money() * spendPct) bestUpgrade = r;",
    "  }",
    "  if (bestUpgrade > weakRam * 2) {",
    "    ns.killall(weakest);",
    "    ns.deleteServer(weakest);",
    "    var name = 'pserv-' + Date.now().toString(36);",
    "    var h = ns.purchaseServer(name, bestUpgrade);",
    "    if (h) ns.tprint('UPGRADED ' + h + ' -> ' + ns.formatRam(bestUpgrade));",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "buy-servers.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// HACKNET
// ═══════════════════════════════════════════════════════════════════
async function writeHacknet(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var money = function() { return ns.getServerMoneyAvailable('home'); };",
    "  var nodes = ns.hacknet.numNodes();",
    "  var budgetPct = nodes < 8 ? 0.10 : 0.03;",
    "  var budget = function() { return money() * budgetPct; };",
    "  try {",
    "    if (nodes < ns.hacknet.maxNumNodes()) {",
    "      if (ns.hacknet.getPurchaseNodeCost() <= budget()) {",
    "        var i = ns.hacknet.purchaseNode();",
    "        if (i >= 0) ns.tprint('HACKNET  Purchased node hacknet-'+i);",
    "      }",
    "    }",
    "    for (var i = 0; i < ns.hacknet.numNodes(); i++) {",
    "      if (ns.hacknet.getLevelUpgradeCost(i,5) <= budget()) ns.hacknet.upgradeLevel(i,5);",
    "      if (ns.hacknet.getRamUpgradeCost(i,1)   <= budget()) ns.hacknet.upgradeRam(i,1);",
    "      if (ns.hacknet.getCoreUpgradeCost(i,1)  <= budget()) ns.hacknet.upgradeCore(i,1);",
    "    }",
    "    try {",
    "      while (ns.hacknet.numHashes() > ns.hacknet.hashCost('Sell for Money')) {",
    "        ns.hacknet.spendHashes('Sell for Money');",
    "      }",
    "    } catch(e) {}",
    "  } catch(e) {}",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "hacknet.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// FACTIONS (needs SF-4)
// ═══════════════════════════════════════════════════════════════════
async function writeFactions(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { ns.singularity.getOwnedAugmentations(); }",
    "  catch(e) { await ns.write('/data/disabled_factions.js', 'true', 'w'); return; }",
    "  for (var f of ns.singularity.checkFactionInvitations()) {",
    "    ns.singularity.joinFaction(f);",
    "    ns.tprint('FACTION  Joined '+f);",
    "  }",
    "  var work = ns.singularity.getCurrentWork();",
    "  if (work) return;",
    "  var factions = ns.getPlayer().factions;",
    "  if (factions.length === 0) return;",
    "  var owned = new Set(ns.singularity.getOwnedAugmentations(true));",
    "  var bestF = null; var bestScore = 0;",
    "  for (var f of factions) {",
    "    var rep = ns.singularity.getFactionRep(f);",
    "    var score = 0;",
    "    for (var aug of ns.singularity.getAugmentationsFromFaction(f)) {",
    "      if (owned.has(aug) || aug === 'NeuroFlux Governor') continue;",
    "      if (ns.singularity.getAugmentationRepReq(aug) > rep) {",
    "        score += ns.singularity.getAugmentationBasePrice(aug);",
    "      }",
    "    }",
    "    if (score > bestScore) { bestScore = score; bestF = f; }",
    "  }",
    "  if (bestF) {",
    "    try { ns.singularity.workForFaction(bestF, 'hacking', false); }",
    "    catch(e) { try { ns.singularity.workForFaction(bestF, 'field', false); }",
    "    catch(e2) { try { ns.singularity.workForFaction(bestF, 'security', false); } catch(e3) {} } }",
    "  } else {",
    "    try { ns.singularity.commitCrime('Homicide', false); } catch(e) {}",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "factions.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// AUGS (needs SF-4)
// ═══════════════════════════════════════════════════════════════════
async function writeAugs(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { ns.singularity.getOwnedAugmentations(); }",
    "  catch(e) { await ns.write('/data/disabled_augs.js', 'true', 'w'); return; }",
    "  var money = function() { return ns.getServerMoneyAvailable('home'); };",
    "  var owned = new Set(ns.singularity.getOwnedAugmentations(true));",
    "  var factions = ns.getPlayer().factions;",
    "  var NF = 'NeuroFlux Governor';",
    "  var avail = [];",
    "  for (var f of factions) {",
    "    var rep = ns.singularity.getFactionRep(f);",
    "    for (var aug of ns.singularity.getAugmentationsFromFaction(f)) {",
    "      if (owned.has(aug) && aug !== NF) continue;",
    "      if (ns.singularity.getAugmentationRepReq(aug) > rep) continue;",
    "      var prereqs = ns.singularity.getAugmentationPrereq(aug);",
    "      if (!prereqs.every(function(p){return owned.has(p);})) continue;",
    "      avail.push({ name: aug, faction: f, price: ns.singularity.getAugmentationPrice(aug) });",
    "    }",
    "  }",
    "  var seen = new Map();",
    "  for (var a of avail) {",
    "    if (!seen.has(a.name) || a.price < seen.get(a.name).price) seen.set(a.name, a);",
    "  }",
    "  avail = [...seen.values()].sort(function(a,b) {",
    "    if (a.name === NF) return 1;",
    "    if (b.name === NF) return -1;",
    "    return b.price - a.price;",
    "  });",
    "  var bought = 0;",
    "  for (var aug of avail) {",
    "    if (aug.price <= money()) {",
    "      if (ns.singularity.purchaseAugmentation(aug.faction, aug.name)) {",
    "        ns.tprint('AUG      '+aug.name+' from '+aug.faction+' ($'+ns.formatNumber(aug.price)+')');",
    "        bought++; owned.add(aug.name);",
    "      }",
    "    }",
    "  }",
    "  if (bought === 0) {",
    "    for (var f of factions) {",
    "      var rep = ns.singularity.getFactionRep(f);",
    "      var repReq = ns.singularity.getAugmentationRepReq(NF);",
    "      var price = ns.singularity.getAugmentationPrice(NF);",
    "      if (rep >= repReq && price <= money() * 0.5) {",
    "        if (ns.singularity.purchaseAugmentation(f, NF)) {",
    "          ns.tprint('AUG      NeuroFlux Governor ($'+ns.formatNumber(price)+')');",
    "        }",
    "        break;",
    "      }",
    "    }",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "augs.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// AUG-INSTALL (needs SF-4)
// ═══════════════════════════════════════════════════════════════════
async function writeAugInstall(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { ns.singularity.getOwnedAugmentations(); }",
    "  catch(e) { await ns.write('/data/disabled_aug-install.js', 'true', 'w'); return; }",
    "  var all = ns.singularity.getOwnedAugmentations(true);",
    "  var installed = ns.singularity.getOwnedAugmentations(false);",
    "  var pending = all.length - installed.length;",
    "  if (pending === 0) return;",
    "  var hasRedPill = all.includes('The Red Pill') && !installed.includes('The Red Pill');",
    "  var factions = ns.getPlayer().factions;",
    "  var ownedSet = new Set(all);",
    "  var nearbyAugs = 0;",
    "  for (var f of factions) {",
    "    var rep = ns.singularity.getFactionRep(f);",
    "    for (var aug of ns.singularity.getAugmentationsFromFaction(f)) {",
    "      if (ownedSet.has(aug) || aug === 'NeuroFlux Governor') continue;",
    "      var repReq = ns.singularity.getAugmentationRepReq(aug);",
    "      var price = ns.singularity.getAugmentationPrice(aug);",
    "      if (repReq <= rep * 1.5 && price <= ns.getServerMoneyAvailable('home') * 3) nearbyAugs++;",
    "    }",
    "  }",
    "  var noAuto = false;",
    "  try { noAuto = ns.read('/data/no-auto-install.txt').trim() === 'true'; } catch(e) {}",
    "  var ready = pending >= 5 && nearbyAugs === 0;",
    "  if (ready && !noAuto && !hasRedPill) {",
    "    ns.tprint('AUTO-INSTALLING '+pending+' AUGMENTATIONS — SOFT RESET');",
    "    ns.tprint('daemon.js will auto-restart after reset.');",
    "    ns.singularity.installAugmentations('daemon.js');",
    "  } else if (pending >= 3) {",
    "    ns.tprint(pending+' augmentation(s) pending install');",
    "    if (hasRedPill) ns.tprint('Backdoor w0r1d_d43m0n before installing!');",
    "    if (nearbyAugs > 0) ns.tprint('~'+nearbyAugs+' more augs obtainable soon, waiting...');",
    "    if (noAuto) ns.tprint('Auto-install disabled. Manual install when ready.');",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "aug-install.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// BACKDOOR (needs SF-4)
// ═══════════════════════════════════════════════════════════════════
async function writeBackdoor(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { ns.singularity.getOwnedAugmentations(); }",
    "  catch(e) { await ns.write('/data/disabled_backdoor.js', 'true', 'w'); return; }",
    "  var targets = ['CSEC','avmnite-02h','I.I.I.I','run4theh111z','w0r1d_d43m0n','.','The-Cave'];",
    "  var hack = ns.getHackingLevel();",
    "  for (var target of targets) {",
    "    if (!ns.serverExists(target)) continue;",
    "    if (!ns.hasRootAccess(target)) continue;",
    "    if (ns.getServerRequiredHackingLevel(target) > hack) continue;",
    "    if (ns.getServer(target).backdoorInstalled) continue;",
    "    var visited = new Set(['home']);",
    "    var queue = [['home',[]]];",
    "    var path = null;",
    "    while (queue.length > 0) {",
    "      var item = queue.shift();",
    "      var node = item[0]; var p = item[1];",
    "      for (var nb of ns.scan(node)) {",
    "        if (nb === target) { path = p.concat([nb]); break; }",
    "        if (!visited.has(nb)) { visited.add(nb); queue.push([nb, p.concat([nb])]); }",
    "      }",
    "      if (path) break;",
    "    }",
    "    if (!path) continue;",
    "    for (var hop of path) ns.singularity.connect(hop);",
    "    await ns.singularity.installBackdoor();",
    "    ns.tprint('BACKDOOR Installed on '+target);",
    "    ns.singularity.connect('home');",
    "    return;",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "backdoor.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════════
async function writeContracts(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var SOLVER = 'contract-auto-solver.js';",
    "  if (!ns.fileExists(SOLVER, 'home')) return;",
    "  if (ns.isRunning(SOLVER, 'home')) return;",
    "  var solverRam = ns.getScriptRam(SOLVER, 'home');",
    "  var free = ns.getServerMaxRam('home') - ns.getServerUsedRam('home');",
    "  if (free >= solverRam) ns.exec(SOLVER, 'home', 1);",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "contracts.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// STOCKS
// ═══════════════════════════════════════════════════════════════════
async function writeStocks(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var statusFile = '/data/stocks_status.txt';",
    "  if (!ns.stock || typeof ns.stock.hasTIXAPIAccess !== 'function' || typeof ns.stock.has4SDataTIXAPI !== 'function' || typeof ns.stock.getSymbols !== 'function') {",
    "    await ns.write('/data/disabled_stocks.js', 'true', 'w');",
    "    await ns.write(statusFile, 'api-missing', 'w');",
    "    return;",
    "  }",
    "  if (!ns.stock.hasTIXAPIAccess()) {",
    "    await ns.write(statusFile, 'waiting-tix', 'w');",
    "    return;",
    "  }",
    "  if (!ns.stock.has4SDataTIXAPI()) {",
    "    await ns.write(statusFile, 'waiting-4s', 'w');",
    "    return;",
    "  }",
    "  var symbols;",
    "  try { symbols = ns.stock.getSymbols(); } catch(e) {",
    "    await ns.write('/data/disabled_stocks.js', 'true', 'w');",
    "    await ns.write(statusFile, 'api-missing', 'w');",
    "    return;",
    "  }",
    "  await ns.write(statusFile, 'ready', 'w');",
    "  var COMMISSION = 100000;",
    "  var totalMoney = ns.getServerMoneyAvailable('home');",
    "  if (totalMoney < 10000000) return;",
    "  var stockValue = 0;",
    "  for (var sym of symbols) {",
    "    var pos = ns.stock.getPosition(sym);",
    "    stockValue += pos[0] * ns.stock.getBidPrice(sym);",
    "  }",
    "  var netWorth = totalMoney + stockValue;",
    "  var maxStockBudget = netWorth * 0.20;",
    "  var remainingBudget = maxStockBudget - stockValue;",
    "  for (var sym of symbols) {",
    "    var pos = ns.stock.getPosition(sym);",
    "    var shares = pos[0]; var avgPrice = pos[1];",
    "    var forecast = ns.stock.getForecast(sym);",
    "    var volatility = ns.stock.getVolatility(sym);",
    "    var ask = ns.stock.getAskPrice(sym);",
    "    var bid = ns.stock.getBidPrice(sym);",
    "    if (shares > 0) {",
    "      var profit = (bid - avgPrice) * shares - 2 * COMMISSION;",
    "      if (forecast < 0.52 || (profit > 0 && forecast < 0.55)) {",
    "        ns.stock.sellStock(sym, shares);",
    "        if (profit > 0) ns.tprint('STOCK    Sold '+sym+' +$'+ns.formatNumber(profit));",
    "        else ns.tprint('STOCK    Cut loss '+sym+' $'+ns.formatNumber(profit));",
    "      }",
    "    }",
    "    if (forecast > 0.65 && volatility > 0.005 && shares === 0 && remainingBudget > 0) {",
    "      var maxSpend = Math.min(remainingBudget * 0.25, totalMoney * 0.05);",
    "      var maxShares = ns.stock.getMaxShares(sym);",
    "      var afford = Math.floor(maxSpend / ask);",
    "      var buy = Math.min(maxShares * 0.1, afford);",
    "      if (buy > 0 && buy * ask > COMMISSION * 50) {",
    "        ns.stock.buyStock(sym, buy);",
    "        remainingBudget -= buy * ask;",
    "      }",
    "    }",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "stocks.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// GANG (needs SF-2)
// ═══════════════════════════════════════════════════════════════════
async function writeGang(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { if (!ns.gang.inGang()) return; }",
    "  catch(e) { await ns.write('/data/disabled_gang.js', 'true', 'w'); return; }",
    "  var info = ns.gang.getGangInformation();",
    "  var members = ns.gang.getMemberNames();",
    "  while (ns.gang.canRecruitMember()) {",
    "    var name = 'thug-'+members.length;",
    "    if (ns.gang.recruitMember(name)) { members.push(name); ns.tprint('GANG     Recruited '+name); }",
    "    else break;",
    "  }",
    "  for (var m of members) {",
    "    var mi = ns.gang.getMemberInformation(m);",
    "    if (info.territoryWarfareEngaged && info.territory < 1) {",
    "      ns.gang.setMemberTask(m, 'Territory Warfare');",
    "    } else if (mi.str < 200 || mi.def < 200 || mi.dex < 200 || mi.agi < 200) {",
    "      ns.gang.setMemberTask(m, 'Train Combat');",
    "    } else if (mi.hack < 200 && info.isHacking) {",
    "      ns.gang.setMemberTask(m, 'Train Hacking');",
    "    } else if (info.wantedPenalty < 0.9 && info.wantedLevel > 2) {",
    "      ns.gang.setMemberTask(m, 'Vigilante Justice');",
    "    } else {",
    "      ns.gang.setMemberTask(m, info.isHacking ? 'Money Laundering' : 'Human Trafficking');",
    "    }",
    "    for (var eq of ns.gang.getEquipmentNames()) {",
    "      if (ns.gang.getEquipmentCost(eq) <= ns.getServerMoneyAvailable('home') * 0.01) {",
    "        ns.gang.purchaseEquipment(m, eq);",
    "      }",
    "    }",
    "    try {",
    "      var asc = ns.gang.getAscensionResult(m);",
    "      if (asc && Math.max(asc.hack,asc.str,asc.def,asc.agi,asc.dex,asc.cha) >= 1.5) {",
    "        ns.gang.ascendMember(m);",
    "        ns.tprint('GANG     Ascended '+m);",
    "      }",
    "    } catch(e) {}",
    "  }",
    "  if (!info.territoryWarfareEngaged && info.power > 100) ns.gang.setTerritoryWarfare(true);",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "gang.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// SLEEVES (needs SF-10)
// ═══════════════════════════════════════════════════════════════════
async function writeSleeves(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  var num;",
    "  try { num = ns.sleeve.getNumSleeves(); }",
    "  catch(e) { await ns.write('/data/disabled_sleeves.js', 'true', 'w'); return; }",
    "  if (num === 0) return;",
    "  for (var i = 0; i < num; i++) {",
    "    var s = ns.sleeve.getSleeve(i);",
    "    if (s.shock > 50) { ns.sleeve.setToShockRecovery(i); continue; }",
    "    if (s.sync < 100) { ns.sleeve.setToSynchronize(i); continue; }",
    "    if (i === 0) {",
    "      try { ns.sleeve.setToCommitCrime(i, 'Homicide'); }",
    "      catch(e) { try { ns.sleeve.setToCommitCrime(i, 'Mug'); } catch(e2) {} }",
    "    } else {",
    "      try {",
    "        var factions = ns.getPlayer().factions;",
    "        if (factions.length > i-1) ns.sleeve.setToFactionWork(i, factions[i-1], 'hacking');",
    "        else ns.sleeve.setToCommitCrime(i, 'Homicide');",
    "      } catch(e) { try { ns.sleeve.setToCommitCrime(i, 'Homicide'); } catch(e2) {} }",
    "    }",
    "    try {",
    "      for (var aug of ns.sleeve.getSleevePurchasableAugs(i)) {",
    "        if (aug.cost <= ns.getServerMoneyAvailable('home') * 0.01) ns.sleeve.purchaseSleeveAug(i, aug.name);",
    "      }",
    "    } catch(e) {}",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "sleeves.js", code, "w");
}

// ═══════════════════════════════════════════════════════════════════
// TRAVEL (needs SF-4)
// ═══════════════════════════════════════════════════════════════════
async function writeTravel(ns) {
  var code = [
    "/** @param {NS} ns */",
    "export async function main(ns) {",
    "  try { ns.singularity.getOwnedAugmentations(); }",
    "  catch(e) { await ns.write('/data/disabled_travel.js', 'true', 'w'); return; }",
    "  var player = ns.getPlayer();",
    "  var money = ns.getServerMoneyAvailable('home');",
    "  if (money < 10000000) return;",
    "  if (!player.factions.includes('Tian Di Hui') && player.hacking >= 50 && money >= 1000000) {",
    "    if (['Chongqing','New Tokyo','Ishima'].indexOf(player.city) === -1) {",
    "      ns.singularity.travelToCity('Chongqing');",
    "      ns.tprint('TRAVEL   Moved to Chongqing for Tian Di Hui');",
    "    }",
    "  }",
    "}"
  ].join("\n");
  await ns.write(MODULES_DIR + "travel.js", code, "w");
}
