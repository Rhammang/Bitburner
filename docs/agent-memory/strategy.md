# Strategy: Known Best Tactics & Phased Game Plan

## Known Best Tactics (Codebase-Specific)

- Protect early-game income path first (root + manager) before optional modules.
- Keep `daemon.js` RAM footprint small; put heavy logic in child module scripts.
- Preserve restart semantics for disable flags: disabled in-run when API is
  missing, re-evaluated on daemon restart.
- Prefer explicit status files over silent failures.
- Keep module path contracts stable unless all call sites are updated.
- Keep `runtime-contracts.js` as the single source of truth for file paths,
  module metadata, worker definitions, RAM costs, and tuning constants.

## Game Strategy (Phased)

### 1. Early Game

- Start `daemon.js` immediately after reset.
- Prioritize rooting and loop workers on profitable low-level targets.
- Manager enters PREP mode, optionally picking an income target for light
  hacking while the primary target is prepped.

### 2. Mid Game

- Expand rooted target set and purchased server capacity.
- Manager enters HYBRID mode: prepping one target while batching others.
- Prep workers distribute across all available hosts (home + purchased servers).
- Let HWGW batches take over prepped targets.
- Continue conservative upgrades (programs, hacknet, servers).

### 3. Late Game

- Manager in HACK mode: maximize batch throughput across all hosts.
- Automate factions/augs/install cadence:
  - `factions.js` evaluates the install gate every cycle (diminishing-
    returns rule: next aug ≥ `installPriceRatio` × cheapest bought,
    pending non-NFG ≥ `installMinAugs`, post-cooldown).
  - Default is dry-run (`autoInstall: false`); the HUD shows
    `inst:DRY!` when the gate is satisfied. Tune thresholds while
    watching the dry-run, then flip `autoInstall: true` to arm.
  - Armed install: NFG buyout → boot flag → kill home scripts →
    `installAugmentations("github-sync-run.js")`. Post-install boot
    pulls latest from GitHub before launching daemon.
- Sleeves (Source-File 10) run via `sleeves.js`:
  - Buy sleeve augs above `sleeves.cashReserve`.
  - Shock recovery preempts other tasks above the threshold.
  - Default task priority grinds Homicide for Daedalus karma until
    `karma <= -54000`, then mirrors the main player's faction work.
  - Bladeburner sleeve specialization is a follow-up commit (gated
    behind `sleeves.bladeburnerSleeve`, default off).
- Keep contracts/backdoors/stocks as supporting income/progression layers.
