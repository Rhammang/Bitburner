# Auto-install + Sleeve Control + Sync Auto-start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship full automation of augmentation installs, sleeve control, and a manifest-driven github-sync auto-start, in five reviewable commits.

**Architecture:** Three coordinated additions. Cross-cutting changes go through `modules/runtime-contracts.js` (single source of truth). Each phase produces working, testable software on its own. Auto-install is gated behind `config.factions.autoInstall` (default `false`, dry-run telemetry only), with execution shipping in a separate commit after telemetry is confirmed correct.

**Tech Stack:** Bitburner JavaScript runtime (NetScript v2 + Singularity API + Sleeve API). No test framework — verification is `node --check <file>` for syntax, in-game reload, and status-file readback. Every commit goes through a **two-pass Codex review** (Loop 1: review diff; Loop 2: verify fixes).

**Reference spec:** [docs/superpowers/specs/2026-04-27-auto-install-sleeves-sync-design.md](../specs/2026-04-27-auto-install-sleeves-sync-design.md)

---

## Verification primitives used throughout

Each task uses these standard verification steps. Cited by reference rather than repeated.

- **VP-1 Syntax check:** `node --check <file>` — exits 0 if syntax is valid. Bitburner uses ES modules with `import`/`export` so `--input-type=module` is implied for `.js` files; if `node --check` complains about `import.meta` or top-level await it can be skipped, but the module-syntax errors we care about will surface either way.
- **VP-2 Codex Loop 1 review:** Read-only Codex review of the diff against this plan and the spec. Use `gpt-5.4` / `high`. Prompt template: *"Read the spec at docs/superpowers/specs/2026-04-27-auto-install-sleeves-sync-design.md and the plan at docs/superpowers/plans/2026-04-27-auto-install-sleeves-sync.md. Review the diff for Phase N Task M against the spec. Flag bugs, missed edge cases, drift from the spec, AGENTS.md guardrail violations, and architectural concerns. Be specific with file:line references."*
- **VP-3 Codex Loop 2 verification:** After Loop 1 fixes are applied, ask Codex (resume the same session) *"Verify the fixes for [list of Loop 1 issues] landed correctly and no new issues were introduced."*
- **VP-4 Status readback:** After in-game reload, `cat /data/<status_file>` (or read it inside Bitburner with `nano` / `cat`) and confirm the expected fields are present.
- **VP-5 Manual in-game reload:** The user re-runs `github-sync-run.js` (or `daemon.js` directly) to load the new code and observe behavior. Claude does not perform this step — pause and ask the user to confirm.

---

## File structure

**New files:**
- `sync-manifest.txt` — repo root, manifest of files to deploy.
- `modules/sleeves.js` — sleeve control module.
- `docs/agent-memory/sleeves.md` — sleeves doc.
- `data/post_install_boot.txt` — runtime-only flag (not checked in; `.gitignore` if needed, but `data/` is already gitignored implicitly by being game-runtime; verify during Phase 3).

**Modified files:**
- `github-sync-run.js` — manifest-first resolver, default sync+run, `--no-run` flag.
- `modules/runtime-contracts.js` — new constants, sleeves registration, factions/sleeves config defaults.
- `modules/factions.js` — install-gate telemetry (Phase 2), install execution (Phase 3).
- `modules/hud.js` — sleeves row, install-gate text on factions row.
- `modules/utils.js` — possibly extend, TBD per phase.
- `daemon.js` — post-install boot flag consumption.
- `diag.js` — sleeves section, install-gate detail.
- `AGENTS.md` — guardrail #12 rewrite, sleeves @import.
- `docs/agent-memory/factions.md` — armed/dry-run contract.
- `docs/agent-memory/architecture.md` — new data files inventory.
- `docs/agent-memory/strategy.md` — late-game updates.
- `docs/agent-memory/tooling.md` — github-sync-run new semantics.

---

# Phase 1 — github-sync-run.js rewrite + manifest

**Outcome:** Default behavior becomes "sync then run daemon." Manifest-first file resolution with auto-discovery fallback. Existing `--mode` flag still works as a deprecated alias.

### Task 1.1: Add manifest constant and create initial `sync-manifest.txt`

**Files:**
- Modify: `modules/runtime-contracts.js`
- Create: `sync-manifest.txt`

- [ ] **Step 1: Add `SYNC_MANIFEST_FILE` constant**

In `modules/runtime-contracts.js`, after line 15 (after `DISABLED_PREFIX`) add:

```javascript
export const SYNC_MANIFEST_FILE = "sync-manifest.txt";
export const POST_INSTALL_BOOT_FILE = `${DATA_DIR}post_install_boot.txt`;
export const GITHUB_SYNC_RUN_SCRIPT = "github-sync-run.js";
export const SLEEVES_STATUS_FILE = `${DATA_DIR}sleeves_status.json`;
```

- [ ] **Step 2: Run VP-1 syntax check**

```bash
node --check modules/runtime-contracts.js
```
Expected: exit 0.

- [ ] **Step 3: Create `sync-manifest.txt` at repo root**

```
# Bitburner deploy manifest
# One repo-relative path per line. # for comments.
# This file is the authoritative list for github-sync-run.js.
# When a new module is added, append it here.

# Top-level entry points
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

- [ ] **Step 4: Commit**

```bash
git add modules/runtime-contracts.js sync-manifest.txt
git commit -m "Add sync manifest and runtime constants for sync/sleeves/install paths"
```

### Task 1.2: Add manifest parser to `github-sync-run.js`

**Files:**
- Modify: `github-sync-run.js`

- [ ] **Step 1: Add manifest parser helper**

Add near other path helpers in `github-sync-run.js`:

```javascript
function parse_manifest(content) {
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(normalize_repo_path)
    .filter(Boolean);
}

