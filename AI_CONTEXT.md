# AI Context: Bitburner Automation Repo

## Purpose
This repo is a single-daemon Bitburner automation system. The primary goal is
to start income quickly after reset, then scale into stronger hacking and
progression automation without manual babysitting.

## Current Design
- `daemon.js` is the orchestrator and source of truth.
- At runtime, `daemon.js` generates:
  - module scripts in `/modules/`
  - loop workers (`/w-*.js`)
  - batch workers (`/b-*.js`)
- Scheduler runs modules from home on interval with RAM checks and disable flags.
- State and diagnostics are written under `/data/`:
  - `servers.txt`, `rooted.txt`, `targets.txt`, `prepped.txt`
  - `stocks_status.txt` (`waiting-tix`, `waiting-4s`, `ready`)
  - `module_status.json` (root/deploy/stocks runtime status)
  - `disabled_<module>.js` flags (cleared on daemon restart)

## Boot and Reliability Model
- Bootstrapping uses lightweight modules:
  - `/modules/root-lite.js`
  - `/modules/deploy-lite.js`
- Lite modules run until full `root.js` and `deploy.js` have launched at least once.
- Daemon keeps a RAM reserve during boot so non-critical modules do not starve
  root/deploy.
- Worker status messaging is explicit:
  - bootstrapping
  - no rooted targets yet
  - RAM blocked

## Stocks Model
- Use capability checks first:
  - `ns.stock.hasTIXAPIAccess()`
  - `ns.stock.has4SDataTIXAPI()`
- Missing progression access should set status and return, not permanently
  disable the module.
- Disable stocks only for true API-surface mismatch (unexpected environment).

## Known Best Tactics (Codebase-Specific)
- Protect early-game income path first (root + deploy) before optional modules.
- Keep daemon RAM footprint small; put heavy logic in child module scripts.
- Preserve restart semantics for disable flags:
  - disabled in-run when API missing
  - re-evaluated on daemon restart
- Prefer explicit status files over silent failures.
- Keep module path contracts stable unless all call sites are updated.

## Game Strategy (Phased)
1. Early game
- Start `daemon.js` immediately after reset.
- Prioritize rooting and loop workers on profitable low-level targets.
- Leave stocks in wait mode until TIX/4S access exists.

2. Mid game
- Expand rooted target set and purchased server capacity.
- Let HWGW batches take over prepped targets.
- Continue conservative upgrades (programs, hacknet, servers).

3. Late game
- Maximize batch throughput and server RAM tiers.
- Automate factions/augs/install cadence.
- Keep contracts/backdoors/stocks as supporting income/progression layers.

## Future Plans
- Move generated module bodies into real source files with shared utilities.
- Add a config file for module intervals, budgets, and feature toggles.
- Add smoke checks for generated script syntax and required `/data/*` outputs.
- Expand module diagnostics (last success time, fail counts, blocked reason).
- Optionally support configurable auto-purchase of stock access.

## Reference Inspirations
Use these as implementation references when planning new modules or refactors:
- [alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts) - strong daemon-style orchestration, progression helpers, and broad automation coverage.
- [chrisrabe/bitburner-automation](https://github.com/chrisrabe/bitburner-automation) - stable progression automation and a clean practical repo structure.
- [jjclark1982/bitburner-scripts](https://github.com/jjclark1982/bitburner-scripts) - broad module coverage including stocks and contracts.
- [bitburner-official/bitburner-scripts](https://github.com/bitburner-official/bitburner-scripts) - official baseline examples for common Bitburner workflows.
- [bitburner-official/typescript-template](https://github.com/bitburner-official/typescript-template) - modern authoring and remote sync workflow reference.
- [bitburner-official/bitburner-filesync](https://github.com/bitburner-official/bitburner-filesync) - official file synchronization reference.
- [Tanimodori/viteburner](https://github.com/Tanimodori/viteburner) - developer tooling, sync, and daemon-oriented utilities.
- [Nezrahm/bitburner-sync](https://github.com/Nezrahm/bitburner-sync) - lightweight sync tooling and release-driven updates.

## Next Modification
- First refactor target: extract a shared runtime contract layer for module registry, worker script definitions, and tuning constants so `daemon.js`, `modules/manager.js`, `diag.js`, and `modules/hud.js` stop duplicating the same knowledge.
- Use `alainbryden/bitburner-scripts` and the official Bitburner repos as the main shape reference for that split, then borrow sync workflow ideas from `bitburner-filesync`, `viteburner`, and `bitburner-sync`.
- After that shared layer exists, add a small config file for intervals, RAM budgets, and feature toggles so future tuning does not require touching multiple scripts.

## AI Guardrails
- Do not remove startup clearing of `/data/disabled_*.js`.
- Keep `/data/rooted.txt` as deploy input.
- Keep lite boot modules available for low-RAM starts.
- Keep stock capability checks before forecast/volatility calls.
- Favor backward-compatible, incremental edits.

## Official Resources
- Official Bitburner GitHub Repository: [bitburner-official/bitburner](https://github.com/bitburner-official/bitburner)
- Use this repository for official game documentation, API references, and source code insights.
