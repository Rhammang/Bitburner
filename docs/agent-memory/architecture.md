# Architecture: Boot Model & Module Lifecycle

## Module System

- `daemon.js` schedules modules from home on a timed interval.
- Each module is a real source file under `/modules/`.
- RAM checks run before each module launch. Non-critical modules are skipped
  when RAM is insufficient; critical boot path (root + manager) always gets
  priority.
- Disable flags (`/data/disabled_<module>.js`) are written when a module
  self-disables (e.g., missing API). They are cleared on daemon restart so the
  module re-evaluates on next boot.

## Boot and Reliability Model

Bootstrapping uses two lightweight modules to protect the critical path during
low-RAM starts:

- `/modules/root-lite.js` — runs until full `root.js` has launched at least
  once. Protects the rooting step.
- `/modules/deploy-lite.js` — runs until full `manager.js` has launched at
  least once. Protects the manager step.

Daemon keeps a RAM reserve during boot so non-critical modules do not starve
root/manager. Once both have launched, lite modules yield and the full modules
take over.

Worker status messaging is explicit during boot:
- `bootstrapping`
- `no rooted targets yet`
- `RAM blocked`

## /data/ Status File Inventory

All runtime state and diagnostics are written under `/data/`:

| File | Writer | Contents |
|------|--------|----------|
| `servers.txt` | `root.js` | All discovered servers |
| `rooted.txt` | `root.js` | Servers with root access |
| `targets.txt` | `root.js` | Viable hack targets |
| `prepped.txt` | `root.js` | Servers at min-security / max-money |
| `module_status.json` | `daemon.js` | All core + lite module states |
| `manager_status.json` | `manager.js` | Mode, targets, prepDiag, batchDiag, derivedMetrics |
| `server_map.json` | `manager.js` | Scored target list with PREP/HACK state |
| `contracts_status.txt` | `contracts.js` | Discovered coding contracts (line count) |
| `stocks_status.txt` | `stocks.js` | Trading state and portfolio as `state\|{json}` |
| `factions_status.json` | `factions.js` | Aug counts, activity, backdoor/program progress |
| `disabled_<module>.js` | Module (self) | Disable flag; cleared on daemon restart |
| `config.json` | User | Runtime config overrides (see per-module docs) |
