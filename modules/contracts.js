import { list_servers } from "/modules/utils.js";
import {
  CONTRACTS_STATUS_FILE,
} from "/modules/runtime-contracts.js";

const STATUS_FILE = CONTRACTS_STATUS_FILE;
const LOOP_MS = 60000;

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  let last_count = -1;
  const solved_set = new Set(); // track solved contracts to avoid re-attempts

  while (true) {
    const contracts = find_contracts(ns);

    // Attempt to solve each contract
    for (const entry of contracts) {
      const key = `${entry.host}:${entry.file}`;
      if (solved_set.has(key)) continue;

      const solver = SOLVERS[entry.type];
      if (!solver) {
        ns.print(`CONTRACTS: No solver for "${entry.type}" on ${entry.host}`);
        continue;
      }

      const data = ns.codingcontract.getData(entry.file, entry.host);
      try {
        const answer = solver(data);
        const reward = ns.codingcontract.attempt(answer, entry.file, entry.host);
        if (reward) {
          ns.tprint(`CONTRACTS: Solved "${entry.type}" on ${entry.host} → ${reward}`);
          solved_set.add(key);
        } else {
          ns.tprint(`CONTRACTS: FAILED "${entry.type}" on ${entry.host} (wrong answer)`);
          solved_set.add(key); // don't retry wrong answers
        }
      } catch (e) {
        ns.print(`CONTRACTS: Error solving "${entry.type}": ${e}`);
      }
    }

    // Write status (only unsolved/unsolvable remain)
    const remaining = contracts.filter((c) => !solved_set.has(`${c.host}:${c.file}`));
    const lines = remaining.map((e) => {
      const has_solver = SOLVERS[e.type] ? "solvable" : "no-solver";
      return `${e.host}\t${e.file}\t${e.type}\t${has_solver}`;
    });
    await ns.write(STATUS_FILE, lines.join("\n"), "w");

    if (contracts.length !== last_count && contracts.length > 0) {
      const solvable = contracts.filter((c) => SOLVERS[c.type]).length;
      ns.tprint(`CONTRACTS: ${contracts.length} found, ${solvable} solvable`);
    }
    last_count = contracts.length;

    // Clean solved_set of contracts that no longer exist
    const active = new Set(contracts.map((c) => `${c.host}:${c.file}`));
    for (const key of solved_set) {
      if (!active.has(key)) solved_set.delete(key);
    }

    await ns.sleep(LOOP_MS);
  }
}

