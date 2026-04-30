# Sleeves Module

## API Requirement

`sleeves.js` requires the Sleeve API (Source-File 10). If `ns.sleeve` is
unavailable, the module writes a disabled status and exits.

## Per-cycle Behavior

For each sleeve `i in 0..ns.sleeve.getNumSleeves()-1`:

1. **Buy sleeve augmentations** affordable above `sleeves.cashReserve`
   (cheapest first; loop breaks on first unaffordable or failed purchase).
2. **Shock recovery** if `shock > sleeves.shockThreshold`. Preempts every
   later branch including Bladeburner.
3. **Bladeburner specialization** when `bladeburnerSleeve = true`, the
   sleeve index matches `bladeburnerSleeveIndex`, the API is present,
   and the player is in the division (`ns.bladeburner.inBladeburner()`).
   Action priority:
   - Try contracts in order of difficulty: Bounty Hunter, Retirement,
     Tracking. Skip if no remaining count or estimated success chance
     min < 70%. (Probes both `"Contract"` and `"Contracts"` type
     spellings; Bitburner has used both across versions.)
   - If any contract had wide chance variance (>15%), assign
     **Field Analysis** to tighten future estimates.
   - Else assign **Training** as a productive fallback.
   - Operations are intentionally NOT attempted via this selector
     until the sleeve API path for them is runtime-verified — they can
     be added later once stable.
   The module does not auto-join the division; the player must join
   manually. Until joined, the sleeve falls through to the next
   priority in `prioritize`.
4. **Pick task** by walking `sleeves.prioritize`:
   - `train-hacking` — Algorithms at Rothman University until
     `trainingHackingLevel`.
   - `crime` — Homicide while `karma > -54000` (Daedalus requirement),
     else best money/sec crime (currently Heist).
   - `faction` — mirror the main player's current faction work target
     by reading `factions_status.json`. The mirror prefers the recorded
     `workType` and rejects status data older than 5 minutes (avoids
     chasing a stale target if the factions module dies).
   - `idle` — `setToIdle`.

## Config Keys (`data/config.json` → `sleeves` section)

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | true | Disable module without removing it |
| `cashReserve` | number | 50_000_000 | Floor before buying sleeve augs |
| `shockThreshold` | number | 50 | Above this, force shock recovery |
| `trainingHackingLevel` | number | 100 | Stop university training at this hacking level |
| `prioritize` | string[] | `["train-hacking","crime","faction","idle"]` | Task selection order |
| `bladeburnerSleeve` | bool | false | Dedicate one sleeve to Bladeburner |
| `bladeburnerSleeveIndex` | number | 0 | Which sleeve takes the Bladeburner role |

## Status File

Written to `data/sleeves_status.json` each cycle:

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

The HUD adds a `Sleeves` row showing the summary counts; `diag.js` adds
a `SLEEVES` section with per-sleeve detail.

## Bitburner API surface used

`ns.sleeve.getNumSleeves`, `getSleeve`, `getSleevePurchasableAugs`,
`purchaseSleeveAug`, `setToShockRecovery`, `setToUniversityCourse`,
`setToCommitCrime`, `setToFactionWork`, `setToBladeburnerAction`,
`setToIdle`, `travel`. Plus `ns.heart.break()` for karma.
