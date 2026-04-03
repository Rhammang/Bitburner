# Manager: Modes, Target Selection & State Transitions

## Manager Modes

### PREP
Single primary target under heavy weaken/grow. An optional income target (a
prepped server) is hacked lightly on the side for cash while the primary target
is being prepped. Income target is cached (`cached_income_target`) to prevent
oscillation — do not break this caching.

### HACK
All targets are prepped. Running pipelined HWGW batches across all available
hosts. Targets are scored by `maxMoney / weakenTime`.

### HYBRID
Some targets are prepped while others still need prep. Prep workers distribute
across purchased servers and home; batch workers run simultaneously on already-
prepped targets.

## Host Distribution

- `get_prep_hosts()` returns both home and remote hosts for distributed prep.
  Must continue to include both — do not restrict to one or the other.
- `get_actual_ram()` is used to filter out hosts whose max RAM is below the
  smallest worker cost (host fragmentation mitigation).

## State Files

- `manager_status.json` — written each cycle; contains: mode, active targets,
  prepDiag, batchDiag, and `derivedMetrics`. Do not remove `derivedMetrics`.
- `server_map.json` — scored target list with per-target PREP/HACK state.
