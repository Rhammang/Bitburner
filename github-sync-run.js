// github-sync-run.js
// Pull scripts from GitHub then (by default) run an entry script.
//
// Default file list comes from sync-manifest.txt; auto-discovery is the fallback.
//
// Examples:
//   run github-sync-run.js                                  // sync + run daemon.js
//   run github-sync-run.js --no-run                         // sync only
//   run github-sync-run.js --entry modules/manager.js       // sync + run a different entry
//   run github-sync-run.js --files daemon.js modules/manager.js --no-run
//   run github-sync-run.js -- --verbose                     // sync + run daemon.js --verbose

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

export function autocomplete(data, args) {
  data.flags(argsSchema);
  const lastFlag = args.length > 1 ? args[args.length - 2] : null;
  if (lastFlag === "--mode") return ["sync", "run"]; // deprecated
  if (lastFlag === "--no-run") return ["true", "false"];
  if (lastFlag === "--entry" || lastFlag === "--files") return data.scripts;
  return [];
}

/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags(argsSchema);
  const options = parse_options(flags);

  if (options.legacyMode && !["sync", "run", ""].includes(options.legacyMode)) {
    ns.tprint(`ERROR: invalid --mode "${options.legacyMode}". Use --no-run for sync-only.`);
    return;
  }
  if (options.legacyMode) {
    ns.tprint(`NOTICE: --mode is deprecated; use --no-run for sync-only behavior.`);
  }

  const files = await resolve_file_list(ns, options);
  ns.tprint(`GITHUB sync source: ${options.fileSource} (${files.length} files)`);
  if (files.length === 0) {
    ns.tprint("WARNING: no files selected for download.");
    return;
  }

  const stats = await sync_files(ns, options, files);
  const commit_info = await fetch_latest_commit_info(ns, options);
  ns.tprint(
    `GITHUB SYNC: ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.failed} failed (${files.length} total) | latest commit: ${commit_info}`
  );

  if (!options.shouldRun) {
    ns.tprint(`GITHUB sync-only complete (--no-run set${options.legacyMode === "sync" ? " via legacy --mode sync" : ""}).`);
    return;
  }

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

async function resolve_file_list(ns, options) {
  if (options.files.length > 0) {
    options.fileSource = "explicit";
    return dedupe(options.files);
  }

  const manifest = await fetch_manifest(ns, options);
  if (Array.isArray(manifest) && manifest.length > 0) {
    options.fileSource = "manifest";
    return dedupe(manifest);
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

async function repository_tree_listing(ns, options) {
  const branch_ref = encodeURIComponent(options.branch);
  const url =
    `https://api.github.com/repos/${options.owner}/${options.repo}/git/trees/${branch_ref}?recursive=1`;
  const data = await fetch_json_via_wget(ns, url);
  if (!Array.isArray(data?.tree)) {
    throw new Error("Unexpected tree listing response");
  }

  return data.tree
    .filter((entry) => entry && entry.type === "blob")
    .map((entry) => normalize_repo_path(entry.path))
    .filter((path) => should_include_file(path, options.extensions));
}

async function repository_listing(ns, options, folder) {
  const folder_path = normalize_repo_path(folder);
  const url = `https://api.github.com/repos/${options.owner}/${options.repo}/contents/${folder_path}?ref=${options.branch}`;
  const data = await fetch_json_via_wget(ns, url);
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

async function fetch_json_via_wget(ns, url) {
  const separator = url.includes("?") ? "&" : "?";
  const temp_file = `tmp-github-sync-run-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`;
  const ok = await ns.wget(`${url}${separator}ts=${Date.now()}`, temp_file);
  if (!ok) {
    throw new Error("wget failed");
  }

  const raw = ns.read(temp_file).trim();
  ns.rm(temp_file, "home");
  if (!raw) {
    throw new Error("empty response");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON response");
  }
}

async function sync_files(ns, options, files) {
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const repo_file of files) {
    const local_file = join_path(options.prefix, repo_file);
    const old_content = ns.fileExists(local_file, "home") ? ns.read(local_file) : null;

    // Use GitHub Contents API instead of raw.githubusercontent.com to avoid
    // Fastly CDN caching (up to 5 min stale). The API returns fresh content.
    let new_content;
    try {
      new_content = await fetch_file_content(ns, options, repo_file);
    } catch (error) {
      if (options.verbose) ns.print(`API fetch failed for ${repo_file}: ${error}`);
      // Fallback to raw.githubusercontent.com
      new_content = await fetch_file_raw(ns, options, repo_file, local_file);
    }

    if (new_content === null) {
      failed += 1;
      ns.tprint(`  FAILED  ${repo_file}`);
      continue;
    }

    if (old_content === null) {
      updated += 1;
      await ns.write(local_file, new_content, "w");
      ns.tprint(`  NEW     ${repo_file}`);
    } else if (new_content !== old_content) {
      updated += 1;
      await ns.write(local_file, new_content, "w");
      ns.tprint(`  UPDATED ${repo_file}`);
    } else {
      unchanged += 1;
      ns.tprint(`  ok      ${repo_file}`);
    }
  }

  return { updated, unchanged, failed };
}

/** Fetch file content via GitHub Contents API (no CDN caching). */
async function fetch_file_content(ns, options, repo_file) {
  const encoded_path = repo_file.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${options.owner}/${options.repo}/contents/${encoded_path}?ref=${options.branch}`;
  const data = await fetch_json_via_wget(ns, url);
  if (!data || !data.content) throw new Error("no content in response");
  // GitHub returns base64-encoded content; decode it
  return atob(data.content.replace(/\n/g, ""));
}

/** Fallback: fetch from raw.githubusercontent.com (may be CDN-cached). */
async function fetch_file_raw(ns, options, repo_file, local_file) {
  const base_url = `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.branch}`;
  const remote = `${base_url}/${repo_file}?ts=${Date.now()}`;
  const ok = await ns.wget(remote, local_file);
  if (!ok) return null;
  return ns.read(local_file);
}

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

async function fetch_latest_commit_info(ns, options) {
  try {
    const url = `https://api.github.com/repos/${options.owner}/${options.repo}/commits/${encodeURIComponent(options.branch)}`;
    const data = await fetch_json_via_wget(ns, url);
    const date = data?.commit?.committer?.date || data?.commit?.author?.date;
    const msg = (data?.commit?.message || "").split("\n")[0].slice(0, 50);
    if (!date) return "unknown";
    const d = new Date(date);
    const ts = d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${ts} "${msg}"`;
  } catch {
    return "unavailable";
  }
}

function dedupe(items) {
  return [...new Set(items)];
}
