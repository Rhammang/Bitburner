# Roadmap & Planned Work

## Next Modifications

- **Persistent metrics history**: Optional file-backed ring buffer for cross-
  restart trend analysis. Currently MetricsRing is in-memory only and resets
  on module restart. A file-backed option would allow HUD to resume trend
  analysis after a daemon restart without waiting for the ring to refill.

- **Adaptive hackPercent tuning**: Automatically adjust `hackPercent` based on
  observed extraction ratio trends. If extraction is consistently low, reduce
  hackPercent to improve batch success rates; if it is consistently high, allow
  more aggressive extraction.

## Future Plans

- Broader metrics history for cross-restart trend analysis (see above).
- Evaluate whether prepETA estimates can be improved with velocity-based
  convergence modeling.
