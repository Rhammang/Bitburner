# Factions & Singularity Progression Model

## API Requirement

`factions.js` requires Singularity API (Source-File 4). If unavailable, the
module exits on its first cycle (self-disables).

## Automated Behaviors

- **Auto-buy programs**: Purchases TOR router and darkweb programs in a fixed
  priority order when cash exceeds `programReserve`.
- **Auto-backdoor**: Installs backdoors on faction servers (`CSEC`,
  `avmnite-02h`, `I.I.I.I`, `run4theh111z`) once they are rooted and hackable.
- **Auto-accept invitations**: Accepts pending faction invitations (respects
  `skipFactions` config).
- **Aug survey**: Surveys augmentations across all joined factions,
  deduplicating by picking the faction where the player has the most rep.
- **Faction work**: Works for the faction offering the most valuable
  unaffordable augmentation.
- **Training fallback**: Falls back to university hacking training, then
  megacorp/company work, when no faction reputation target exists.
- **Aug purchase**: Buys augmentations in descending price order (most
  expensive first) to minimize the compounding 1.9× price multiplier.
- **Install-gate telemetry**: Computes the diminishing-returns install gate
  each cycle and writes state to `factions_status.json` (`install` block).
  Auto-install is gated behind `autoInstall` (default `false`); when
  unarmed the gate is dry-run only. See "Install gate" below.

## Config Keys (`data/config.json` → `factions` section)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `autoBuy` | bool | true | Auto-purchase affordable augmentations |
| `cashReserve` | number | $50M | Minimum cash before buying augs |
| `workFocus` | string | "hacking" | Faction work type: "hacking", "field", "security" |
| `skipFactions` | string[] | [] | Factions to ignore |
| `autoPrograms` | bool | true | Buy TOR and darkweb programs |
| `programReserve` | number | $1M | Minimum cash before buying programs |
| `autoBackdoor` | bool | true | Auto-install eligible faction-server backdoors |
| `autoTraining` | bool | true | Train hacking when no faction rep target exists |
| `trainingHackingLevel` | number | 50 | Stop training once this hacking level is reached |
| `trainingCity` | string | Sector-12 | City for training fallback |
| `trainingUniversity` | string | Rothman University | University for training fallback |
| `trainingCourse` | string | Algorithms | Course for training fallback |
| `autoCompany` | bool | true | Work megacorp/company jobs when no faction rep target |
| `autoInstall` | bool | false | Master arming switch for auto-install (override of historical guardrail #12) |
| `installPriceRatio` | number | 100 | Spend-ratio threshold (×) — gate fires when next aug ≥ ratio × cheapest bought |
| `installMinAugs` | number | 3 | Minimum non-NFG pending augs before the gate can fire |
| `installCooldownMs` | number | 300000 | Cooldown after the most recent reset (aug or BitNode) |

## Install gate

Each cycle, after the aug-purchase pass, the module evaluates an install gate
that decides whether the run should reset. The gate fires when **all three**
hold:

1. **Spend ratio:** `nextAug.price >= installPriceRatio × cheapestBoughtThisCycle.price`,
   where `nextAug` is the cheapest *rep-qualified* unbought aug. NeuroFlux
   Governor is excluded from both legs. If no rep-qualified augs remain
   unbought, this leg auto-satisfies (nothing left to buy this cycle).
2. **Pending floor:** non-NFG pending installs ≥ `installMinAugs`.
3. **Cooldown:** time since the most recent reset (max of `lastAugReset`
   and `lastNodeReset`) ≥ `installCooldownMs`.

When the gate fires:

- `autoInstall = false` (default): write gate state to `factions_status.json`
  for HUD/diag (dry-run telemetry). No reset happens. The HUD shows
  `inst:DRY!` when the gate is satisfied but unarmed.
- `autoInstall = true`: trigger the install path (NFG buyout → write
  `data/post_install_boot.txt` → kill home scripts →
  `ns.singularity.installAugmentations("github-sync-run.js")`). The post-install
  callback re-pulls from GitHub before booting daemon.

See AGENTS.md guardrail #12 for the full safety contract.

## Status

Written to `data/factions_status.json` (JSON): aug counts, current activity,
backdoor/program progress, work target, pending installs, top affordable/need-
rep lists.
