export const MODULES_DIR = "/modules/";
export const DATA_DIR = "/data/";

export const MODULE_STATUS_FILE = `${DATA_DIR}module_status.json`;
export const MANAGER_STATUS_FILE = `${DATA_DIR}manager_status.json`;
export const SERVER_MAP_FILE = `${DATA_DIR}server_map.json`;
export const SERVERS_FILE = `${DATA_DIR}servers.txt`;
export const ROOTED_FILE = `${DATA_DIR}rooted.txt`;
export const TARGETS_FILE = `${DATA_DIR}targets.txt`;
export const PREPPED_FILE = `${DATA_DIR}prepped.txt`;
export const CONTRACTS_STATUS_FILE = `${DATA_DIR}contracts_status.txt`;
export const STOCKS_STATUS_FILE = `${DATA_DIR}stocks_status.txt`;
export const STOCKS_HISTORY_FILE = `${DATA_DIR}stocks_history.json`;
export const FACTIONS_STATUS_FILE = `${DATA_DIR}factions_status.json`;
export const DISABLED_PREFIX = `${DATA_DIR}disabled_`;
export const SYNC_MANIFEST_FILE = "sync-manifest.txt";
export const POST_INSTALL_BOOT_FILE = `${DATA_DIR}post_install_boot.txt`;
export const GITHUB_SYNC_RUN_SCRIPT = "github-sync-run.js";
export const SLEEVES_STATUS_FILE = `${DATA_DIR}sleeves_status.json`;

export const MODULE_FILES = {
  ROOT: "root.js",
  MANAGER: "manager.js",
  HUD: "hud.js",
  BUY_SERVERS: "buy-servers.js",
  CONTRACTS: "contracts.js",
  STOCKS: "stocks.js",
  FACTIONS: "factions.js",
  ROOT_LITE: "root-lite.js",
  DEPLOY_LITE: "deploy-lite.js",
};