async function fetch_manifest(ns, options) {
  try {
    const text = await fetch_file_content(ns, options, "sync-manifest.txt");
    return parse_manifest(text);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Run VP-1 syntax check**

```bash
node --check github-sync-run.js
```

- [ ] **Step 3: Codex Loop 1 (VP-2)** — focus on the manifest parser only

- [ ] **Step 4: Apply Loop 1 fixes**

- [ ] **Step 5: Codex Loop 2 (VP-3)**

- [ ] **Step 6: Commit**

```bash
git add github-sync-run.js
git commit -m "github-sync-run: add manifest parser helpers"
```

### Task 1.3: Wire manifest into `resolve_file_list`, log resolution path

**Files:**
- Modify: `github-sync-run.js`

- [ ] **Step 1: Replace `resolve_file_list`**

Replace the existing `resolve_file_list` with:

```javascript
async function resolve_file_list(ns, options) {
  if (options.files.length > 0) {
    options.fileSource = "explicit";
    return dedupe(options.files);
  }

  const manifest = await fetch_manifest(ns, options);
  if (Array.isArray(manifest) && manifest.length > 0) {
    options.fileSource = "manifest";
    return dedupe(manifest.filter((path) => should_include_file(path, options.extensions)));
  }

  try {
    options.fileSource = "auto-discovery";
    const listed = options.recursive
      ? await repository_tree_listing(ns, options)
      : await repository_listing(ns, options, "");
    return dedupe(listed);
  } catch (error) {
    options.fileSource = "local-fallback";
    ns.tprint(`WARNING: GitHub listing failed (${String(error)}). Falling back to local ls.`);
    return dedupe(
      ns
        .ls("home")
        .map(normalize_repo_path)
        .filter((path) => should_include_file(path, options.extensions))
    );
  }
}
```

- [ ] **Step 2: Log the resolution path in main**

In `main(ns)`, immediately after `const files = await resolve_file_list(...)`, add:

```javascript
ns.tprint(`GITHUB sync source: ${options.fileSource} (${files.length} files)`);
```

- [ ] **Step 3: VP-1**

- [ ] **Step 4: VP-2 Codex Loop 1**

- [ ] **Step 5: Apply fixes**

- [ ] **Step 6: VP-3 Codex Loop 2**

- [ ] **Step 7: Commit**

```bash
git add github-sync-run.js
git commit -m "github-sync-run: manifest-first resolution with auto-discovery fallback"
```

### Task 1.4: Default behavior = sync + run; add `--no-run`; deprecate `--mode`

**Files:**
- Modify: `github-sync-run.js`

- [ ] **Step 1: Update `argsSchema` and `parse_options`**

Replace the existing `argsSchema` block with:

```javascript
const argsSchema = [
  ["owner", "Rhammang"],
  ["repo", "Bitburner"],
  ["branch", "main"],
  ["mode", ""], // DEPRECATED: pre-existing flag; use --no-run instead
  ["no-run", false],
  ["entry", "daemon.js"],
  ["files", []],
  ["prefix", ""],
  ["extensions", [".js", ".ns", ".txt", ".script"]],
  ["recursive", true],
  ["kill-existing", true],
  ["run-args", []],
  ["verbose", false],
];
```

In `parse_options`, replace the `mode` derivation block with:

```javascript
function parse_options(flags) {
  const explicit_run_args = Array.isArray(flags["run-args"]) ? flags["run-args"] : [];
  const passthrough_args = Array.isArray(flags._) ? flags._ : [];
  const legacy_mode = String(flags.mode || "").trim().toLowerCase();
  const no_run_flag = Boolean(flags["no-run"]);
  const should_run = no_run_flag ? false : legacy_mode === "sync" ? false : true;
  return {
    owner: String(flags.owner).trim(),
    repo: String(flags.repo).trim(),
    branch: String(flags.branch).trim(),
    shouldRun: should_run,
    legacyMode: legacy_mode,
    entry: normalize_repo_path(String(flags.entry || "")),
    files: Array.isArray(flags.files) ? flags.files.map(normalize_repo_path).filter(Boolean) : [],
    prefix: trim_slashes(String(flags.prefix || "")),
    extensions: Array.isArray(flags.extensions) ? flags.extensions : [".js"],
    recursive: Boolean(flags.recursive),
    killExisting: Boolean(flags["kill-existing"]),
    runArgs: explicit_run_args.concat(passthrough_args),
    verbose: Boolean(flags.verbose),
  };
}
```

- [ ] **Step 2: Update `main(ns)` to honor `shouldRun`**

In `main(ns)`, replace the validation/branch block:

Old:
```javascript
if (!["sync", "run"].includes(options.mode)) {
  ns.tprint(`ERROR: invalid --mode "${options.mode}". Use "sync" or "run".`);
  return;
}
```
New:
```javascript
if (options.legacyMode && !["sync", "run", ""].includes(options.legacyMode)) {
  ns.tprint(`ERROR: invalid --mode "${options.legacyMode}". Use --no-run for sync-only.`);
  return;
}
if (options.legacyMode) {
  ns.tprint(`NOTICE: --mode is deprecated; use --no-run for sync-only behavior.`);
}
```

And replace the run-mode branch:
Old:
```javascript
if (options.mode !== "run") return;
```
New:
```javascript
if (!options.shouldRun) {
  ns.tprint(`GITHUB sync-only complete (--no-run set${options.legacyMode === "sync" ? " via legacy --mode sync" : ""}).`);
  return;
}
```

- [ ] **Step 3: Update `autocomplete`**

Replace:
```javascript
if (lastFlag === "--mode") return ["sync", "run"];
```
with:
```javascript
if (lastFlag === "--mode") return ["sync", "run"]; // deprecated
if (lastFlag === "--no-run") return ["true", "false"];
```

- [ ] **Step 4: VP-1 syntax check**

- [ ] **Step 5: VP-2 Codex Loop 1**

- [ ] **Step 6: Apply fixes**

- [ ] **Step 7: VP-3 Codex Loop 2**

- [ ] **Step 8: VP-5 Manual reload — pause and ask user to test**

User runs:
1. `run github-sync-run.js` → expect sync + daemon start, source=manifest
2. `run github-sync-run.js --no-run` → expect sync only, no daemon launch
3. `run github-sync-run.js --mode sync` → expect deprecation notice + sync only

Wait for user confirmation before continuing.

- [ ] **Step 9: Commit**

```bash
git add github-sync-run.js
git commit -m "github-sync-run: default sync+run, --no-run flag, deprecate --mode"
```

### Task 1.5: Factor `kill_running_automation`

**Files:**
- Modify: `github-sync-run.js`

- [ ] **Step 1: Add helper, replace inline kill**

Add helper:
```javascript
function kill_running_automation(ns, entry_file) {
  ns.scriptKill(entry_file, "home");
  // Daemon-managed module scripts also live on home. Kill them too so the
  // restarted daemon brings everything up clean.
  const home_scripts = ns.ps("home");
  for (const proc of home_scripts) {
    if (proc.filename === entry_file) continue;
    if (proc.filename === ns.getScriptName()) continue; // don't kill self
    ns.scriptKill(proc.filename, "home");
  }
}
```

In `main(ns)`, replace:
```javascript
if (options.killExisting) {
  ns.scriptKill(entry_file, "home");
}
```
with:
```javascript
if (options.killExisting) {
  kill_running_automation(ns, entry_file);
}
```

- [ ] **Step 2: VP-1**

- [ ] **Step 3: VP-2 Codex Loop 1** — pay particular attention to "do we kill the sync script's own pid"

- [ ] **Step 4: Apply fixes**

- [ ] **Step 5: VP-3 Codex Loop 2**

- [ ] **Step 6: Commit**

```bash
git add github-sync-run.js
git commit -m "github-sync-run: kill all automation on restart, not just entry script"
```

### Task 1.6: Update `docs/agent-memory/tooling.md`

**Files:**
- Modify: `docs/agent-memory/tooling.md`

- [ ] **Step 1: Read current contents and rewrite the github-sync-run section**

Replace the existing `github-sync-run.js` paragraph (read the file first with `Read` to find it) with:

```markdown
### `github-sync-run.js`

Pulls scripts from GitHub then optionally launches an entry script.

**Default:** sync + run `daemon.js` (kills running automation first via
`kill_running_automation`).

**Flags:**
- `--no-run` — sync only, no entry script launch.
- `--entry <path>` — override entry script (default `daemon.js`).
- `--files a b c` — explicit file list (overrides manifest and discovery).
- `-- <args>` — passthrough arguments to the entry script.
- `--mode sync|run` — DEPRECATED, use `--no-run` for sync-only.

**File-list resolution order:**
1. Explicit `--files` argument.
2. `sync-manifest.txt` fetched from GitHub (authoritative deploy list).
3. Recursive GitHub tree API listing (auto-discovery).
4. Local `ns.ls("home")` if all of the above fail.

The script logs which path was used (`manifest`, `auto-discovery`,
`explicit`, or `local-fallback`).

**Adding a new module:** append the repo-relative path to
`sync-manifest.txt`. Auto-discovery is a safety net only — relying on it
means the module ships unannounced.
```

- [ ] **Step 2: Commit**

```bash
git add docs/agent-memory/tooling.md
git commit -m "docs(tooling): document github-sync-run manifest-first behavior"
```

---

# Phase 2 — Install-gate telemetry (dry-run only)

**Outcome:** Factions module computes the install gate every cycle and writes telemetry to `factions_status.json`. HUD and diag surface it. `autoInstall` defaults `false` — no actual install happens yet.

### Task 2.1: Extend `runtime-contracts.js` config defaults

**Files:**
- Modify: `modules/runtime-contracts.js`

- [ ] **Step 1: Extend `CONFIG_DEFAULTS.factions`**

In the `factions` block of `CONFIG_DEFAULTS`, after `autoCompany: true,` add:

```javascript
    autoInstall: false,
    installPriceRatio: 100,
    installMinAugs: 3,
    installCooldownMs: 300_000,
```

- [ ] **Step 2: VP-1**

- [ ] **Step 3: Commit**

```bash
git add modules/runtime-contracts.js
git commit -m "runtime-contracts: add factions install-gate config defaults"
```

### Task 2.2: Add gate evaluation helpers to `factions.js`

**Files:**
- Modify: `modules/factions.js`

- [ ] **Step 1: Import new constant**

Update the existing `runtime-contracts` import to include `POST_INSTALL_BOOT_FILE`, `GITHUB_SYNC_RUN_SCRIPT` (used in Phase 3 but imported now to avoid a churn commit). For Phase 2 we only need the config keys, which already flow through `load_config`.

- [ ] **Step 2: Add `compute_cheapest_bought_this_cycle`**

```javascript
function compute_cheapest_bought_this_cycle(ns, pendingInstallNames) {
  if (!Array.isArray(pendingInstallNames) || pendingInstallNames.length === 0) {
    return null;
  }
  let cheapest = null;
  for (const name of pendingInstallNames) {
    if (name === "NeuroFlux Governor") continue;
    let price = Infinity;
    try {
      price = ns.singularity.getAugmentationPrice(name);
    } catch {
      continue;
    }
    if (!Number.isFinite(price)) continue;
    if (!cheapest || price < cheapest.price) {
      cheapest = { name, price };
    }
  }
  return cheapest;
}
```

- [ ] **Step 3: Add `compute_next_aug_target`**

```javascript
function compute_next_aug_target(remainingAugs) {
  if (!Array.isArray(remainingAugs)) return null;
  const repQualified = remainingAugs
    .filter((aug) => aug && aug.name !== "NeuroFlux Governor" && aug.affordable)
    .sort((left, right) => left.price - right.price);
  if (repQualified.length === 0) return null;
  const next = repQualified[0];
  return { name: next.name, faction: next.faction, price: next.price };
}
```

Note: `aug.affordable` in the existing `survey_augmentations` semantically means
"rep is sufficient" (see line 373: `affordable: rep >= repReq`). The gate does
NOT consider cash — being short on cash should not block reset.

- [ ] **Step 4: Add `evaluate_install_gate`**

```javascript
function evaluate_install_gate(ns, player, remainingAugs, pendingInstallNames, cfg) {
  const armed = cfg.autoInstall === true;
  const ratio = Math.max(1, Number(cfg.installPriceRatio) || 100);
  const minAugs = Math.max(1, Number(cfg.installMinAugs) || 3);
  const cooldownMs = Math.max(0, Number(cfg.installCooldownMs) || 300_000);

  const cheapest = compute_cheapest_bought_this_cycle(ns, pendingInstallNames);
  const next = compute_next_aug_target(remainingAugs);

  let bitNodeStartTime = 0;
  try {
    const reset = ns.getResetInfo();
    bitNodeStartTime = Number(reset?.lastNodeReset || reset?.lastAugReset || 0);
  } catch {
    bitNodeStartTime = 0;
  }
  const sinceReset = bitNodeStartTime > 0 ? Date.now() - bitNodeStartTime : Infinity;
  const cooldownActive = sinceReset < cooldownMs;
  const cooldownRemainingMs = cooldownActive ? Math.max(0, cooldownMs - sinceReset) : 0;

  const pendingCount = Array.isArray(pendingInstallNames) ? pendingInstallNames.length : 0;
  const minAugsSatisfied = pendingCount >= minAugs;

  let spendRatio = null;
  let priceGateSatisfied = false;
  if (next && cheapest && cheapest.price > 0) {
    spendRatio = next.price / cheapest.price;
    priceGateSatisfied = spendRatio >= ratio;
  } else if (!next && pendingCount > 0) {
    // No rep-qualified augs left to buy this cycle but we have purchases.
    spendRatio = Infinity;
    priceGateSatisfied = true;
  }

  const gateSatisfied =
    !cooldownActive && minAugsSatisfied && priceGateSatisfied;

  return {
    armed,
    gateSatisfied,
    wouldInstall: gateSatisfied,
    cooldownActive,
    cooldownRemainingMs,
    pendingInstallCount: pendingCount,
    installMinAugs: minAugs,
    installPriceRatio: ratio,
    cheapestBoughtThisCycle: cheapest,
    nextAugName: next ? next.name : null,
    nextAugPrice: next ? next.price : null,
    spendRatio,
    lastAction: "idle",
    neuroflux: { faction: null, purchased: 0, spent: 0 },
  };
}
```

- [ ] **Step 5: Add `maybe_log_install_dry_run`**

```javascript
function maybe_log_install_dry_run(ns, installState) {
  if (!installState.gateSatisfied) return;
  if (installState.armed) return;
  ns.print(
    `FACTIONS install-gate WOULD FIRE (dry-run): ratio=${
      installState.spendRatio === Infinity
        ? "inf"
        : (installState.spendRatio || 0).toFixed(1)
    } pending=${installState.pendingInstallCount} cheapestBought=${
      installState.cheapestBoughtThisCycle?.name || "n/a"
    } next=${installState.nextAugName || "none-rep-qualified"}`
  );
}
```

- [ ] **Step 6: Wire into `run_cycle`**

In `run_cycle`, after the `purchased` aug-buy block, before the existing `player = ns.getPlayer(); const installed = ...` block, replace this section:

Old (around lines 137-141):
```javascript
  player = ns.getPlayer();
  const installed = new Set(ns.singularity.getOwnedAugmentations(false));
  const all_owned = ns.singularity.getOwnedAugmentations(true);
  const pending_install = all_owned.filter((aug) => !installed.has(aug));
  const final_work = ns.singularity.getCurrentWork();
```

New:
```javascript
  player = ns.getPlayer();
  const installed = new Set(ns.singularity.getOwnedAugmentations(false));
  const all_owned = ns.singularity.getOwnedAugmentations(true);
  const pending_install = all_owned.filter((aug) => !installed.has(aug));
  const final_work = ns.singularity.getCurrentWork();

  // Recompute remaining augs after purchases this cycle so the install gate
  // sees the post-buy state.
  const post_buy_survey = survey_augmentations(ns, player, skip_factions);
  const installState = evaluate_install_gate(
    ns,
    player,
    [...post_buy_survey.affordable, ...post_buy_survey.needRep],
    pending_install,
    cfg
  );
  maybe_log_install_dry_run(ns, installState);
```

- [ ] **Step 7: Add `installState` to status payload**

In the `return { ... }` object of `run_cycle`, add `install: installState,` as a new field.

- [ ] **Step 8: VP-1 syntax check**

```bash
node --check modules/factions.js
```

- [ ] **Step 9: VP-2 Codex Loop 1**

Focus areas: rep-qualified semantics correct; cooldown using right reset timestamp; NFG exclusion on both legs; gate fires when no rep-qualified augs left + pending purchases exist.

- [ ] **Step 10: Apply fixes**

- [ ] **Step 11: VP-3 Codex Loop 2**

- [ ] **Step 12: VP-5 manual reload — confirm `factions_status.json` includes the `install` block**

User runs `run github-sync-run.js`, waits one factions cycle (~30s), then `cat /data/factions_status.json` to confirm new `install` field.

- [ ] **Step 13: Commit**

```bash
git add modules/factions.js
git commit -m "factions: install-gate telemetry (dry-run, autoInstall=false)"
```

### Task 2.3: HUD install-gate text on factions row

**Files:**
- Modify: `modules/hud.js`

- [ ] **Step 1: Read current `effectiveness_text` and the factions branch**

Use `Read` on `modules/hud.js` to find the `effectiveness_text(file, ...)` function and the `case MODULE_FILES.FACTIONS:` (or string-equivalent) branch.

- [ ] **Step 2: Append install-gate snippet to factions row**

Inside the factions branch of `effectiveness_text`, after the existing return value is computed but before it's returned, append a short suffix derived from `install`:

```javascript
const install = factionsStatus?.install;
let installText = "";
if (install) {
  const ratio = install.spendRatio === Infinity
    ? "inf"
    : install.spendRatio == null
    ? "-"
    : Math.round(install.spendRatio) + "x";
  if (install.armed) {
    installText = ` inst:ARM ${ratio} pend${install.pendingInstallCount}`;
  } else if (install.gateSatisfied) {
    installText = ` inst:DRY ${ratio} pend${install.pendingInstallCount}`;
  } else {
    installText = ` inst:- ${ratio} pend${install.pendingInstallCount}`;
  }
}
```

Then concatenate `installText` to whatever the function currently returns for the factions row.

(Adjust to match the actual structure of `effectiveness_text` once read — the goal is short, readable, and present every cycle.)

- [ ] **Step 3: VP-1**

- [ ] **Step 4: VP-2 Codex Loop 1**

- [ ] **Step 5: Apply fixes**

- [ ] **Step 6: VP-3 Codex Loop 2**

- [ ] **Step 7: Commit**

```bash
git add modules/hud.js
git commit -m "hud: surface factions install-gate state on factions row"
```

### Task 2.4: `diag.js` install-gate detail

**Files:**
- Modify: `diag.js`

- [ ] **Step 1: Locate the factions section of `diag.js`**

Use `Read` and `Grep` to find where the existing factions diagnostics are printed (likely around `factions_status.json` consumption).

- [ ] **Step 2: After existing factions detail, print install gate**

Add a block:

```javascript
const install = fac?.install;
if (install) {
  ns.tprint(`  install: armed=${install.armed} gate=${install.gateSatisfied}`);
  ns.tprint(`           pending=${install.pendingInstallCount}/${install.installMinAugs}`);
  ns.tprint(`           cheapestBought=${install.cheapestBoughtThisCycle?.name || "-"}`);
  ns.tprint(`           nextAug=${install.nextAugName || "-"}`);
  ns.tprint(
    `           ratio=${
      install.spendRatio === Infinity
        ? "inf"
        : install.spendRatio == null
        ? "-"
        : install.spendRatio.toFixed(1)
    }/${install.installPriceRatio} cooldownMs=${install.cooldownRemainingMs}`
  );
}
```

- [ ] **Step 3: VP-1**

- [ ] **Step 4: VP-2 Codex Loop 1**

- [ ] **Step 5: Apply fixes**

- [ ] **Step 6: VP-3 Codex Loop 2**

- [ ] **Step 7: Commit**

```bash
git add diag.js
git commit -m "diag: surface factions install-gate state"
```

### Task 2.5: Update `docs/agent-memory/factions.md` for telemetry

**Files:**
- Modify: `docs/agent-memory/factions.md`

- [ ] **Step 1: Replace the "NEVER auto-installs" line and add gate keys**

In `docs/agent-memory/factions.md`:

1. Replace:
   ```
   - **NEVER auto-installs**: The player decides when to reset and install augs.
   ```
   with:
   ```
   - **Install-gate telemetry**: Computes the diminishing-returns install gate
     each cycle and writes state to `factions_status.json`. Auto-install is
     gated behind `autoInstall` (default `false`); when unarmed the gate is
     dry-run only. See "Install gate" below.
   ```

2. Add the four new config rows to the config table:

```
| `autoInstall` | bool | false | Master arming switch for auto-install |
| `installPriceRatio` | number | 100 | Spend-ratio threshold |
| `installMinAugs` | number | 3 | Minimum pending augs to fire gate |
| `installCooldownMs` | number | 300000 | Post-reset cooldown |
```

3. Append a new "Install gate" section explaining the three conditions and the dry-run behavior. Keep it under 250 words.

- [ ] **Step 2: Commit**

```bash
git add docs/agent-memory/factions.md
git commit -m "docs(factions): document install-gate telemetry and config keys"
```

---

# Phase 3 — Install execution + daemon resume

**Outcome:** Setting `config.factions.autoInstall = true` actually triggers a reset when the gate fires. Daemon recognizes the post-install boot and proceeds normally.

### Task 3.1: Add `kill_all_scripts_except_self`

**Files:**
- Modify: `modules/factions.js`

- [ ] **Step 1: Add helper**

```javascript
function kill_all_scripts_except_self(ns) {
  const me = ns.getRunningScript();
  const my_pid = me?.pid;
  for (const proc of ns.ps("home")) {
    if (proc.pid === my_pid) continue;
    ns.scriptKill(proc.filename, "home");
  }
}
```

- [ ] **Step 2: VP-1**

- [ ] **Step 3: Commit**

```bash
git add modules/factions.js
git commit -m "factions: helper to kill all home scripts except current"
```

### Task 3.2: Add NeuroFlux helpers

**Files:**
- Modify: `modules/factions.js`

- [ ] **Step 1: Add helpers**

```javascript
function pick_neuroflux_faction(ns, player, skipFactions) {
  let best = null;
  for (const faction of player.factions) {
    if (skipFactions.has(faction)) continue;
    let augs = [];
    try {
      augs = ns.singularity.getAugmentationsFromFaction(faction);
    } catch {
      continue;
    }
    if (!augs.includes("NeuroFlux Governor")) continue;
    const rep = ns.singularity.getFactionRep(faction);
    if (!best || rep > best.rep) {
      best = { faction, rep };
    }
  }
  return best ? best.faction : null;
}

function buy_neuroflux_levels(ns, faction, cashReserve) {
  if (!faction) return { faction: null, purchased: 0, spent: 0 };
  let purchased = 0;
  let spent = 0;
  while (true) {
    let price = Infinity;
    let repReq = Infinity;
    try {
      price = ns.singularity.getAugmentationPrice("NeuroFlux Governor");
      repReq = ns.singularity.getAugmentationRepReq("NeuroFlux Governor");
    } catch {
      break;
    }
    const rep = ns.singularity.getFactionRep(faction);
    if (!Number.isFinite(price) || !Number.isFinite(repReq)) break;
    if (rep < repReq) break;
    if (ns.getPlayer().money - price < cashReserve) break;
    if (!ns.singularity.purchaseAugmentation(faction, "NeuroFlux Governor")) break;
    purchased += 1;
    spent += price;
  }
  return { faction, purchased, spent };
}
```

- [ ] **Step 2: VP-1**

- [ ] **Step 3: VP-2 Codex Loop 1**

- [ ] **Step 4: Apply fixes**

- [ ] **Step 5: VP-3 Codex Loop 2**

- [ ] **Step 6: Commit**

```bash
git add modules/factions.js
git commit -m "factions: NeuroFlux Governor buyout helpers"
```

### Task 3.3: Add `trigger_auto_install`

**Files:**
- Modify: `modules/factions.js`

- [ ] **Step 1: Ensure imports present**

Confirm the runtime-contracts import block includes `POST_INSTALL_BOOT_FILE` and `GITHUB_SYNC_RUN_SCRIPT` (added in Task 2.2).

- [ ] **Step 2: Add `trigger_auto_install`**

```javascript
async function trigger_auto_install(ns, installState) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    reason: "auto-install",
    spendRatio: installState.spendRatio,
    pendingCount: installState.pendingInstallCount,
    cheapestBought: installState.cheapestBoughtThisCycle,
    nextAug: installState.nextAugName,
    neuroflux: installState.neuroflux,
  }, null, 2);
  await ns.write(POST_INSTALL_BOOT_FILE, payload, "w");
  ns.tprint(
    `FACTIONS: AUTO-INSTALL firing — pending=${installState.pendingInstallCount} ratio=${
      installState.spendRatio === Infinity
        ? "inf"
        : (installState.spendRatio || 0).toFixed(1)
    }`
  );
  kill_all_scripts_except_self(ns);
  await ns.sleep(250); // let kills register before install
  ns.singularity.installAugmentations(GITHUB_SYNC_RUN_SCRIPT);
}
```

- [ ] **Step 3: VP-1**

- [ ] **Step 4: VP-2 Codex Loop 1** — Codex should validate that `installAugmentations` does not return (it triggers a hard reset), and that the boot flag is written *before* the kill.

- [ ] **Step 5: Apply fixes**

- [ ] **Step 6: VP-3 Codex Loop 2**

- [ ] **Step 7: Commit**

```bash
git add modules/factions.js
git commit -m "factions: trigger_auto_install writes flag, kills scripts, calls installAugmentations"
```

### Task 3.4: Wire armed install path into `run_cycle`

**Files:**
- Modify: `modules/factions.js`

- [ ] **Step 1: Replace the dry-run-only section**

In `run_cycle`, replace:

```javascript
maybe_log_install_dry_run(ns, installState);
```

with:

```javascript
if (installState.gateSatisfied && installState.armed) {
  const nf_faction = pick_neuroflux_faction(ns, player, skip_factions);
  installState.neuroflux = buy_neuroflux_levels(ns, nf_faction, cash_reserve);
  installState.lastAction = "installing";
  await trigger_auto_install(ns, installState);
  return {
    ...installState,
    factionCount: player.factions.length,
  };
} else {
  maybe_log_install_dry_run(ns, installState);
}
```

Note: when `trigger_auto_install` runs, `installAugmentations` resets the run, so the `return` after it is only defensive — the line will not actually execute in practice.

- [ ] **Step 2: VP-1**

- [ ] **Step 3: VP-2 Codex Loop 1**

- [ ] **Step 4: Apply fixes**

- [ ] **Step 5: VP-3 Codex Loop 2**

- [ ] **Step 6: VP-5 manual reload with `autoInstall=false`** — confirm dry-run still logs and no install fires.

- [ ] **Step 7: Commit**

```bash
git add modules/factions.js
git commit -m "factions: execute auto-install when gate fires and autoInstall=true"
```

### Task 3.5: Daemon consumes post-install boot flag

**Files:**
- Modify: `daemon.js`

- [ ] **Step 1: Add import**

Update the existing import block in `daemon.js` to include `POST_INSTALL_BOOT_FILE`:

```javascript
import {
  CORE_MODULES,
  DISABLED_PREFIX,
  LITE_BOOT_MODULES,
  MANAGER_MODULE_FILE,
  MODULE_FILES,
  MODULES_DIR,
  MODULE_STATUS_FILE,
  POST_INSTALL_BOOT_FILE,
  ROOT_MODULE_FILE,
  WORKER_SOURCES,
  load_config,
} from "/modules/runtime-contracts.js";
```

- [ ] **Step 2: Add `consume_post_install_boot_flag`**

Add as a top-level function in `daemon.js`:

```javascript
function consume_post_install_boot_flag(ns) {
  if (!ns.fileExists(POST_INSTALL_BOOT_FILE, "home")) {
    return null;
  }
  const raw = ns.read(POST_INSTALL_BOOT_FILE);
  ns.rm(POST_INSTALL_BOOT_FILE, "home");
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  ns.tprint("DAEMON: post-install resume detected");
  return parsed;
}
```

- [ ] **Step 3: Call it in `main` startup**

In `main(ns)`, after `ns.tprint("DAEMON v5.1: Starting up...");` add:

```javascript
const post_install = consume_post_install_boot_flag(ns);
```

And in the `boot` object initialization a few lines later, change to:
```javascript
const boot = {
  rootReady: false,
  managerReady: false,
  postInstallResume: post_install != null,
  postInstallTimestamp: post_install?.timestamp || null,
};
```

- [ ] **Step 4: Surface in `module_status.json` for one cycle**

Find the place where `module_status.json` is written (search for `MODULE_STATUS_FILE`). In the payload object, add `postInstallResume: boot.postInstallResume`. After the first successful write, set `boot.postInstallResume = false` so the marker only persists for one cycle.

- [ ] **Step 5: VP-1**

- [ ] **Step 6: VP-2 Codex Loop 1**

- [ ] **Step 7: Apply fixes**

- [ ] **Step 8: VP-3 Codex Loop 2**

- [ ] **Step 9: Commit**

```bash
git add daemon.js
git commit -m "daemon: consume post-install boot flag and surface marker once"
```

### Task 3.6: AGENTS.md guardrail rewrite

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace guardrail #12**

Replace:
```
12. The factions module must never auto-install augmentations. The player
    decides when to reset.
```

with:
```
12. Auto-install is permitted but must remain gated behind
    `config.factions.autoInstall` (default `false`). The install path must
    always go through `trigger_auto_install()`, which writes
    `/data/post_install_boot.txt` and uses `github-sync-run.js` as the
    install callback so a fresh GitHub pull precedes daemon boot. The
    install gate is the diminishing-returns rule defined in
    `evaluate_install_gate()`.
```

- [ ] **Step 2: Add sleeves @import (forward reference)**

In the "Detail Docs" section, add after the factions @import:

```
@import ./docs/agent-memory/sleeves.md
<!-- Sleeves module: shock recovery, task priorities, Bladeburner gating -->
```

The file doesn't exist yet — Phase 4 creates it. The @import will simply be a missing-file warning until then. (Confirm Claude Code's @import handles this gracefully; if it errors hard, defer this step until after Task 4.6 creates the file.)

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "AGENTS: rewrite guardrail #12 to reflect auto-install override"
```

### Task 3.7: Update `docs/agent-memory/architecture.md` and `factions.md` final form

**Files:**
- Modify: `docs/agent-memory/architecture.md`
- Modify: `docs/agent-memory/factions.md`

- [ ] **Step 1: Add `post_install_boot.txt` to architecture inventory**

In `architecture.md`, find the `/data/` inventory section and add a row:

```
| `post_install_boot.txt` | Written by `factions.js` immediately before `installAugmentations()`. Consumed and deleted by `daemon.js` on startup. JSON payload of install state. |
```

- [ ] **Step 2: Update `factions.md` install behavior section**

In `factions.md`, expand the Install gate section to cover the armed execution path: NFG buyout → write boot flag → kill scripts → `installAugmentations(github-sync-run.js)`. Reference AGENTS.md guardrail #12.

- [ ] **Step 3: Commit**

```bash
git add docs/agent-memory/architecture.md docs/agent-memory/factions.md
git commit -m "docs: document post-install boot flag and full install path"
```

---

# Phase 4 — Sleeves core module

**Outcome:** New `modules/sleeves.js` running each cycle. Sleeves get aug purchases, shock recovery, training, crime (Homicide for Daedalus karma when not yet met), and faction work mirroring. Bladeburner specialization is stubbed but disabled by default — full implementation deferred to Phase 5.

### Task 4.1: Register sleeves module in `runtime-contracts.js`

**Files:**
- Modify: `modules/runtime-contracts.js`

- [ ] **Step 1: Extend `MODULE_FILES`**

In `MODULE_FILES` add:
```javascript
  SLEEVES: "sleeves.js",
```

- [ ] **Step 2: Add module file constant**

After `FACTIONS_MODULE_FILE`:
```javascript
export const SLEEVES_MODULE_FILE = `${MODULES_DIR}${MODULE_FILES.SLEEVES}`;
```

- [ ] **Step 3: Add loop interval constant**

Near `FACTIONS_*` constants area:
```javascript
export const SLEEVES_LOOP_MS = 30000;
```

- [ ] **Step 4: Register in `CORE_MODULES`**

Append to `CORE_MODULES`:
```javascript
  { file: MODULE_FILES.SLEEVES, desc: "Sleeve Manager", interval: SLEEVES_LOOP_MS, bootCritical: false },
```

- [ ] **Step 5: Register in `MODULE_ROWS`**

Append to `MODULE_ROWS`:
```javascript
  { file: MODULE_FILES.SLEEVES, label: "Sleeves" },
```

- [ ] **Step 6: Add `CONFIG_DEFAULTS.sleeves`**

After the `factions: { ... }` block in `CONFIG_DEFAULTS`:

```javascript
  sleeves: {
    enabled: true,
    cashReserve: 50_000_000,
    shockThreshold: 50,
    trainingHackingLevel: 100,
    prioritize: ["train-hacking", "crime", "faction", "idle"],
    bladeburnerSleeve: false,
    bladeburnerSleeveIndex: 0,
  },
```

- [ ] **Step 7: Extend `load_config` merge**

Update the return block:

```javascript
    return {
      manager: { ...CONFIG_DEFAULTS.manager, ...user.manager },
      buyServers: { ...CONFIG_DEFAULTS.buyServers, ...user.buyServers },
      daemon: { ...CONFIG_DEFAULTS.daemon, ...user.daemon },
      factions: { ...CONFIG_DEFAULTS.factions, ...user.factions },
      sleeves: { ...CONFIG_DEFAULTS.sleeves, ...user.sleeves },
    };
```

- [ ] **Step 8: VP-1**

- [ ] **Step 9: Add manifest entry**

Confirm `sync-manifest.txt` already includes `modules/sleeves.js` (it was added in Task 1.1).

- [ ] **Step 10: Commit**

```bash
git add modules/runtime-contracts.js
git commit -m "runtime-contracts: register sleeves module and config defaults"
```

### Task 4.2: Skeleton `modules/sleeves.js` with self-disable + status writer

**Files:**
- Create: `modules/sleeves.js`

- [ ] **Step 1: Create skeleton**

```javascript
/**
 * Sleeve control module. Requires Source-File 10.
 *
 * Per cycle, for each sleeve:
 *   1. Buy sleeve augmentations when affordable (above sleeves.cashReserve).
 *   2. Shock recovery if shock > sleeves.shockThreshold.
 *   3. Bladeburner specialization (gated, deferred to Phase 5).
 *   4. Pick a task per sleeves.prioritize: train-hacking, crime, faction, idle.
 *
 * @param {NS} ns
 */

import {
  SLEEVES_LOOP_MS,
  SLEEVES_STATUS_FILE,
  FACTIONS_STATUS_FILE,
  load_config,
} from "/modules/runtime-contracts.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (typeof ns.sleeve === "undefined" || typeof ns.sleeve.getNumSleeves !== "function") {
    ns.tprint("SLEEVES: Sleeve API unavailable (need Source-File 10). Disabling.");
    await write_status(ns, {
      enabled: false,
      apiAvailable: false,
      bladeburnerAvailable: false,
      karma: 0,
      summary: { shock: 0, training: 0, crime: 0, faction: 0, idle: 0, bladeburner: 0 },
      sleeves: [],
      reason: "sleeve-api-missing",
    });
    return;
  }

  while (true) {
    try {
      const status = await run_cycle(ns);
      await write_status(ns, status);
    } catch (e) {
      ns.print(`SLEEVES: cycle error: ${e}`);
    }
    await ns.sleep(SLEEVES_LOOP_MS);
  }
}

