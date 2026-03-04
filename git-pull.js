// git-pull.js
// A simple script to pull files from a GitHub repository into your home server
// based on a template posted by another player.  Defaults have been set to your
// own repository (Rhammang/Bitburner) so you can download updates with one
// command.

let options;
const argsSchema = [
    ['github', 'Rhammang'],
    ['repository', 'Bitburner'],
    ['branch', 'main'],
    ['download', []],           // explicit list of files to grab (defaults to all)
    ['new-file', []],           // additional filenames to try if repo listing fails
    ['subfolder', ''],          // save into a sub‑folder
    ['extension', ['.js', '.ns', '.txt', '.script']],
    ['omit-folder', ['Temp/']], // ignore these when falling back to ns.ls
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (['--download', '--subfolder', '--omit-folder'].includes(lastFlag)) {
        return data.scripts;
    }
    return [];
}

/**
 * @param {NS} ns
 * Pull a set of files from the configured GitHub repository.
 *
 * Usage:
 *   run git-pull.js             # update everything in repo
 *   run git-pull.js --download daemon.js other.js
 *   run git-pull.js --subfolder modules
 */
export async function main(ns) {
    options = ns.flags(argsSchema);
    options.subfolder = options.subfolder ? trimSlash(options.subfolder) :
        ns.getScriptName().substring(0, ns.getScriptName().lastIndexOf('/'));

    const baseUrl = `https://raw.githubusercontent.com/${options.github}/${options.repository}/${options.branch}/`;

    let filesToDownload = options['new-file'].concat(
        options.download.length > 0 ? options.download : await repositoryListing(ns)
    );

    for (const localFile of filesToDownload) {
        const fullLocal = pathJoin(options.subfolder, localFile);
        const remote = baseUrl + localFile;
        ns.print(`downloading ${fullLocal} from ${remote}`);
        if (await ns.wget(`${remote}?ts=${Date.now()}`, fullLocal)) {
            ns.tprint(`UPDATED ${fullLocal}`);
            rewriteFileForSubfolder(ns, fullLocal);
        } else {
            ns.tprint(`FAILED  ${fullLocal}`);
        }
    }
    ns.tprint('git-pull complete');
    // optional cleanup script if present
    if (ns.fileExists(pathJoin(options.subfolder, 'cleanup.js'), 'home')) {
        ns.run(pathJoin(options.subfolder, 'cleanup.js'));
    }
}

function trimSlash(s) {
    if (!s) return '';
    if (s.startsWith('/')) s = s.slice(1);
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
}

function pathJoin(...parts) {
    return trimSlash(parts.filter(p => p).join('/').replace(/\/+/g, '/'));
}

export function rewriteFileForSubfolder(ns, path) {
    if (!options.subfolder || path.includes('git-pull.js')) return true;
    let c = ns.read(path);
    c = c.replace(`const subfolder = ''`, `const subfolder = '${options.subfolder}/'`);
    c = c.replace(/from '(\.\/)?((?!\.\.\/).*)'/g,
                  `from '${pathJoin(options.subfolder, '$2')}'`);
    ns.write(path, c, 'w');
    return true;
}

async function repositoryListing(ns, folder = '') {
    const url = `https://api.github.com/repos/${options.github}/${options.repository}/contents/${folder}?ref=${options.branch}`;
    try {
        let res = await fetch(url);
        let data = await res.json();
        let files = data.filter(f => f.type === 'file')
            .map(f => f.path)
            .filter(f => options.extension.some(ext => f.endsWith(ext)));
        const dirs = data.filter(f => f.type === 'dir').map(f => f.path);
        for (const d of dirs) {
            files = files.concat((await repositoryListing(ns, d)).map(f => '/' + f));
        }
        return files;
    } catch (e) {
        if (folder !== '') throw e;
        ns.tprint('WARNING: repository listing failed, falling back to ns.ls');
        return ns.ls('home').filter(name =>
            options.extension.some(ext => name.endsWith(ext)) &&
            !options['omit-folder'].some(dir => name.startsWith(dir))
        );
    }
}
