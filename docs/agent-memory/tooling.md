# Tooling

## diag.js

Standalone diagnostic snapshot tool. Reads live state files and produces a
formatted report. Does not modify any game state.

**Output sections**: module status, manager state, live workers, RAM analysis,
target analysis, derived metrics, data file health.

**Flags**:
- `--tail` — continuously refresh the output
- `--json` — emit raw JSON instead of formatted text
- `--control` — include control-theory analysis (damping, settling time,
  spectrum) from the MetricsRing history

**Usage**: `run diag.js [--tail] [--json] [--control]`

## stock-graph.js

Standalone React/SVG stock chart viewer. Reads `/data/stocks_history.json`
(written by the stocks module) and renders price charts, signal charts, and
a watchlist with sparklines in a tail window.

**Flags**:

- `--sym ECP` — focus a specific symbol
- `--owned-only` — only show symbols with held positions
- `--sort value` — sort watchlist: `value`, `profit`, `adjusted`, `alpha`
- `--count 15` — max watchlist rows
- `--rotate 0` — auto-cycle focused symbol every N seconds (0 = off)
- `--refresh 2000` — render interval in ms

**Usage**: `run stock-graph.js [--sym ECP] [--owned-only] [--sort adjusted]`

## github-sync-run.js

Pulls files from a GitHub repository into the game and optionally launches an
entry script after sync.

**Modes**:
- `--mode sync` — pull files only
- `--mode run` — pull files then launch entry script

## git-pull.js

Simpler GitHub pull utility with automatic import rewriting for subfolder
deployments. Use when `github-sync-run.js` is overkill.
