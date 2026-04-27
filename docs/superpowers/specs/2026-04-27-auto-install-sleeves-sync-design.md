# Design: Auto-install + Sleeve Control + Sync Auto-start

Date: 2026-04-27
Status: Draft — pending implementation plan

## Goals

Move the Bitburner automation from "assisted" to "fully automated" by adding:

1. **Auto-install augmentations** behind a diminishing-returns gate, with a master arming switch and dry-run telemetry.
2. **Sleeve control** as a new daemon module (Source-File 10).
3. **`github-sync-run.js` auto-starts daemon** by default, driven by an explicit manifest with auto-discovery fallback.

The user has explicitly authorized overriding the prior AGENTS.md guardrail #12 ("never auto-install"). The new contract is "auto-install only when armed, with safeties below."

## Non-goals

- Bladeburner full automation (only a single dedicated sleeve, behind a config flag, ships in a follow-up commit).
- Stanek / Gang / Corporation automation.
- Persistent metrics history (already in roadmap, unrelated).

---

## Feature 1 — Auto-install augmentations

### Trigger semantics

The install gate fires when **all three** conditions are true:

1. **Spend ratio:**
   `cheapest_rep_qualified_unbought_aug.price >= installPriceRatio × cheapest_bought_this_cycle.price`
   - "Rep-qualified unbought" = augs the player has rep for but has not purchased this cycle. NeuroFlux Governor is excluded entirely.
   - If zero rep-qualified augs remain unbought, the gate fires (nothing left to buy this cycle).
   - Rep-blocked augs do **not** fire the gate; they signal "keep grinding rep."
2. **Pending floor:** `pendingInstallCount >= installMinAugs` (default 3).
3. **Cooldown:** `now - bitNodeStartTime >= installCooldownMs` (default 5 min). Prevents post-install loop.

### Armed vs dry-run

- `config.factions.autoInstall = false` (default): write gate state to `factions_status.json` for HUD/diag, do not install. This is dry-run telemetry — the user tunes thresholds while watching the HUD before flipping the switch.
- `config.factions.autoInstall = true`: when gate fires, execute install (steps below).

### Install execution

When gate fires AND armed:

