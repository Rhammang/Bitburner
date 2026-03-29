/**
 * Returns a list of all servers on the network.
 * @param {NS} ns
 * @returns {string[]}
 */
export function list_servers(ns) {
  const server_list = new Set(['home']);
  const queue = ['home'];
  while (queue.length > 0) {
    const host = queue.shift();
    for (const remote_host of ns.scan(host)) {
      if (!server_list.has(remote_host)) {
        server_list.add(remote_host);
        queue.push(remote_host);
      }
    }
  }
  return [...server_list];
}

/**
 * Returns the shortest connection path between two servers, inclusive.
 * Empty array means no route was found.
 * @param {NS} ns
 * @param {string} start
 * @param {string} target
 * @returns {string[]}
 */
export function find_server_path(ns, start, target) {
  const from = String(start || "home");
  const to = String(target || "");
  if (!to) return [];
  if (from === to) return [from];

  const seen = new Set([from]);
  const queue = [[from]];
  while (queue.length > 0) {
    const path = queue.shift();
    const host = path[path.length - 1];
    for (const next of ns.scan(host)) {
      if (seen.has(next)) continue;
      const next_path = path.concat(next);
      if (next === to) return next_path;
      seen.add(next);
      queue.push(next_path);
    }
  }

  return [];
}

/**
 * Returns rooted hosts that can run scripts.
 * Kept for compatibility with modules that import get_hosts.
 * @param {NS} ns
 * @returns {string[]}
 */
export function get_hosts(ns) {
  return list_servers(ns).filter(
    (host) => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0
  );
}