async function run_cycle(ns) {
  const cfg = load_config(ns).sleeves || {};
  if (cfg.enabled === false) {
    return {
      enabled: false,
      apiAvailable: true,
      bladeburnerAvailable: false,
      karma: 0,
      summary: { shock: 0, training: 0, crime: 0, faction: 0, idle: 0, bladeburner: 0 },
      sleeves: [],
      reason: "disabled-by-config",
    };
  }

  const context = collect_context(ns);
  const num = ns.sleeve.getNumSleeves();
  const summary = { shock: 0, training: 0, crime: 0, faction: 0, idle: 0, bladeburner: 0 };
  const sleeves = [];

  for (let i = 0; i < num; i++) {
    const augsPurchased = try_buy_sleeve_augs(ns, i, cfg.cashReserve);
    const task = pick_sleeve_task(ns, i, cfg, context);
    summary[task.type] = (summary[task.type] || 0) + 1;
    sleeves.push({ ...summarize_sleeve(ns, i), task, augsPurchased });
  }

  return {
    enabled: true,
    apiAvailable: true,
    bladeburnerAvailable: context.bladeburnerAvailable,
    karma: context.karma,
    summary,
    sleeves,
  };
}

function collect_context(ns) {
  let karma = 0;
  try {
    karma = ns.heart.break();
  } catch {
    karma = 0;
  }
  let bladeburnerAvailable = false;
  try {
    bladeburnerAvailable =
      typeof ns.bladeburner !== "undefined" &&
      typeof ns.bladeburner.getCurrentAction === "function";
  } catch {
    bladeburnerAvailable = false;
  }
  let factionsStatus = null;
  try {
    const raw = ns.read(FACTIONS_STATUS_FILE);
    factionsStatus = raw ? JSON.parse(raw) : null;
  } catch {
    factionsStatus = null;
  }
  return { karma, bladeburnerAvailable, factionsStatus };
}

