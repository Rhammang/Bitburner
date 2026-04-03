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
- **NEVER auto-installs**: The player decides when to reset and install augs.

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

## Status

Written to `data/factions_status.json` (JSON): aug counts, current activity,
backdoor/program progress, work target, pending installs, top affordable/need-
rep lists.
