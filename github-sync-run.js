// github-sync-run.js
// Pull scripts from GitHub and optionally run an entry script.
//
// Examples:
//   run github-sync-run.js --mode sync
//   run github-sync-run.js --mode run --entry daemon.js
//   run github-sync-run.js --mode sync --files daemon.js modules/manager.js
//   run github-sync-run.js --mode run --entry daemon.js -- --verbose

const argsSchema = [
  ["owner", "Rhammang"],
  ["repo", "Bitburner"],
  ["branch", "main"],
  ["mode", "sync"], // sync | run
  ["entry", "daemon.js"],
  ["files", []], // explicit repo-relative file list to download
  ["prefix", ""], // local destination prefix (default root)
  ["extensions", [".js", ".ns", ".txt", ".script"]],
  ["recursive", true],
  ["kill-existing", true],
  ["run-args", []],
  ["verbose", false],
];

export function autocomplete(data, args) {
  data.flags(argsSchema);
  const lastFlag = args.length > 1 ? args[args.length - 2] : null;
  if (lastFlag === "--mode") return ["sync", "run"];
  if (lastFlag === "--entry" || lastFlag === "--files") return data.scripts;
  return [];
}

/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags(argsSchema);
  const options = parse_options(flags);

  if (!["sync", "run"].includes(options.mode)) {
    ns.tprint(`ERROR: invalid --mode "${options.mode}". Use "sync" or "run".`);
    return;
  }

  const files = await resolve_file_list(ns, options);
  if (files.length === 0) {
    ns.tprint("WARNING: no files selected for download.");
    return;
  }

  const stats = await sync_files(ns, options, files);
  ns.tprint(
    `GITHUB ${options.mode.toUpperCase()}: updated=${stats.updated} failed=${stats.failed} total=${files.length}`
  );

  if (options.mode !== "run") return;

  const entry_file = join_path(options.prefix, options.entry);
  if (!ns.fileExists(entry_file, "home")) {
    ns.tprint(`ERROR: entry script not found after sync: ${entry_file}`);
    return;
  }

  if (options.killExisting) {
    ns.scriptKill(entry_file, "home");
  }

  const pid = ns.exec(entry_file, "home", 1, ...options.runArgs);
  if (pid <= 0) {
    ns.tprint(`ERROR: failed to run ${entry_file}. Check home RAM or script args.`);
    return;
  }

  ns.tprint(`RUNNING: ${entry_file} (pid ${pid})`);
}

function parse_options(flags) {
  const explicit_run_args = Array.isArray(flags["run-args"]) ? flags["run-args"] : [];
  const passthrough_args = Array.isArray(flags._) ? flags._ : [];
  return {
    owner: String(flags.owner).trim(),
    repo: String(flags.repo).trim(),
    branch: String(flags.branch).trim(),
    mode: String(flags.mode).trim().toLowerCase(),
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

async function resolve_file_list(ns, options) {
  if (options.files.length > 0) {
    return dedupe(options.files);
  }

  try {
    const listed = await repository_listing(ns, options, "");
    return dedupe(listed);
  } catch (error) {
    ns.tprint(`WARNING: GitHub listing failed (${String(error)}). Falling back to local ls.`);
    return dedupe(
      ns
        .ls("home")
        .map(normalize_repo_path)
        .filter((path) => should_include_file(path, options.extensions))
    );
  }
}

async function repository_listing(ns, options, folder) {
  const folder_path = normalize_repo_path(folder);
  const url = `https://api.github.com/repos/${options.owner}/${options.repo}/contents/${folder_path}?ref=${options.branch}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected listing response");
  }

  let files = data
    .filter((entry) => entry.type === "file")
    .map((entry) => normalize_repo_path(entry.path))
    .filter((path) => should_include_file(path, options.extensions));

  if (!options.recursive) {
    return files;
  }

  const dirs = data.filter((entry) => entry.type === "dir").map((entry) => normalize_repo_path(entry.path));
  for (const dir of dirs) {
    try {
      files = files.concat(await repository_listing(ns, options, dir));
    } catch (error) {
      if (options.verbose) {
        ns.print(`Skipping ${dir}: ${String(error)}`);
      }
    }
  }

  return files;
}

async function sync_files(ns, options, files) {
  const base_url = `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.branch}`;
  let updated = 0;
  let failed = 0;

  for (const repo_file of files) {
    const local_file = join_path(options.prefix, repo_file);
    const remote = `${base_url}/${repo_file}?ts=${Date.now()}`;
    if (options.verbose) ns.print(`wget ${remote} -> ${local_file}`);

    const ok = await ns.wget(remote, local_file);
    if (ok) {
      updated += 1;
    } else {
      failed += 1;
      ns.tprint(`FAILED: ${repo_file}`);
    }
  }

  return { updated, failed };
}

function should_include_file(path, extensions) {
  return extensions.some((ext) => path.endsWith(ext));
}

function normalize_repo_path(path) {
  if (!path) return "";
  const normalized = String(path).replace(/\\/g, "/").replace(/^\.\//, "");
  return trim_slashes(normalized);
}

function trim_slashes(path) {
  if (!path) return "";
  let value = path;
  while (value.startsWith("/")) value = value.slice(1);
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
}

function join_path(prefix, path) {
  const left = trim_slashes(prefix || "");
  const right = trim_slashes(path || "");
  if (!left) return right;
  if (!right) return left;
  return `${left}/${right}`;
}

function dedupe(items) {
  return [...new Set(items)];
}