function try_buy_sleeve_augs(ns, sleeveIndex, reserve) {
  const minReserve = Math.max(0, Number(reserve) || 0);
  let purchased = 0;
  let augs = [];
  try {
    augs = ns.sleeve.getSleevePurchasableAugs(sleeveIndex);
  } catch {
    return 0;
  }
  if (!Array.isArray(augs) || augs.length === 0) return 0;
  augs.sort((a, b) => a.cost - b.cost);
  for (const aug of augs) {
    if (ns.getPlayer().money - aug.cost < minReserve) break;
    if (ns.sleeve.purchaseSleeveAug(sleeveIndex, aug.name)) {
      purchased += 1;
    } else {
      break;
    }
  }
  return purchased;
}

function summarize_sleeve(ns, sleeveIndex) {
  let info = null;
  try {
    info = ns.sleeve.getSleeve(sleeveIndex);
  } catch {
    info = null;
  }
  return {
    index: sleeveIndex,
    shock: info?.shock ?? null,
    sync: info?.sync ?? null,
    stats: info ? {
      hacking: info.skills?.hacking ?? null,
      strength: info.skills?.strength ?? null,
      defense: info.skills?.defense ?? null,
      dexterity: info.skills?.dexterity ?? null,
      agility: info.skills?.agility ?? null,
      charisma: info.skills?.charisma ?? null,
    } : null,
    moneyRate: null,
  };
}

