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

Pulls scripts from GitHub then (by default) launches an entry script.

**Default**: sync + run `daemon.js`. The script kills running home automation
first via `kill_running_automation()` so the new daemon brings everything up
clean.

**Flags**:

- `--no-run` — sync only, no entry script launch.
- `--entry <path>` — override entry script (default `daemon.js`).
- `--files a b c` — explicit file list (overrides manifest and discovery).
- `--no-kill-existing` — skip the home automation kill step.
- `-- <args>` — passthrough arguments to the entry script.
- `--mode sync|run` — DEPRECATED, use `--no-run` for sync-only.

**File-list resolution order**:

1. Explicit `--files` argument.
2. `sync-manifest.txt` fetched from GitHub (authoritative deploy list, no
   extension filter applied).
3. Recursive GitHub tree API listing (auto-discovery, extension-filtered).
4. Local `ns.ls("home")` if all of the above fail.

The script logs which path was used (`manifest`, `auto-discovery`,
`explicit`, or `local-fallback`).

**Adding a new module**: append the repo-relative path to
`sync-manifest.txt`. Auto-discovery is a safety net only — relying on it
means the module ships unannounced.

## git-pull.js

Simpler GitHub pull utility with automatic import rewriting for subfolder
deployments. Use when `github-sync-run.js` is overkill.
