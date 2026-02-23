import { readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { colorize } from "./require-bridge.cjs";

export function getVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return pkg.version;
}

export function checkCompat(current, required) {
  const ok = semver.satisfies(current, required);
  console.log(colorize(`${current} ${ok ? "✓" : "✗"} ${required}`, ok ? "green" : "red"));
  return ok;
}

export function bumpVersion(ver, type) {
  return semver.inc(ver, type);
}

export function sortVersions(versions) {
  return semver.sort([...versions]);
}
