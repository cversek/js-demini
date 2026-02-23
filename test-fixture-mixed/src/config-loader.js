/**
 * Config loader — mixes CJS (debug, cosmiconfig) with ESM (chalk, find-up).
 * Each import from a different WrapKind forces esbuild's DFS to alternate
 * between CJS factory regions and bare-inline ESM regions.
 */
import chalk from "chalk";                    // ESM → WrapNone
import { findUp } from "find-up";            // ESM → WrapNone
import { cosmiconfig } from "cosmiconfig";   // CJS → WrapCJS
import createDebug from "debug";             // CJS → WrapCJS
import { join, resolve, dirname } from "node:path";     // BMI: path (shared with file-processor, task-runner, cli-interface, medium-processor)
import { readFileSync, existsSync } from "node:fs";     // BMI: fs (shared with file-processor, medium-processor)
import { createHash } from "node:crypto";                // BMI: crypto (shared with network-handler, task-runner)

const debug = createDebug("gt:config");

const CONFIG_NAMES = ["groundtruth", "gt-pipeline", "demini"];
const SEARCH_FILES = [
  "package.json",
  ".groundtruthrc",
  ".groundtruthrc.json",
  ".groundtruthrc.yaml",
  "groundtruth.config.js",
];

export async function loadConfig(startDir) {
  debug("searching for config from %s", startDir || process.cwd());

  // Try cosmiconfig first (CJS dependency)
  for (const name of CONFIG_NAMES) {
    const explorer = cosmiconfig(name, {
      searchPlaces: SEARCH_FILES,
      stopDir: process.env.HOME,
    });
    const result = await explorer.search(startDir).catch(() => null);
    if (result && !result.isEmpty) {
      debug("found config via cosmiconfig: %s", result.filepath);
      console.log(chalk.green(`Config loaded from ${result.filepath}`));
      return { source: "cosmiconfig", filepath: result.filepath, config: result.config };
    }
  }

  // Fallback: walk up looking for .gt-config.json (ESM dependency)
  const configFile = await findUp(".gt-config.json", { cwd: startDir });
  if (configFile) {
    debug("found config via find-up: %s", configFile);
    console.log(chalk.blue(`Config found at ${configFile}`));
    return { source: "find-up", filepath: configFile, config: {} };
  }

  // Default config
  debug("no config found, using defaults");
  console.log(chalk.yellow("No config found — using defaults"));
  return {
    source: "default",
    filepath: null,
    config: {
      verbose: false,
      outputDir: "./dist",
      format: "esm",
      minify: true,
    },
  };
}

export function mergeConfig(base, overrides) {
  const merged = { ...base.config, ...overrides };
  debug("merged config: %O", merged);
  console.log(chalk.dim(`Config merged: ${Object.keys(merged).length} keys`));
  return { ...base, config: merged };
}

export function validateConfig(config) {
  const required = ["outputDir", "format"];
  const missing = required.filter((k) => !(k in config.config));
  if (missing.length > 0) {
    console.log(chalk.red(`Missing required config keys: ${missing.join(", ")}`));
    return { valid: false, missing };
  }
  debug("config valid");
  return { valid: true, missing: [] };
}

// --- BMI exercising functions (path, fs, crypto) ---

export function resolveConfigPath(base, relative) {
  const full = resolve(base, relative);
  const dir = dirname(full);
  debug("resolved config path: %s (dir: %s)", full, dir);
  return { full, dir, joined: join(base, relative) };
}

export function readConfigSync(filepath) {
  if (!existsSync(filepath)) {
    console.log(chalk.yellow(`Config file not found: ${filepath}`));
    return null;
  }
  const content = readFileSync(filepath, "utf8");
  debug("read config: %s (%d bytes)", filepath, content.length);
  return JSON.parse(content);
}

export function hashConfig(config) {
  const serialized = JSON.stringify(config, Object.keys(config).sort());
  const hash = createHash("sha256").update(serialized).digest("hex");
  debug("config hash: %s", hash.slice(0, 12));
  return hash;
}