async function write_status(ns, status) {
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), ...status }, null, 2);
  await ns.write(SLEEVES_STATUS_FILE, payload, "w");
}

function pick_sleeve_task(ns, sleeveIndex, cfg, context) {
  // Phase 4.3 fills in real assignment logic.
  return { type: "idle", detail: "stub" };
}
```

- [ ] **Step 2: VP-1**

```bash
node --check modules/sleeves.js
```

- [ ] **Step 3: VP-2 Codex Loop 1**

- [ ] **Step 4: Apply fixes**

- [ ] **Step 5: VP-3 Codex Loop 2**

- [ ] **Step 6: Commit**

```bash
git add modules/sleeves.js
git commit -m "sleeves: skeleton module with API check, aug purchase, status writer"
```

### Task 4.3: Real `pick_sleeve_task` with shock + priorities

**Files:**
- Modify: `modules/sleeves.js`

- [ ] **Step 1: Replace `pick_sleeve_task` and add assignment helpers**

```javascript
function pick_sleeve_task(ns, sleeveIndex, cfg, context) {
  let info = null;
  try {
    info = ns.sleeve.getSleeve(sleeveIndex);
  } catch {
    return { type: "idle", detail: "no-info" };
  }

  if (info?.shock != null && info.shock > Number(cfg.shockThreshold ?? 50)) {
    if (assign_shock_recovery(ns, sleeveIndex)) {
      return { type: "shock", detail: `shock=${info.shock.toFixed(1)}` };
    }
  }

  if (
    cfg.bladeburnerSleeve === true &&
    sleeveIndex === Number(cfg.bladeburnerSleeveIndex || 0) &&
    context.bladeburnerAvailable
  ) {
    const bb = assign_bladeburner(ns, sleeveIndex, context);
    if (bb) return { type: "bladeburner", detail: bb };
  }

  const priorities = Array.isArray(cfg.prioritize) && cfg.prioritize.length > 0
    ? cfg.prioritize
    : ["train-hacking", "crime", "faction", "idle"];

  for (const priority of priorities) {
    if (priority === "train-hacking") {
      const targetLevel = Number(cfg.trainingHackingLevel || 100);
      const hacking = info?.skills?.hacking ?? 0;
      if (hacking < targetLevel) {
        if (assign_hacking_training(ns, sleeveIndex)) {
          return { type: "training", detail: `hacking ${hacking}/${targetLevel}` };
        }
      }
    } else if (priority === "crime") {
      const crime = pick_crime_task(ns, sleeveIndex, context);
      if (crime && assign_crime(ns, sleeveIndex, crime)) {
        return { type: "crime", detail: crime };
      }
    } else if (priority === "faction") {
      const result = assign_faction_mirror(ns, sleeveIndex, context);
      if (result) return { type: "faction", detail: result };
    } else if (priority === "idle") {
      try {
        ns.sleeve.setToIdle(sleeveIndex);
      } catch {
        // ignore
      }
      return { type: "idle", detail: "configured" };
    }
  }
  return { type: "idle", detail: "fallthrough" };
}