export const ROOT_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.ROOT}`;
export const MANAGER_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.MANAGER}`;
export const HUD_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.HUD}`;
export const BUY_SERVERS_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.BUY_SERVERS}`;
export const CONTRACTS_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.CONTRACTS}`;
export const STOCKS_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.STOCKS}`;
export const FACTIONS_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.FACTIONS}`;
export const ROOT_LITE_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.ROOT_LITE}`;
export const DEPLOY_LITE_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.DEPLOY_LITE}`;

export const WORKERS = {
  PREP_WEAK: "/w-weak.js",
  PREP_GROW: "/w-grow.js",
  PREP_HACK: "/w-hack.js",
  HACK: "/b-hack.js",
  WEAK: "/b-weak.js",
  GROW: "/b-grow.js",
};

export const WORKER_FILES = [
  WORKERS.PREP_HACK,
  WORKERS.PREP_GROW,
  WORKERS.PREP_WEAK,
  WORKERS.HACK,
  WORKERS.GROW,
  WORKERS.WEAK,
];
export const PREP_WORKER_FILES = [
  WORKERS.PREP_HACK,
  WORKERS.PREP_GROW,
  WORKERS.PREP_WEAK,
];
export const BATCH_WORKER_FILES = [
  WORKERS.HACK,
  WORKERS.GROW,
  WORKERS.WEAK,
];

export const WORKER_RAM_COSTS = {
  PREP_WEAK: 1.85, // 1.6 base + 0.15 weaken + 0.05 serverExists + 0.05 hasRootAccess
  PREP_GROW: 1.85, // 1.6 base + 0.15 grow + 0.05 serverExists + 0.05 hasRootAccess
  PREP_HACK: 1.80, // 1.6 base + 0.1 hack + 0.05 serverExists + 0.05 hasRootAccess
  HACK: 1.7,       // 1.6 base + 0.1 hack
  WEAK: 1.75,      // 1.6 base + 0.15 weaken
  GROW: 1.75,      // 1.6 base + 0.15 grow
};

export const WORKER_SOURCES = {
  [WORKERS.PREP_WEAK]:
    "export async function main(ns) { const t = ns.args[0]; while (true) { if (!ns.serverExists(t) || !ns.hasRootAccess(t)) return; await ns.weaken(t); } }",
  [WORKERS.PREP_GROW]:
    "export async function main(ns) { const t = ns.args[0]; while (true) { if (!ns.serverExists(t) || !ns.hasRootAccess(t)) return; await ns.grow(t); } }",
  [WORKERS.PREP_HACK]:
    "export async function main(ns) { const t = ns.args[0]; while (true) { if (!ns.serverExists(t) || !ns.hasRootAccess(t)) return; await ns.hack(t); } }",
  [WORKERS.HACK]:
    "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.hack(ns.args[0]); }",
  [WORKERS.WEAK]:
    "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.weaken(ns.args[0]); }",
  [WORKERS.GROW]:
    "export async function main(ns) { if (ns.args[1] > 0) await ns.sleep(ns.args[1]); await ns.grow(ns.args[0]); }",
};

export const DEPLOY_LITE_WORKER_FILE = "/w-lite-cycle.js";
export const DEPLOY_LITE_WORKER_SOURCE =
  "export async function main(ns) { const target = ns.args[0]; while (true) { if (!ns.serverExists(target) || !ns.hasRootAccess(target)) return; const maxMoney = ns.getServerMaxMoney(target); const money = ns.getServerMoneyAvailable(target); const minSec = ns.getServerMinSecurityLevel(target); const sec = ns.getServerSecurityLevel(target); if (sec > minSec + 5) { await ns.weaken(target); } else if (money < maxMoney * 0.85) { await ns.grow(target); } else { await ns.hack(target); } } }";

export const CORE_MODULES = [
  { file: MODULE_FILES.ROOT, desc: "Root Access Manager", interval: 5000, bootCritical: true },
  { file: MODULE_FILES.MANAGER, desc: "Main Logic Controller", interval: 3000, bootCritical: true },
  { file: MODULE_FILES.HUD, desc: "Runtime HUD", interval: 10000, bootCritical: false },
  { file: MODULE_FILES.BUY_SERVERS, desc: "Server Purchase Manager", interval: 20000, bootCritical: false },
  { file: MODULE_FILES.CONTRACTS, desc: "Contract Solver", interval: 60000, bootCritical: false },
  { file: MODULE_FILES.STOCKS, desc: "Stock Trader", interval: 30000, bootCritical: false },
  { file: MODULE_FILES.FACTIONS, desc: "Faction & Progression Manager", interval: 30000, bootCritical: false },
];

export const LITE_BOOT_MODULES = [
  { file: MODULE_FILES.ROOT_LITE, desc: "Root Bootstrap", interval: 8000, protects: MODULE_FILES.ROOT },
  { file: MODULE_FILES.DEPLOY_LITE, desc: "Deploy Bootstrap", interval: 10000, protects: MODULE_FILES.MANAGER },
];

export const MODULE_ROWS = [
  { file: MODULE_FILES.ROOT, label: "Root" },
  { file: MODULE_FILES.MANAGER, label: "Manager" },
  { file: MODULE_FILES.HUD, label: "HUD" },
  { file: MODULE_FILES.BUY_SERVERS, label: "Servers" },
  { file: MODULE_FILES.CONTRACTS, label: "Contracts" },
  { file: MODULE_FILES.STOCKS, label: "Stocks" },
  { file: MODULE_FILES.FACTIONS, label: "Factions" },
];

export const LITE_ROWS = [
  { file: MODULE_FILES.ROOT_LITE, label: "RootLite" },
  { file: MODULE_FILES.DEPLOY_LITE, label: "DeployLite" },
];

export const DAEMON_LOOP_MS = 5000;
export const DAEMON_WARN_THROTTLE_MS = 60000;

export const ROOT_LOOP_MS = 5000;
export const ROOT_LITE_LOOP_MS = 4000;

export const DEPLOY_LITE_LOOP_MS = 5000;
export const DEPLOY_LITE_HOME_RESERVE = 16;
export const DEPLOY_LITE_WORKER_RAM = WORKER_RAM_COSTS.PREP_GROW;
export const DEPLOY_LITE_WORKER_SYNC_INTERVAL_MS = 120000;

export const BUY_SERVERS_LOOP_MS = 30000;
export const BUY_SERVERS_SERVER_PREFIX = "pserv-";
export const BUY_SERVERS_MIN_RAM = 8;
export const BUY_SERVERS_BUDGET_FRACTION = 0.25;
export const SINGULARITY_PROGRAM_PURCHASE_ORDER = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "SQLInject.exe",
  "ServerProfiler.exe",
  "DeepscanV1.exe",
  "AutoLink.exe",
  "DeepscanV2.exe",
  "Formulas.exe",
];
export const SINGULARITY_BACKDOOR_TARGETS = [
  { server: "CSEC", faction: "CyberSec" },
  { server: "avmnite-02h", faction: "NiteSec" },
  { server: "I.I.I.I", faction: "The Black Hand" },
  { server: "run4theh111z", faction: "BitRunners" },
];
export const SINGULARITY_COMPANY_TARGETS = [
  { company: "MegaCorp", faction: "MegaCorp", city: "Sector-12" },
  { company: "Blade Industries", faction: "Blade Industries", city: "Sector-12" },
  { company: "Four Sigma", faction: "Four Sigma", city: "Sector-12" },
  { company: "ECorp", faction: "ECorp", city: "Aevum" },
  { company: "Bachman & Associates", faction: "Bachman & Associates", city: "Aevum" },
  { company: "Clarke Incorporated", faction: "Clarke Incorporated", city: "Aevum" },
  { company: "NWO", faction: "NWO", city: "Volhaven" },
  { company: "OmniTek Incorporated", faction: "OmniTek Incorporated", city: "Volhaven" },
  { company: "KuaiGong International", faction: "KuaiGong International", city: "Chongqing" },
  { company: "Fulcrum Technologies", faction: "Fulcrum Secret Technologies", city: "Aevum" },
];
export const SINGULARITY_TRAINING_CITY = "Sector-12";
export const SINGULARITY_TRAINING_UNIVERSITY = "Rothman University";
export const SINGULARITY_TRAINING_COURSE = "Algorithms";
export const SINGULARITY_TRAINING_HACKING_LEVEL = 50;

export const MANAGER_HOME_RESERVE_DEFAULT = 16;
export const MANAGER_SPACING_MS_DEFAULT = 200;
export const MANAGER_BATCHES_PER_WINDOW_DEFAULT = 5;
export const MANAGER_SCHEDULE_AHEAD_MS_DEFAULT = 20000;
export const MANAGER_LOOP_SLEEP_MS_DEFAULT = 1000;
export const MANAGER_PREP_SLEEP_MS_DEFAULT = 2000;
export const MANAGER_HACK_PERCENT_DEFAULT = 0.15;
export const MANAGER_WORKER_SYNC_INTERVAL_MS = 120000;
export const MANAGER_SERVER_MAP_WRITE_INTERVAL_MS = 5000;
export const MANAGER_STATUS_WRITE_INTERVAL_MS = 5000;
export const MANAGER_MIN_EXEC_RAM = WORKER_RAM_COSTS.HACK;
export const MANAGER_MIN_INCOME_RAM = 32;

export const CONFIG_FILE = `${DATA_DIR}config.json`;

const CONFIG_DEFAULTS = {
  manager: {
    homeReserve: MANAGER_HOME_RESERVE_DEFAULT,
    spacing: MANAGER_SPACING_MS_DEFAULT,
    batchesPerWindow: MANAGER_BATCHES_PER_WINDOW_DEFAULT,
    scheduleAheadTime: MANAGER_SCHEDULE_AHEAD_MS_DEFAULT,
    loopSleep: MANAGER_LOOP_SLEEP_MS_DEFAULT,
    prepSleep: MANAGER_PREP_SLEEP_MS_DEFAULT,
    hackPercent: MANAGER_HACK_PERCENT_DEFAULT,
  },
  buyServers: {
    budgetFraction: BUY_SERVERS_BUDGET_FRACTION,
    minRam: BUY_SERVERS_MIN_RAM,
    serverPrefix: BUY_SERVERS_SERVER_PREFIX,
  },
  daemon: {
    loopMs: DAEMON_LOOP_MS,
    warnThrottleMs: DAEMON_WARN_THROTTLE_MS,
  },
  factions: {
    autoBuy: true,
    cashReserve: 50_000_000,
    workFocus: "hacking",
    skipFactions: [],
    autoPrograms: true,
    programReserve: 1_000_000,
    autoBackdoor: true,
    autoTraining: true,
    trainingHackingLevel: SINGULARITY_TRAINING_HACKING_LEVEL,
    trainingCity: SINGULARITY_TRAINING_CITY,
    trainingUniversity: SINGULARITY_TRAINING_UNIVERSITY,
    trainingCourse: SINGULARITY_TRAINING_COURSE,
    autoCompany: true,
  },
};

/**
 * Loads config from /data/config.json merged with hardcoded defaults.
 * Missing file or malformed JSON silently falls back to defaults.
 * @param {NS} ns
 * @returns {typeof CONFIG_DEFAULTS}
 */
export function load_config(ns) {
  try {
    const raw = ns.read(CONFIG_FILE);
    if (!raw || !raw.trim()) return structuredClone(CONFIG_DEFAULTS);
    const user = JSON.parse(raw);
    return {
      manager: { ...CONFIG_DEFAULTS.manager, ...user.manager },
      buyServers: { ...CONFIG_DEFAULTS.buyServers, ...user.buyServers },
      daemon: { ...CONFIG_DEFAULTS.daemon, ...user.daemon },
      factions: { ...CONFIG_DEFAULTS.factions, ...user.factions },
    };
  } catch {
    return structuredClone(CONFIG_DEFAULTS);
  }
}

export function normalize_script_filename(filename) {
  const value = String(filename || "").trim();
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

export function get_worker_kind(filename) {
  const normalized = normalize_script_filename(filename);
  if (normalized === WORKERS.PREP_HACK || normalized === WORKERS.HACK) return "hack";
  if (normalized === WORKERS.PREP_GROW || normalized === WORKERS.GROW) return "grow";
  if (normalized === WORKERS.PREP_WEAK || normalized === WORKERS.WEAK) return "weak";
  return "";
}

export function is_prep_worker(filename) {
  return PREP_WORKER_FILES.includes(normalize_script_filename(filename));
}

export function is_batch_worker(filename) {
  return BATCH_WORKER_FILES.includes(normalize_script_filename(filename));
}

export function build_script_target_counts(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = `${normalize_script_filename(entry.script)}::${String(entry.target || "")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function script_target_counts_equal(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, count] of left.entries()) {
    if (right.get(key) !== count) return false;
  }
  return true;
}

