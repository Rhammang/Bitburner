# Agent Instructions: Bitburner Automation Repo

## Purpose

Single-daemon Bitburner automation system. Goal: start income quickly after
reset, then scale into stronger hacking and progression automation without
manual babysitting.

This root file contains the invariants every AI tool must know. Guardrails and
architecture facts stay inline — they apply regardless of which AI tool is
reading. Detailed domain docs are imported via `@import` below (Claude Code)
or can be read directly from `docs/agent-memory/`.

## Repo Architecture

- `daemon.js` — orchestrator and scheduler; runs modules from home on interval
  with RAM checks and disable flags.
- `/modules/runtime-contracts.js` — **single source of truth** for all shared
  file paths, module metadata, worker definitions, RAM costs, tuning constants,
  and script classification helpers. Do not duplicate these in any other module.
- `/modules/utils.js` — shared utilities (`list_servers`, `get_hosts`,
  `find_server_path`).
- `/modules/root-lite.js`, `/modules/deploy-lite.js` — lightweight boot
  modules that protect `root.js` and `manager.js` during low-RAM starts.
- Worker scripts (`/w-*.js`, `/b-*.js`) are runtime-generated from source
  templates in `runtime-contracts.js`. They are not real source files.
- Real module scripts live in `/modules/`.
- State and diagnostics are written under `/data/` (see
  `@docs/agent-memory/architecture.md` for the full inventory).

## Repo Facts Agents Commonly Miss

- `daemon.js` generates worker scripts at runtime — do not edit `/w-*.js` or
  `/b-*.js` directly.
- Disable flags (`/data/disabled_<module>.js`) are cleared on daemon restart —
  modules re-evaluate on next boot.
- The three manager modes are PREP, HACK, and HYBRID. Mode transitions are
  automatic based on target prep state.
- `MetricsRing` is in-memory only. Trends reset on module restart; this is
  intentional.
- Factions module requires Singularity API (Source-File 4). It will self-exit
  if the API is unavailable.

## AI Guardrails

1. Do not remove startup clearing of `/data/disabled_*.js`.
2. Keep `/data/rooted.txt` as shared input for deploy-lite, manager, hud,
   and diag. Do not rename or remove it.
3. Keep lite boot modules available for low-RAM starts.
4. Favor backward-compatible, incremental edits. Do not redesign unless the
   user explicitly requests it.
5. Keep `runtime-contracts.js` as the single source of truth for file paths,
   module metadata, worker definitions, and RAM costs. Do not duplicate these
   in individual modules.
6. Keep `WORKERS` and `WORKER_SOURCES` in sync — every entry in `WORKERS`
   must have a corresponding source in `WORKER_SOURCES`.
7. Use `is_prep_worker()` / `is_batch_worker()` from `runtime-contracts.js`
   as the canonical script classifiers. Do not add parallel classification
   logic elsewhere.
8. Do not break distributed prep: `get_prep_hosts()` must continue to include
   both home and remote hosts.
9. Do not break income target caching (`cached_income_target` in `manager.js`)
   — it prevents PREP-mode oscillation.
10. Do not remove `derivedMetrics` from `manager_status.json` — it feeds both
    HUD trend analysis and `diag.js` reports.
11. `MetricsRing` is in-memory only (no persistence). Do not add file-backed
    persistence unless the user explicitly requests it.
12. The factions module must never auto-install augmentations. The player
    decides when to reset.
13. Contract solvers must be correct — wrong answers cost attempts. Test
    solver logic carefully before adding new contract types.

## Default Editing Stance

- Make the smallest change that preserves existing behavior.
- Protect the early-game income path first: `root.js` and `manager.js` are
  the critical boot path. Do not starve them of RAM.
- Keep `daemon.js` lightweight — put heavy logic in child module scripts.
- Preserve restart semantics for disable flags.
- Prefer explicit status files over silent failures.
- Keep module path contracts stable unless all call sites are updated.

## Detail Docs (@import index)

Load these when the task touches the relevant domain.

@import ./docs/agent-memory/architecture.md
<!-- Boot model, module lifecycle, /data/ status file inventory -->

@import ./docs/agent-memory/manager.md
<!-- PREP / HACK / HYBRID modes, target selection, state transitions -->

@import ./docs/agent-memory/strategy.md
<!-- Known best tactics, phased game strategy (early/mid/late) -->

@import ./docs/agent-memory/stocks.md
<!-- Stocks model: capability gating, thresholds, portfolio limits -->

@import ./docs/agent-memory/contracts.md
<!-- Contract auto-solver: supported types, attempt safety, status -->

@import ./docs/agent-memory/factions.md
<!-- Factions/Singularity: programs, backdoors, aug purchase, config keys -->

@import ./docs/agent-memory/metrics.md
<!-- Derived metrics, MetricsRing, control-theory concepts, thresholds -->

@import ./docs/agent-memory/tooling.md
<!-- diag.js, github-sync-run.js, git-pull.js usage -->

@import ./docs/agent-memory/roadmap.md
<!-- Future plans, next modifications -->

@import ./docs/agent-memory/references.md
<!-- Reference repos, official Bitburner resources -->
