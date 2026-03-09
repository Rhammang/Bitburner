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