function find_contracts(ns) {
  const found = [];
  for (const host of list_servers(ns)) {
    for (const file of ns.ls(host, ".cct")) {
      const type = ns.codingcontract.getContractType(file, host);
      found.push({ host, file, type });
    }
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════
//  SOLVER FUNCTIONS — keyed by ns.codingcontract.getContractType()
// ═══════════════════════════════════════════════════════════════════

const SOLVERS = {
  "Find Largest Prime Factor": (n) => {
    let factor = 2;
    let val = n;
    while (factor * factor <= val) {
      while (val % factor === 0) val /= factor;
      factor++;
    }
    return val > 1 ? val : factor - 1;
  },

  "Subarray with Maximum Sum": (arr) => {
    let max = -Infinity, cur = 0;
    for (const v of arr) {
      cur = Math.max(v, cur + v);
      max = Math.max(max, cur);
    }
    return max;
  },

  "Total Ways to Sum": (n) => {
    // Count partitions of n into 2+ positive integers
    const dp = new Array(n + 1).fill(0);
    dp[0] = 1;
    for (let i = 1; i < n; i++) {
      for (let j = i; j <= n; j++) dp[j] += dp[j - i];
    }
    return dp[n];
  },

  "Total Ways to Sum II": ([n, parts]) => {
    const dp = new Array(n + 1).fill(0);
    dp[0] = 1;
    for (const p of parts) {
      for (let j = p; j <= n; j++) dp[j] += dp[j - p];
    }
    return dp[n];
  },

  "Spiralize Matrix": (matrix) => {
    const result = [];
    let top = 0, bottom = matrix.length - 1, left = 0, right = matrix[0].length - 1;
    while (top <= bottom && left <= right) {
      for (let i = left; i <= right; i++) result.push(matrix[top][i]);
      top++;
      for (let i = top; i <= bottom; i++) result.push(matrix[i][right]);
      right--;
      if (top <= bottom) { for (let i = right; i >= left; i--) result.push(matrix[bottom][i]); bottom--; }
      if (left <= right) { for (let i = bottom; i >= top; i--) result.push(matrix[i][left]); left++; }
    }
    return result;
  },

  "Array Jumping Game": (arr) => {
    let reach = 0;
    for (let i = 0; i < arr.length && i <= reach; i++) {
      reach = Math.max(reach, i + arr[i]);
    }
    return reach >= arr.length - 1 ? 1 : 0;
  },

  "Array Jumping Game II": (arr) => {
    if (arr.length <= 1) return 0;
    let jumps = 0, end = 0, farthest = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      farthest = Math.max(farthest, i + arr[i]);
      if (i === end) {
        jumps++;
        end = farthest;
        if (end >= arr.length - 1) return jumps;
      }
    }
    return 0;
  },

  "Merge Overlapping Intervals": (intervals) => {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1];
      if (intervals[i][0] <= last[1]) {
        last[1] = Math.max(last[1], intervals[i][1]);
      } else {
        merged.push(intervals[i]);
      }
    }
    return merged;
  },

  "Generate IP Addresses": (s) => {
    const results = [];
    for (let a = 1; a <= 3 && a <= s.length - 3; a++) {
      for (let b = 1; b <= 3 && a + b <= s.length - 2; b++) {
        for (let c = 1; c <= 3 && a + b + c <= s.length - 1; c++) {
          const d = s.length - a - b - c;
          if (d < 1 || d > 3) continue;
          const parts = [s.slice(0, a), s.slice(a, a + b), s.slice(a + b, a + b + c), s.slice(a + b + c)];
          if (parts.every((p) => Number(p) <= 255 && (p.length === 1 || p[0] !== "0"))) {
            results.push(parts.join("."));
          }
        }
      }
    }
    return results;
  },

  "Algorithmic Stock Trader I": (prices) => {
    let min = Infinity, profit = 0;
    for (const p of prices) { min = Math.min(min, p); profit = Math.max(profit, p - min); }
    return profit;
  },

  "Algorithmic Stock Trader II": (prices) => {
    let profit = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) profit += prices[i] - prices[i - 1];
    }
    return profit;
  },

  "Algorithmic Stock Trader III": (prices) => {
    return solve_stock_k(2, prices);
  },

  "Algorithmic Stock Trader IV": ([k, prices]) => {
    return solve_stock_k(k, prices);
  },

  "Minimum Path Sum in a Triangle": (triangle) => {
    const dp = [...triangle[triangle.length - 1]];
    for (let row = triangle.length - 2; row >= 0; row--) {
      for (let i = 0; i <= row; i++) {
        dp[i] = triangle[row][i] + Math.min(dp[i], dp[i + 1]);
      }
    }
    return dp[0];
  },

  "Unique Paths in a Grid I": ([rows, cols]) => {
    // C(rows+cols-2, rows-1)
    const n = rows + cols - 2;
    const k = Math.min(rows - 1, cols - 1);
    let result = 1;
    for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
    return Math.round(result);
  },

  "Unique Paths in a Grid II": (grid) => {
    const rows = grid.length, cols = grid[0].length;
    const dp = new Array(cols).fill(0);
    dp[0] = grid[0][0] === 0 ? 1 : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) { dp[c] = 0; continue; }
        if (c > 0) dp[c] += dp[c - 1];
      }
    }
    return dp[cols - 1];
  },

  "Sanitize Parentheses in Expression": (s) => {
    const results = new Set();
    let min_removals = Infinity;
    function dfs(i, open, removed, built) {
      if (removed > min_removals) return;
      if (i === s.length) {
        if (open === 0) {
          if (removed < min_removals) { min_removals = removed; results.clear(); }
          if (removed === min_removals) results.add(built);
        }
        return;
      }
      const ch = s[i];
      if (ch !== "(" && ch !== ")") {
        dfs(i + 1, open, removed, built + ch);
      } else {
        // Skip this paren
        dfs(i + 1, open, removed + 1, built);
        // Keep this paren
        if (ch === "(") dfs(i + 1, open + 1, removed, built + ch);
        else if (open > 0) dfs(i + 1, open - 1, removed, built + ch);
      }
    }
    dfs(0, 0, 0, "");
    return [...results];
  },

  "Find All Valid Math Expressions": ([digits, target]) => {
    const results = [];
    function dfs(i, expr, val, last) {
      if (i === digits.length) {
        if (val === target) results.push(expr);
        return;
      }
      for (let j = i + 1; j <= digits.length; j++) {
        const seg = digits.slice(i, j);
        if (seg.length > 1 && seg[0] === "0") break;
        const num = Number(seg);
        if (i === 0) {
          dfs(j, seg, num, num);
        } else {
          dfs(j, expr + "+" + seg, val + num, num);
          dfs(j, expr + "-" + seg, val - num, -num);
          dfs(j, expr + "*" + seg, val - last + last * num, last * num);
        }
      }
    }
    dfs(0, "", 0, 0);
    return results;
  },

  "HammingCodes: Integer to Encoded Binary": (n) => {
    const bits = BigInt(n).toString(2).split("").map(Number);
    // Insert parity positions (1-indexed positions that are powers of 2)
    const encoded = [];
    let di = 0;
    for (let i = 1; di < bits.length || (i & (i - 1)) === 0; i++) {
      if ((i & (i - 1)) === 0) encoded.push(0); // parity bit placeholder
      else encoded.push(bits[di++]);
    }
    // Calculate parity bits
    for (let p = 1; p <= encoded.length; p *= 2) {
      let parity = 0;
      for (let i = p - 1; i < encoded.length; i += p * 2) {
        for (let j = i; j < Math.min(i + p, encoded.length); j++) parity ^= encoded[j];
      }
      encoded[p - 1] = parity;
    }
    // Overall parity at position 0
    encoded.unshift(encoded.reduce((a, b) => a ^ b, 0));
    return encoded.join("");
  },

  "HammingCodes: Encoded Binary to Integer": (s) => {
    const bits = s.split("").map(Number);
    // Find error position using parity checks (skip overall parity at index 0)
    let errorPos = 0;
    for (let p = 1; p < bits.length; p *= 2) {
      let parity = 0;
      for (let i = p; i < bits.length; i++) {
        if (i & p) parity ^= bits[i];
      }
      if (parity !== 0) errorPos += p;
    }
    // Correct the error
    if (errorPos > 0 && errorPos < bits.length) bits[errorPos] ^= 1;
    // Extract data bits (skip position 0 and powers of 2)
    let result = "";
    for (let i = 3; i < bits.length; i++) {
      if ((i & (i - 1)) !== 0) result += bits[i];
    }
    return BigInt("0b" + (result || "0")).toString(10);
  },

  "Shortest Path in a Grid": (grid) => {
    const rows = grid.length, cols = grid[0].length;
    if (grid[0][0] === 1 || grid[rows - 1][cols - 1] === 1) return "";
    const dirs = [[0, 1, "R"], [0, -1, "L"], [1, 0, "D"], [-1, 0, "U"]];
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    visited[0][0] = true;
    const queue = [[0, 0, ""]];
    while (queue.length > 0) {
      const [r, c, path] = queue.shift();
      if (r === rows - 1 && c === cols - 1) return path;
      for (const [dr, dc, dir] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] === 0) {
          visited[nr][nc] = true;
          queue.push([nr, nc, path + dir]);
        }
      }
    }
    return "";
  },

  "Proper 2-Coloring of a Graph": ([n, edges]) => {
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
    const colors = new Array(n).fill(-1);
    for (let start = 0; start < n; start++) {
      if (colors[start] !== -1) continue;
      colors[start] = 0;
      const queue = [start];
      while (queue.length > 0) {
        const node = queue.shift();
        for (const neighbor of adj[node]) {
          if (colors[neighbor] === -1) {
            colors[neighbor] = colors[node] ^ 1;
            queue.push(neighbor);
          } else if (colors[neighbor] === colors[node]) {
            return [];
          }
        }
      }
    }
    return colors;
  },

  "Compression I: RLE Compression": (s) => {
    let result = "";
    let i = 0;
    while (i < s.length) {
      let count = 1;
      while (i + count < s.length && s[i + count] === s[i] && count < 9) count++;
      result += count + s[i];
      i += count;
    }
    return result;
  },

  "Compression II: LZ Decompression": (s) => {
    let result = "", i = 0, type = 0;
    while (i < s.length) {
      const len = Number(s[i]);
      i++;
      if (type === 0) {
        // Direct chunk
        if (len > 0) { result += s.slice(i, i + len); i += len; }
      } else {
        // Back-reference
        if (len > 0) {
          const offset = Number(s[i]);
          i++;
          for (let j = 0; j < len; j++) result += result[result.length - offset];
        }
      }
      type ^= 1;
    }
    return result;
  },

  "Compression III: LZ Compression": (s) => {
    // DP approach: find shortest encoding that alternates direct/ref chunks
    const n = s.length;
    const memo = new Map();
    function solve(pos, type) {
      if (pos === n) return "";
      const key = pos * 2 + type;
      if (memo.has(key)) return memo.get(key);
      let best = null;
      if (type === 0) {
        // Direct chunk: emit 1-9 literal chars (require >=1 to guarantee progress)
        for (let len = 1; len <= Math.min(9, n - pos); len++) {
          const chunk = len + s.slice(pos, pos + len);
          const rest = solve(pos + len, 1);
          if (rest !== null) {
            const candidate = chunk + rest;
            if (best === null || candidate.length < best.length) best = candidate;
          }
        }
      } else {
        // Reference: "0" (empty) or length+offset
        const rest0 = solve(pos, 0);
        if (rest0 !== null) {
          const candidate = "0" + rest0;
          if (best === null || candidate.length < best.length) best = candidate;
        }
        for (let off = 1; off <= Math.min(9, pos); off++) {
          for (let len = 1; len <= Math.min(9, n - pos); len++) {
            if (s[pos + len - 1] !== s[pos - off + ((len - 1) % off)]) break;
            const chunk = "" + len + off;
            const rest = solve(pos + len, 0);
            if (rest !== null) {
              const candidate = chunk + rest;
              if (best === null || candidate.length < best.length) best = candidate;
            }
          }
        }
      }
      memo.set(key, best);
      return best;
    }
    return solve(0, 0) || "0";
  },

  "Encryption I: Caesar Cipher": ([plaintext, shift]) => {
    return plaintext.split("").map((ch) => {
      if (ch === " ") return ch;
      const code = ((ch.charCodeAt(0) - 65 - shift % 26 + 26) % 26) + 65;
      return String.fromCharCode(code);
    }).join("");
  },

  "Encryption II: Vigenère Cipher": ([plaintext, key]) => {
    return plaintext.split("").map((ch, i) => {
      const shift = key.charCodeAt(i % key.length) - 65;
      return String.fromCharCode(((ch.charCodeAt(0) - 65 - shift + 26) % 26) + 65);
    }).join("");
  },
};

// Shared helper: stock trader with k transactions
function solve_stock_k(k, prices) {
  if (prices.length < 2 || k === 0) return 0;
  if (k >= Math.floor(prices.length / 2)) {
    let profit = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) profit += prices[i] - prices[i - 1];
    }
    return profit;
  }
  const buy = new Array(k + 1).fill(-Infinity);
  const sell = new Array(k + 1).fill(0);
  for (const price of prices) {
    for (let t = 1; t <= k; t++) {
      buy[t] = Math.max(buy[t], sell[t - 1] - price);
      sell[t] = Math.max(sell[t], buy[t] + price);
    }
  }
  return sell[k];
}
