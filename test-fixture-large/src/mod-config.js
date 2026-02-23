import { join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { cosmiconfig } from "cosmiconfig";
import jsYaml from "js-yaml";
import debug from "debug";
import { findConfig } from "./require-bridge.cjs";

const log = debug("proxy:config");

export async function loadConfig(name) {
  const explorer = cosmiconfig(name);
  const result = await explorer.search();
  log("config loaded: %o", result?.filepath);
  return result?.config || {};
}

export function loadYaml(filepath) {
  if (!existsSync(filepath)) return null;
  const content = readFileSync(filepath, "utf8");
  return jsYaml.load(content);
}

export async function findProjectRoot() {
  return findConfig("package.json");
}

export function resolveFromRoot(root, ...segments) {
  return resolve(root, ...segments);
}

export function getConfigPath(root, name) {
  return join(root, ".config", name);
}