1. **NeuroFlux Governor buyout** — purchase NFG levels with leftover cash (above `cashReserve`) from the faction with highest rep that offers it. NFG stacks across resets.
2. Write `/data/post_install_boot.txt` flag (timestamp + reason).
3. Kill all running scripts on home (the factions module is killed last by the install API).
4. Call `ns.singularity.installAugmentations("github-sync-run.js")`.
   - Using `github-sync-run.js` as the callback ensures the next run pulls latest from GitHub before booting daemon. (Codex's contribution.)

### Daemon resume

`daemon.js` consumes `/data/post_install_boot.txt` on startup:
- Reads + deletes the flag.
- Logs "post-install resume" once.
- Sets a `postInstallResume` marker in `module_status.json` boot metadata for one cycle.
- No new bootstrap delay is added. The flag is purely informational.

### New config keys (`config.factions`)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `autoInstall` | bool | `false` | Master arming switch |
| `installPriceRatio` | number | `100` | Spend-ratio threshold (×) |
| `installMinAugs` | number | `3` | Minimum pending augs to fire gate |
| `installCooldownMs` | number | `300000` | Cooldown after BitNode start |

### Status file additions (`factions_status.json`)

New `install` object:

```
install: {
  armed,                    // config.factions.autoInstall
  gateSatisfied,            // all three conditions met
  cooldownActive,
  cooldownRemainingMs,
  pendingInstallCount,
  installMinAugs,
  installPriceRatio,
  cheapestBoughtThisCycle,  // { name, price } | null
  nextAugName,              // cheapest rep-qualified unbought
  nextAugPrice,
  spendRatio,               // nextAugPrice / cheapestBoughtThisCycle
  wouldInstall,             // gate-only result, ignoring armed
  lastAction,               // "dry-run" | "installing" | "idle"
  neuroflux: { faction, purchased, spent }
}
```

### New `factions.js` functions

- `evaluate_install_gate(ns, player, remainingAugs, pendingInstallNames, cfg)` → install state object.
- `compute_cheapest_bought_this_cycle(ns, pendingInstallNames)`.
- `compute_next_aug_target(remainingAugs)`.
- `maybe_log_install_dry_run(ns, installState)`.
- `pick_neuroflux_faction(ns, player, skipFactions)`.
- `buy_neuroflux_levels(ns, faction, cashReserve)`.
- `kill_all_scripts_except_self(ns)`.
- `trigger_auto_install(ns, installState)`.
- `disable_self(ns, reason)` — replaces silent `return` when Singularity is unavailable.

`run_cycle()` is reordered:
1. Programs / backdoors / invites / faction work.
2. Buy normal augs.
3. Recompute pending installs and remaining augs.
4. `evaluate_install_gate()`.
5. If unarmed: `maybe_log_install_dry_run()`.
6. If armed and gate satisfied: NFG buyout, then `trigger_auto_install()`.

### AGENTS.md guardrail update

Replace #12:

> **#12.** Auto-install is permitted but must remain gated by `config.factions.autoInstall`. The default config ships with `autoInstall: false`. The install path must always go through `trigger_auto_install()`, which writes `/data/post_install_boot.txt` and uses `github-sync-run.js` as the install callback so a fresh GitHub pull precedes daemon boot.

`docs/agent-memory/factions.md` is updated similarly — the "NEVER auto-installs" note becomes the new armed/dry-run contract.

---

## Feature 2 — Sleeve control module

### Lifecycle

- New file `modules/sleeves.js`.
- Registered in `runtime-contracts.js` `MODULES` table with cycle interval `30000ms`. RAM resolved dynamically via `ns.getScriptRam()` (no separate RAM table).
- Self-disables if `ns.sleeve` is unavailable (Source-File 10 not present).

### Per-cycle behavior

For each sleeve `i in 0..ns.sleeve.getNumSleeves()-1`:

1. **Buy sleeve augs** affordable above `sleeves.cashReserve`.
2. **Shock recovery** if `shock > sleeves.shockThreshold` → assign `setToShockRecovery`.
3. **Bladeburner specialization** (if enabled and API available): if `i === sleeves.bladeburnerSleeveIndex`, run contracts/ops, then continue.
4. **Pick task** by walking `sleeves.prioritize` list:
   - `train-hacking` — `setToUniversityCourse(...)` until `trainingHackingLevel`.
   - `crime` — if `ns.heart.break() > -54000`: `setToCommitCrime("Homicide")`. Else: best money/sec crime.
   - `faction` — mirror main player's current faction work target by reading `factions_status.json` (do not duplicate Singularity calls).
   - `idle` — no-op.

### Sleeve module functions

- `main(ns)`, `run_cycle(ns)`.
- `disable_self(ns, reason)`.
- `collect_context(ns)` — karma, factions status, Bladeburner availability.
- `try_buy_sleeve_augs(ns, sleeveIndex, reserve)`.
- `pick_sleeve_task(ns, sleeveIndex, cfg, context)`.
- `assign_shock_recovery(ns, sleeveIndex)`.
- `assign_hacking_training(ns, sleeveIndex, cfg)`.
- `pick_crime_task(ns, sleeveIndex, context)`.
- `assign_crime(ns, sleeveIndex, crime)`.
- `assign_faction_mirror(ns, sleeveIndex, context)`.
- `assign_bladeburner(ns, sleeveIndex, context)` — gated.
- `summarize_sleeve(ns, sleeveIndex)`.
- `write_status(ns, status)`.

### Config (`config.sleeves`)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | bool | `true` | Disable module without removing it |
| `cashReserve` | number | `50_000_000` | Floor before buying sleeve augs |
| `shockThreshold` | number | `50` | Above this, force shock recovery |
| `trainingHackingLevel` | number | `100` | Stop university training at this level |
| `prioritize` | string[] | `["train-hacking","crime","faction","idle"]` | Task selection order |
| `bladeburnerSleeve` | bool | `false` | Dedicate one sleeve to Bladeburner |
| `bladeburnerSleeveIndex` | number | `0` | Which sleeve takes the Bladeburner role |

### Status file (`data/sleeves_status.json`)

```
{
  timestamp,
  enabled, apiAvailable, bladeburnerAvailable, karma,
  summary: { shock, training, crime, faction, idle, bladeburner },
  sleeves: [
    { index, shock, sync, stats, task: { type, detail }, moneyRate, augsPurchased }
  ]
}
```

### HUD / diag surfacing

- HUD adds a `sleeves.js` row, e.g. `shock2 crime5 fac1`.
- HUD adds compact install gate text on the `factions.js` row, e.g. `inst:dry 142x pend4` or `inst:ARM 142x`.
- HUD optionally adds a top-level `Install` row when armed.
- `diag.js` adds a `SLEEVES` section (per-sleeve detail + summary), extends the factions section with install-gate detail, and includes new files in data-file health output.

---

## Feature 3 — `github-sync-run.js` redesign

### Default behavior

- **Default = sync + run daemon.js** (kill existing automation first).
- `--no-run` is the new explicit sync-only flag.
- `--mode` remains as a deprecated alias for one release (logs a deprecation notice).
- `kill_running_automation(ns, entryFile)` is factored out and kills all home automation cleanly, not just the entry script.
- Existing `--` passthrough run-args behavior is preserved.

### File-list source: manifest-first, auto-discovery fallback

A new tracked file `sync-manifest.txt` at the repo root lists every file to sync, one repo-relative path per line. Lines starting with `#` are comments. Empty lines ignored.

Resolution order in `resolve_file_list(ns, options)`:

1. If `--files` was passed explicitly: use that list (current behavior preserved).
2. Else: try to fetch `sync-manifest.txt` from GitHub. If present and non-empty, use it as the authoritative list.
3. Else: fall back to recursive `repository_tree_listing()` filtered by `--extensions` (current behavior).

**Why manifest-first:**
- Adding a module is one extra line in the manifest — visible in PR diffs.
- Excludes documentation, scratch files, and `tmp_*` from the game side without per-file flag tuning.
- The fallback prevents catastrophic forgetting: if someone adds a module but skips the manifest, auto-discovery still pulls it.
- Logs which path was used (`manifest`, `auto-discovery`, or `--files`) so the player can confirm.

### Initial manifest contents

```
# Top-level
daemon.js
diag.js
github-sync-run.js
git-pull.js
stock-graph.js

# Modules
modules/buy-servers.js
modules/contracts.js
modules/deploy-lite.js
modules/factions.js
modules/hud.js
modules/manager.js
modules/root-lite.js
modules/root.js
modules/runtime-contracts.js
modules/sleeves.js
modules/stocks.js
modules/utils.js
```

`docs/`, `README`, and other repo-only files are intentionally omitted.

---

## Cross-cutting changes

### `runtime-contracts.js`

- Add file constants: `SLEEVES_STATUS_FILE`, `POST_INSTALL_BOOT_FILE`, `GITHUB_SYNC_RUN_SCRIPT`, `SYNC_MANIFEST_FILE`.
- Add module constants: `MODULE_FILES.SLEEVES`, `SLEEVES_MODULE_FILE`, `SLEEVES_LOOP_MS`.
- Register sleeves in `CORE_MODULES` and `MODULE_ROWS`.
- Extend `CONFIG_DEFAULTS.factions` with the four install keys.
- Add `CONFIG_DEFAULTS.sleeves` block.
- Extend `load_config()` merge logic to handle the new `sleeves` section.

### `daemon.js`

- Add `consume_post_install_boot_flag(ns)` — reads + deletes `/data/post_install_boot.txt`.
- Surface `postInstallResume` boot metadata in `module_status.json` for one cycle.
- No new bootstrap delay.

### Documentation updates

- `AGENTS.md`: rewrite guardrail #12; add `@import ./docs/agent-memory/sleeves.md`.
- `docs/agent-memory/factions.md`: replace "NEVER auto-installs" section with the armed/dry-run contract; document the four new config keys.
- `docs/agent-memory/sleeves.md`: NEW — API requirement, priority tokens, task rules, config keys, status schema.
- `docs/agent-memory/architecture.md`: add `sleeves_status.json`, `post_install_boot.txt`, `sync-manifest.txt` to the data-file inventory.
- `docs/agent-memory/strategy.md`: update late-game section to include sleeves and auto-install cadence.
- `docs/agent-memory/tooling.md`: update `github-sync-run.js` semantics to "sync + run by default; `--no-run` for sync-only; manifest-driven file list."

---

## Ship order (small commits)

1. **`github-sync-run.js`**: default sync+run, `--no-run`, manifest-first resolution, clean restart, tooling docs, `sync-manifest.txt` added.
2. **`runtime-contracts.js` + `factions.js` install-gate telemetry only**: config keys, status fields, HUD/diag surfacing. `autoInstall` defaults to `false`. No reset behavior yet — pure dry-run.
3. **`factions.js` install execution + daemon resume**: NFG buyout, `/data/post_install_boot.txt`, `trigger_auto_install`, `daemon.js` flag consumption, AGENTS.md guardrail rewrite, factions doc update.
4. **`modules/sleeves.js` core**: shock, training, crime, faction mirror, status file, runtime registration, sleeves doc, HUD/diag rows.
5. **Bladeburner sleeve specialization**: separate follow-up commit. Least stable; must not block core sleeve module.

---

## Coding-phase review process

Every commit goes through a **two-loop Codex review**:

1. **Loop 1 — pre-commit review (read-only):** Codex reviews the diff against this spec. Flags drift, bugs, missed edge cases, and divergence from the AGENTS.md guardrails.
2. **Loop 2 — post-fix verification (read-only):** After Claude addresses Loop 1 feedback, Codex re-reviews the updated diff to confirm fixes landed and no new issues were introduced.

Both loops use `--sandbox read-only`. The user controls model/effort selection per pass.

---

## Open questions

None — all major decisions resolved during brainstorming.

## Decisions resolved during brainstorming

- Auto-install enabled (override of guardrail #12, AGENTS.md to be updated).
- Trigger style: diminishing-returns / spend ratio (option B), not aug-count threshold.
- Install callback uses `github-sync-run.js` so post-install boot pulls latest first.
- Rep-blocked augs do not fire the install gate.
- NeuroFlux Governor excluded from gate, bought separately before install.
- Sync script default = sync + run; `--no-run` for sync-only.
- File list driven by manifest-first with auto-discovery fallback.
- Bladeburner sleeve role is a follow-up commit, not part of core sleeves module.
- Two-pass Codex review on every implementation commit.