function assign_shock_recovery(ns, sleeveIndex) {
  try {
    return ns.sleeve.setToShockRecovery(sleeveIndex) === true;
  } catch {
    return false;
  }
}

function assign_hacking_training(ns, sleeveIndex) {
  try {
    return (
      ns.sleeve.travel(sleeveIndex, "Sector-12") &&
      ns.sleeve.setToUniversityCourse(sleeveIndex, "Rothman University", "Algorithms") === true
    );
  } catch {
    return false;
  }
}

function pick_crime_task(ns, sleeveIndex, context) {
  if (context.karma > -54000) {
    return "Homicide";
  }
  // After Daedalus karma met, fall back to the historically best money/sec crime.
  return "Heist";
}

function assign_crime(ns, sleeveIndex, crime) {
  try {
    return ns.sleeve.setToCommitCrime(sleeveIndex, crime) === true;
  } catch {
    return false;
  }
}

function assign_faction_mirror(ns, sleeveIndex, context) {
  const work = context.factionsStatus?.workTarget;
  if (!work || !work.faction) return null;
  const types = ["hacking", "field", "security"];
  for (const type of types) {
    try {
      if (ns.sleeve.setToFactionWork(sleeveIndex, work.faction, type) === true) {
        return `${work.faction}:${type}`;
      }
    } catch {
      // try next type
    }
  }
  return null;
}

