import { join, resolve, dirname, basename, extname, relative, normalize, isAbsolute } from "node:path";
import debug from "debug";
import { colorize } from "./require-bridge.cjs";

const log = debug("proxy:path");

export function resolvePaths(base, ...segments) {
  const full = resolve(base, ...segments);
  log("resolved: %s", full);
  return { full, dir: dirname(full), base: basename(full), ext: extname(full) };
}

export function relativize(from, to) {
  return relative(from, to);
}

export function normPath(p) {
  return isAbsolute(p) ? normalize(p) : resolve(p);
}

export function joinAll(...parts) {
  const result = join(...parts);
  console.log(colorize(`[path] ${result}`, "dim"));
  return result;
}
