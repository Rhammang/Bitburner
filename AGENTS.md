# Agent Instructions: Bitburner Automation Repo

## Purpose

This repo is a single-daemon Bitburner automation system. The primary goal is
to start income quickly after reset, then scale into stronger hacking and
progression automation without manual babysitting.

## Current Design

    - `daemon.js` is the orchestrator. At runtime it generates only worker
      scripts (`/w-*.js`, `/b-*.js`) from source templates in
      `runtime-contracts.js`. Module scripts are real source files in `/modules/`.
    - `/modules/runtime-contracts.js` is the shared contract layer: all file
      paths, module metadata, worker definitions, RAM costs, tuning constants,
      and utility functions for script classification.
    - `/modules/utils.js` provides shared utilities (`list_servers`, `get_hosts`).
    - Scheduler runs modules from home on interval with RAM checks and disable flags.
    - State and diagnostics are written under `/data/`:
      - `servers.txt`, `rooted.txt`, `targets.txt`, `prepped.txt` (root.js writes)
      - `module_status.json` (daemon writes; tracks all core + lite module states)
      - `manager_status.json` (manager writes; mode, targets, prepDiag, batchDiag)
      - `server_map.json` (manager writes; scored target list with PREP/HACK state)
      - `contracts_status.txt` (contracts.js writes; discovered coding contracts)
      - `disabled_<module>.js` flags (cleared on daemon restart)

## Manager Modes

    - **PREP**: Single primary target under heavy weaken/grow. An optional
      income target (a prepped server) is hacked lightly on the side for cash.
    - **HACK**: All targets prepped, running pipelined HWGW batches across all
      available hosts. Targets scored by `maxMoney / weakenTime`.
    - **HYBRID**: Some targets are prepped while others still need prep. Prep
      workers distribute across purchased servers and home while batch workers
      run simultaneously on prepped targets.

## Boot and Reliability Model

    - Bootstrapping uses lightweight modules:
      - `/modules/root-lite.js` (protects `root.js`)
      - `/modules/deploy-lite.js` (protects `manager.js`)
    - Lite modules run until full `root.js` and `manager.js` have launched at
      least once.
    - Daemon keeps a RAM reserve during boot so non-critical modules do not
      starve root/manager.
    - Worker status messaging is explicit:
      - bootstrapping
      - no rooted targets yet
      - RAM blocked

## Stocks Model

    - Capability gated: check `ns.stock.hasTIXAPIAccess()` first, then
      `ns.stock.has4SDataTIXAPI()` for forecast data.
    - Missing TIX access: set status `waiting-tix` and return (do not disable).
    - Missing 4S data: set status `waiting-4s` and return (do not disable).
    - With 4S: run forecast-based trading with volatility-adjusted thresholds
      and a hysteresis band (buy > 0.55, sell < 0.51) to reduce whipsaw trades.
    - Portfolio management: max 75% of total worth invested, max 20% per stock,
      minimum $5M cash reserve plus server purchase reserve fraction.
    - Status written to `stocks_status.txt` as `state|{json}`.
    - Disable only for true API-surface mismatch (unexpected environment).

## Known Best Tactics (Codebase-Specific)

    - Protect early-game income path first (root + manager) before optional modules.
    - Keep daemon RAM footprint small; put heavy logic in child module scripts.
    - Preserve restart semantics for disable flags:
      - disabled in-run when API missing
      - re-evaluated on daemon restart
    - Prefer explicit status files over silent failures.
    - Keep module path contracts stable unless all call sites are updated.
    - Keep `runtime-contracts.js` as the single source of truth for file paths,
      module metadata, worker definitions, RAM costs, and tuning constants.

## Game Strategy (Phased)

1. Early game

   - Start `daemon.js` immediately after reset.
   - Prioritize rooting and loop workers on profitable low-level targets.
   - Manager enters PREP mode, optionally picking an income target for light
     hacking while the primary target is prepped.

2. Mid game

   - Expand rooted target set and purchased server capacity.
   - Manager enters HYBRID mode: prepping one target while batching others.
   - Prep workers distribute across all available hosts (home + purchased servers).
   - Let HWGW batches take over prepped targets.
   - Continue conservative upgrades (programs, hacknet, servers).

3. Late game

    - Manager in HACK mode: maximize batch throughput across all hosts.
    - Automate factions/augs/install cadence.
    - Keep contracts/backdoors/stocks as supporting income/progression layers.

## Future Plans

    - Add a config file for module intervals, RAM budgets, and feature toggles
      (externalize constants from `runtime-contracts.js`).
    - Expand `diag.js` with failure history, module health trends, and
      efficiency metrics.
    - Improve batch robustness for non-finite API return values.
    - Add `serverExists` guard to prep worker templates (matching the pattern
      already used in the lite worker).
    - Automate factions/augs/install cadence.

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

## Tooling

    - `diag.js` — standalone diagnostic snapshot: module status, manager state,
      live workers, RAM analysis, target analysis, data file health.
      Usage: `run diag.js [--tail]`
    - `github-sync-run.js` — pulls files from GitHub into the game and
      optionally launches an entry script. Supports `--mode sync` and `--mode run`.
    - `git-pull.js` — simpler GitHub pull with import rewriting for subfolder
      deployments.

## Next Modification

    - Add a config file for tuning constants (externalize from
      `runtime-contracts.js`). Config is optional; missing file falls back to
      hardcoded defaults. Manager `--flags` override config values.
    - Build a stocks module using reference repos as inspiration. Capability
      gated: TIX access check first, then 4S data. Write status to
      `stocks_status.txt`. Reserve cash for server purchases.

## AI Guardrails

    1. Do not remove startup clearing of `/data/disabled_*.js`.
    2. Keep `/data/rooted.txt` as shared input for deploy-lite, manager, hud,
       and diag.
    3. Keep lite boot modules available for low-RAM starts.
    4. Favor backward-compatible, incremental edits.
    5. Keep `runtime-contracts.js` as single source of truth for file paths,
       module metadata, worker definitions, and RAM costs. Do not duplicate
       these in individual modules.
    6. Keep `WORKERS` and `WORKER_SOURCES` in sync — every entry in WORKERS
       must have a corresponding source in WORKER_SOURCES.
    7. Use `is_prep_worker()` / `is_batch_worker()` from runtime-contracts as
       the canonical script classifiers. Do not add parallel classification logic.
    8. Do not break distributed prep: `get_prep_hosts()` must continue to
       include both home and remote hosts.
    9. Do not break income target caching (`cached_income_target` in manager.js)
       — it prevents PREP-mode oscillation.

## Official Resources

    - Official Bitburner GitHub Repository: [bitburner-official/bitburner](https://github.com/bitburner-official/bitburner)
    - Use this repository for official game documentation, API references, and source code insights.