function assign_bladeburner(ns, sleeveIndex, context) {
  // Phase 5 fills this in.
  try {
    if (ns.sleeve.setToBladeburnerAction(sleeveIndex, "Field analysis")) {
      return "field-analysis";
    }
  } catch {
    // ignore
  }
  return null;
}
```

- [ ] **Step 2: VP-1**

- [ ] **Step 3: VP-2 Codex Loop 1** — Codex should validate API method names against current Bitburner docs (`setToFactionWork` vs `workForFaction`, `setToUniversityCourse` arg order, `setToCommitCrime` return shape). If any divergence is found, fix and re-check.

- [ ] **Step 4: Apply fixes**

- [ ] **Step 5: VP-3 Codex Loop 2**

- [ ] **Step 6: VP-5 manual reload — confirm `sleeves_status.json` shows tasks per sleeve**

- [ ] **Step 7: Commit**

```bash
git add modules/sleeves.js
git commit -m "sleeves: shock recovery, training, crime, faction mirror task selection"
```

### Task 4.4: HUD sleeves row

**Files:**
- Modify: `modules/hud.js`

- [ ] **Step 1: Import `SLEEVES_STATUS_FILE`**

Add to existing `runtime-contracts` import in `hud.js`.

- [ ] **Step 2: Read sleeves status in `read_metrics` (or equivalent)**

Find the function that reads other status files. Add:

```javascript
let sleevesStatus = null;
try {
  const raw = ns.read(SLEEVES_STATUS_FILE);
  sleevesStatus = raw ? JSON.parse(raw) : null;
} catch {
  sleevesStatus = null;
}
```

Pass `sleevesStatus` through the same pipeline that delivers `factionsStatus` to `effectiveness_text`.

- [ ] **Step 3: Add sleeves branch to `effectiveness_text`**

Add a case for `MODULE_FILES.SLEEVES` (or `"sleeves.js"`):

```javascript
if (sleevesStatus && sleevesStatus.enabled) {
  const s = sleevesStatus.summary || {};
  const parts = [];
  if (s.shock) parts.push(`shock${s.shock}`);
  if (s.training) parts.push(`train${s.training}`);
  if (s.crime) parts.push(`crime${s.crime}`);
  if (s.faction) parts.push(`fac${s.faction}`);
  if (s.bladeburner) parts.push(`bb${s.bladeburner}`);
  if (s.idle) parts.push(`idle${s.idle}`);
  return parts.length ? parts.join(" ") : "no-sleeves";
}
return sleevesStatus?.reason || "off";
```

- [ ] **Step 4: VP-1**

- [ ] **Step 5: VP-2 Codex Loop 1**

- [ ] **Step 6: Apply fixes**

- [ ] **Step 7: VP-3 Codex Loop 2**

- [ ] **Step 8: Commit**

```bash
git add modules/hud.js
git commit -m "hud: surface sleeves summary row"
```

### Task 4.5: `diag.js` SLEEVES section

**Files:**
- Modify: `diag.js`

- [ ] **Step 1: Import `SLEEVES_STATUS_FILE`**

- [ ] **Step 2: Read sleeves status alongside other status files**

- [ ] **Step 3: Print SLEEVES section after factions section**

```javascript
ns.tprint("=== SLEEVES ===");
if (!sleevesStatus) {
  ns.tprint("  (no sleeves_status.json)");
} else if (!sleevesStatus.enabled) {
  ns.tprint(`  disabled: ${sleevesStatus.reason || "off"}`);
} else {
  const s = sleevesStatus.summary || {};
  ns.tprint(
    `  summary: shock=${s.shock || 0} train=${s.training || 0} crime=${s.crime || 0} fac=${s.faction || 0} bb=${s.bladeburner || 0} idle=${s.idle || 0}`
  );
  for (const sl of sleevesStatus.sleeves || []) {
    ns.tprint(
      `  [${sl.index}] task=${sl.task?.type || "-"}:${sl.task?.detail || ""} shock=${
        sl.shock != null ? sl.shock.toFixed(1) : "-"
      } sync=${sl.sync != null ? sl.sync.toFixed(1) : "-"} hack=${sl.stats?.hacking ?? "-"} augs+${sl.augsPurchased || 0}`
    );
  }
}
```

- [ ] **Step 4: VP-1**

- [ ] **Step 5: VP-2 + Loop 2 + apply fixes**

- [ ] **Step 6: Commit**

```bash
git add diag.js
git commit -m "diag: add SLEEVES section with per-sleeve detail"
```

### Task 4.6: `docs/agent-memory/sleeves.md` and architecture index

**Files:**
- Create: `docs/agent-memory/sleeves.md`
- Modify: `docs/agent-memory/architecture.md`

- [ ] **Step 1: Create `docs/agent-memory/sleeves.md`**

```markdown
# Sleeves Module

## API Requirement

`sleeves.js` requires the Sleeve API (Source-File 10). If `ns.sleeve` is
unavailable, the module writes a disabled status and exits.

## Per-cycle Behavior

For each sleeve `i in 0..ns.sleeve.getNumSleeves()-1`:

