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

    - Automate factions/augs/install cadence.
    - Add persistent metrics history for cross-restart trend analysis.
    - Explore adaptive hackPercent tuning based on extraction ratio trends.

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

## Metrics System

The system is modeled as a **closed-loop controller** (plant: game servers,
controller: manager.js, actuators: worker scripts, sensors: ns.getServer*
APIs). Derived metrics use control-theory concepts — transfer functions,
damping analysis, frequency decomposition — applied to the discrete-time
samples the manager collects each cycle.

### Data Flow

    manager.js computes instantaneous derived metrics each cycle and writes
    them as `derivedMetrics` in `manager_status.json`. HUD maintains an
    in-memory `MetricsRing` (120 samples) to compute trend and frequency
    metrics. `diag.js` reads the latest snapshot for point-in-time reports.

### Metric Categories

    - **Efficiency**: incomePerGB, extractionRatio (actual/theoretical),
      weakenTax (defensive thread overhead).
    - **Utilization**: ramUtilization, hostActivation, batchSlotUtilization,
      targetCoverage, hostFragmentation.
    - **Health**: batchSuccessRate, execFailureRatio, prepStability,
      securityDrift and moneyRatio per target. Composite systemScore (A-F).
    - **Progress**: prepETA (estimated time to HACK state), income trend,
      prep velocity (money and security convergence rates).
    - **Control Theory** (HUD only, requires ring buffer history):
      dampingEstimate (log-decrement from security oscillation peaks),
      settlingTime (cycles to steady state after mode change),
      incomeSpectrum (DFT peak frequency and spectral spread),
      transferGain (Δincome / Δthreads).

### Key Thresholds

    - extractionRatio: good ≥ 0.5, warn ≥ 0.2
    - ramUtilization: good ≥ 0.7, warn ≥ 0.5
    - batchSuccessRate: good ≥ 0.9, warn ≥ 0.5
    - securityDrift: good ≤ 0.05, warn ≤ 0.2
    - prepStability: good ≥ 0.8, warn ≥ 0.5

### MetricsRing

    Shared ring buffer class in `runtime-contracts.js`. In-memory only — no
    persistence. Trends reset on module restart, which is acceptable since
    the ring fills within 2-4 minutes at normal cycle rates.

## Tooling

    - `diag.js` — standalone diagnostic snapshot: module status, manager state,
      live workers, RAM analysis, target analysis, derived metrics, data file
      health. Flags: `--tail`, `--json`, `--control` (adds control analysis).
      Usage: `run diag.js [--tail] [--json] [--control]`
    - `github-sync-run.js` — pulls files from GitHub into the game and
      optionally launches an entry script. Supports `--mode sync` and `--mode run`.
    - `git-pull.js` — simpler GitHub pull with import rewriting for subfolder
      deployments.

## Next Modification

    - Automate factions/augs/install cadence.
    - Add persistent metrics history (optional file-backed ring buffer for
      cross-restart trend analysis).

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
   10. Do not remove `derivedMetrics` from `manager_status.json` — it feeds
       both HUD trend analysis and diag.js reports.
   11. MetricsRing is in-memory only (no persistence). Trends reset on module
       restart, which is acceptable.

## Official Resources

    - Official Bitburner GitHub Repository: [bitburner-official/bitburner](https://github.com/bitburner-official/bitburner)
    - Use this repository for official game documentation, API references, and source code insights.