// ── Stock trading constants ─────────────────────────────────────────

export const STOCKS_LOOP_MS = 6000;
export const STOCKS_BUY_THRESHOLD = 0.55;
export const STOCKS_SELL_THRESHOLD = 0.51;
export const STOCKS_COMMISSION = 100000;
export const STOCKS_MAX_PORTFOLIO_FRACTION = 0.75;
export const STOCKS_PER_STOCK_FRACTION = 0.2;
export const STOCKS_MIN_CASH_RESERVE = 5000000;
export const STOCKS_HISTORY_CAPACITY = 180;
export const STOCKS_EVENT_CAPACITY = 50;

// ── Metrics infrastructure ──────────────────────────────────────────

export const METRICS_RING_SIZE = 120;

export class MetricsRing {
  constructor(size = METRICS_RING_SIZE) {
    this.size = size;
    this.buf = [];
    this.idx = 0;
  }
  push(v) {
    if (this.buf.length < this.size) this.buf.push(v);
    else this.buf[this.idx % this.size] = v;
    this.idx++;
  }
  latest() {
    return this.buf.length ? this.buf[(this.idx - 1) % this.size] : null;
  }
  ago(n) {
    if (!this.buf.length) return null;
    const i = Math.max(0, this.idx - 1 - n);
    return this.buf[i % this.size];
  }
  window(n) {
    return this.buf.slice(Math.max(0, this.buf.length - n));
  }
  get length() {
    return this.buf.length;
  }
}

export const METRICS_THRESHOLDS = {
  extractionRatio: { good: 0.5, warn: 0.2 },
  ramUtilization: { good: 0.7, warn: 0.5 },
  batchSuccessRate: { good: 0.9, warn: 0.5 },
  securityDrift: { good: 0.05, warn: 0.2 },
  prepStability: { good: 0.8, warn: 0.5 },
  execFailureRatio: { good: 0, warn: 0.01 },
};
