# Metrics System

The system is modeled as a **closed-loop controller**: plant = game servers,
controller = `manager.js`, actuators = worker scripts, sensors = `ns.getServer*`
APIs. Derived metrics use control-theory concepts applied to discrete-time
samples collected each manager cycle.

## Data Flow

- `manager.js` computes instantaneous derived metrics each cycle and writes
  them as `derivedMetrics` in `manager_status.json`.
- HUD (`hud.js`) maintains an in-memory `MetricsRing` (120 samples) to compute
  trend and frequency metrics.
- `diag.js` reads the latest snapshot for point-in-time reports.

`MetricsRing` is in-memory only — no persistence. Trends reset on module
restart; this is acceptable since the ring fills within 2-4 minutes at normal
cycle rates.

## Metric Categories

### Efficiency
- `incomePerGB` — income normalized by RAM used
- `extractionRatio` — actual income / theoretical maximum
- `weakenTax` — defensive thread overhead fraction

### Utilization
- `ramUtilization` — fraction of total available RAM in use
- `hostActivation` — fraction of hosts running at least one worker
- `batchSlotUtilization` — fraction of batch timing slots used
- `targetCoverage` — fraction of viable targets being actively worked
- `hostFragmentation` — RAM fragmentation across hosts

### Health
- `batchSuccessRate` — fraction of batches completing without collision
- `execFailureRatio` — fraction of worker launches that failed
- `prepStability` — stability of security/money on targets under prep
- `securityDrift` — per-target security level above minimum
- `moneyRatio` — per-target money fraction of maximum
- Composite `systemScore` (A–F)

### Progress
- `prepETA` — estimated cycles to reach full HACK state
- Income trend (ring-buffer slope)
- Prep velocity (money and security convergence rates per cycle)

### Control Theory (HUD only — requires ring buffer history)
- `dampingEstimate` — log-decrement from security oscillation peaks
- `settlingTime` — cycles to steady state after mode change
- `incomeSpectrum` — DFT peak frequency and spectral spread
- `transferGain` — Δincome / Δthreads

## Key Thresholds

| Metric | Good | Warn |
|--------|------|------|
| `extractionRatio` | ≥ 0.5 | ≥ 0.2 |
| `ramUtilization` | ≥ 0.7 | ≥ 0.5 |
| `batchSuccessRate` | ≥ 0.9 | ≥ 0.5 |
| `securityDrift` | ≤ 0.05 | ≤ 0.2 |
| `prepStability` | ≥ 0.8 | ≥ 0.5 |

## MetricsRing

Shared ring buffer class defined in `runtime-contracts.js`. Used by HUD to
maintain a rolling 120-sample history for trend and frequency analysis.
In-memory only — do not add file-backed persistence unless explicitly requested.