1. **Buy sleeve augmentations** affordable above `sleeves.cashReserve`.
2. **Shock recovery** if `shock > sleeves.shockThreshold`.
3. **Bladeburner specialization** when enabled and the sleeve index matches
   `sleeves.bladeburnerSleeveIndex`. Disabled by default; full
   implementation lives in a follow-up commit.
4. **Pick task** by walking `sleeves.prioritize`:
   - `train-hacking` — Algorithms at Rothman University until
     `trainingHackingLevel`.
   - `crime` — Homicide while `karma > -54000` (Daedalus requirement),
     else best money/sec crime (currently Heist).
   - `faction` — mirror the main player's current faction work target by
     reading `factions_status.json`. Avoids duplicating Singularity calls.
   - `idle` — `setToIdle`.

## Config Keys (`data/config.json` → `sleeves` section)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | true | Disable module without removing it |
| `cashReserve` | number | 50_000_000 | Floor before buying sleeve augs |
| `shockThreshold` | number | 50 | Above this, force shock recovery |
| `trainingHackingLevel` | number | 100 | Stop university training at this level |
| `prioritize` | string[] | `["train-hacking","crime","faction","idle"]` | Task selection order |
| `bladeburnerSleeve` | bool | false | Dedicate one sleeve to Bladeburner |
| `bladeburnerSleeveIndex` | number | 0 | Which sleeve takes the Bladeburner role |

## Status File

Written to `data/sleeves_status.json`. Top-level `enabled`, `apiAvailable`,
`bladeburnerAvailable`, `karma`, `summary` (counts by assignment type), and
per-sleeve `index`, `shock`, `sync`, `stats`, `task`, `moneyRate`,
`augsPurchased`.
```

- [ ] **Step 2: Add `sleeves_status.json` to `architecture.md` data inventory**

```
| `sleeves_status.json` | Written by `sleeves.js` each cycle. Per-sleeve assignments, shock, sync, stats, augs purchased. Consumed by `hud.js` and `diag.js`. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-memory/sleeves.md docs/agent-memory/architecture.md
git commit -m "docs(sleeves): full module reference + architecture inventory entry"
```

### Task 4.7: Update `docs/agent-memory/strategy.md`

**Files:**
- Modify: `docs/agent-memory/strategy.md`

- [ ] **Step 1: Append late-game section additions**

Read the strategy doc, find the late-game section, and add bullet points for:
- Auto-install cadence (gate fires when next aug ≥ 100× cheapest bought, ≥3 pending, post-cooldown).
- Sleeves grinding Homicide for Daedalus karma until `karma <= -54000`.
- Sleeves mirror main player's faction rep grind target.
- Bladeburner sleeve specialization deferred until SF7.

- [ ] **Step 2: Commit**

```bash
git add docs/agent-memory/strategy.md
git commit -m "docs(strategy): late-game updates for auto-install + sleeves"
```

---

# Phase 5 — Bladeburner sleeve specialization (deferred)

**Outcome:** When `config.sleeves.bladeburnerSleeve = true` and the Bladeburner API + division are available, the dedicated sleeve runs Bladeburner contracts/operations.

> **Ship gate:** Phase 5 is intentionally separated. Do not start until Phases 1–4 are deployed and observed working in-game for at least one full reset cycle.

### Task 5.1: Bladeburner readiness check

**Files:**
- Modify: `modules/sleeves.js`

- [ ] **Step 1: Replace stub `assign_bladeburner` with action selector**

```javascript
function assign_bladeburner(ns, sleeveIndex, context) {
  try {
    if (typeof ns.bladeburner.joinBladeburnerDivision === "function") {
      ns.bladeburner.joinBladeburnerDivision(); // safe no-op if already joined
    }
  } catch {
    return null;
  }

  const candidates = [
    ["Operations", "Investigation"],
    ["Operations", "Undercover Operation"],
    ["Contracts", "Tracking"],
    ["Contracts", "Bounty Hunter"],
    ["Contracts", "Retirement"],
    ["General", "Field Analysis"],
  ];

  for (const [type, action] of candidates) {
    try {
      const remaining = ns.bladeburner.getActionCountRemaining
        ? ns.bladeburner.getActionCountRemaining(type, action)
        : null;
      if (remaining != null && remaining <= 0) continue;
      const chance = ns.bladeburner.getActionEstimatedSuccessChance
        ? ns.bladeburner.getActionEstimatedSuccessChance(type, action)
        : [1, 1];
      const minChance = Array.isArray(chance) ? chance[0] : 1;
      if (minChance < 0.7 && type !== "General") continue;
      if (ns.sleeve.setToBladeburnerAction(sleeveIndex, action)) {
        return `${type}:${action}`;
      }
    } catch {
      // try next
    }
  }
  // Fallback: training
  try {
    if (ns.sleeve.setToBladeburnerAction(sleeveIndex, "Training")) {
      return "training";
    }
  } catch {
    // ignore
  }
  return null;
}
```

- [ ] **Step 2: VP-1**

- [ ] **Step 3: VP-2 Codex Loop 1** — Codex should verify `setToBladeburnerAction` accepts only the action name (not type), and that action names match what the API expects.

- [ ] **Step 4: Apply fixes**

- [ ] **Step 5: VP-3 Codex Loop 2**

- [ ] **Step 6: Commit**

```bash
git add modules/sleeves.js
git commit -m "sleeves: real Bladeburner action selection (gated by config)"
```

### Task 5.2: Update `docs/agent-memory/sleeves.md`

**Files:**
- Modify: `docs/agent-memory/sleeves.md`

- [ ] **Step 1: Replace the deferred-implementation note with the actual contract**

Update the Bladeburner specialization bullet to describe the action priority list, success-chance gate (≥70% for non-General), and fallback to Training.

- [ ] **Step 2: Commit**

```bash
git add docs/agent-memory/sleeves.md
git commit -m "docs(sleeves): document Bladeburner action selection"
```

---

## Self-review

Re-checking the plan against the spec:

**Spec coverage:**
- Install gate semantics (3 conditions, NFG excluded, dry-run/armed split): Tasks 2.2, 3.4 ✓
- Install execution (NFG buyout, boot flag, kill scripts, github-sync-run callback): Tasks 3.2–3.4 ✓
- Daemon resume: Task 3.5 ✓
- Sleeve module + per-cycle behavior: Tasks 4.2, 4.3 ✓
- Sleeve config: Task 4.1 ✓
- Sleeve status file: Task 4.2 (write_status) ✓
- HUD/diag surfacing: Tasks 2.3, 2.4, 4.4, 4.5 ✓
- github-sync-run rewrite + manifest + kill_running_automation: Tasks 1.2–1.5 ✓
- Documentation updates: Tasks 1.6, 2.5, 3.6, 3.7, 4.6, 4.7, 5.2 ✓
- AGENTS.md guardrail rewrite: Task 3.6 ✓
- Two-pass Codex review per commit: VP-2/VP-3 referenced in every code task ✓

**Placeholder scan:** No "TBD" / "implement later" / "similar to" markers in any code step. The Bladeburner stub in Task 4.3 is intentional — it's wired to a real implementation in Task 5.1.

**Type consistency:**
- `installState` shape matches between `evaluate_install_gate` (Task 2.2) and `trigger_auto_install` (Task 3.3) ✓
- `pick_sleeve_task` returns `{ type, detail }` consistently across Tasks 4.2 (stub) and 4.3 (real) ✓
- `summary` keys match between `run_cycle` summary init (Task 4.2), `pick_sleeve_task` summary increments (Task 4.3), and HUD/diag readers (Tasks 4.4, 4.5) ✓
- `sleeves_status.json` schema matches between writer (Task 4.2) and consumers (Tasks 4.4, 4.5, doc 4.6) ✓

Plan saved to `docs/superpowers/plans/2026-04-27-auto-install-sleeves-sync.md`.
