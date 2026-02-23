/**
 * Mixed WrapKind Test Bundle — Entry Point
 * Three WrapKind classes interleaved throughout the bundle.
 *
 * WrapKind distribution is controlled by import mechanism, not spatial layout:
 *   WrapCJS  — CJS packages (lodash, debug, semver, dotenv, uuid, fs-extra, ws, cosmiconfig)
 *   WrapESM  — ESM packages require()'d from CJS bridge (execa, jose, got)
 *   WrapNone — ESM packages via static import (chalk, globby, find-up, ora, meow, p-queue)
 *
 * Interleaving is achieved by each local module importing a mix of CJS and ESM
 * packages, so esbuild's DFS traversal alternates between WrapKind regions.
 */

// --- Orchestrator modules (each mixes CJS + ESM deps) ---
import { loadConfig, mergeConfig, validateConfig } from "./config-loader.js";
import { discoverFiles, filterByExtension, readAndParse, createVersionedOutput, writeResults, compareVersions } from "./file-processor.js";
import { createServer, connectAndSend, fetchData, healthCheck, authenticatedFetch, getConnectionCount } from "./network-handler.js";
import { parseArgs, withSpinner, loadEnvironment, formatOutput, summarizeArgs } from "./cli-interface.js";
import { runTasks, createTask, filterTasks } from "./task-runner.js";
import { runPipeline, getVersion } from "./large-orchestrator.js";

// --- Pure modules (no external deps — WrapNone) ---
import { fibonacci, isPrime } from "./tiny-util.js";
import { processDirectory, summarize } from "./medium-processor.js";

// --- Direct WrapNone imports (ESM via static import) ---
import chalk from "chalk";
import { globby } from "globby";
import { findUp } from "find-up";
import ora from "ora";
import PQueue from "p-queue";

// --- Direct WrapCJS imports (CJS packages) ---
import _ from "lodash";
import createDebug from "debug";
import semver from "semver";

const debug = createDebug("gt:main");

// ==========================================
// Exercise all imported packages to prevent
// tree-shaking from removing them
// ==========================================

console.log(chalk.blue.bold("=== Mixed WrapKind Test Bundle v2.0 ==="));
debug("starting mixed-wrapkind bundle");

// --- Config subsystem (cosmiconfig/CJS + find-up/ESM + debug/CJS + chalk/ESM) ---
const config = await loadConfig();
const validated = validateConfig(config);
console.log(chalk.dim(`Config valid: ${validated.valid}, source: ${config.source}`));

const env = loadEnvironment();
console.log(chalk.dim(`Environment: ${Object.keys(env).length} vars loaded`));

// --- File processing (fs-extra/CJS + globby/ESM + semver/CJS + dotenv/CJS) ---
const cwd = process.cwd();
const jsFiles = await discoverFiles(["**/*.js"], { cwd, ignore: ["node_modules/**", "dist/**"] });
const filtered = await filterByExtension(jsFiles, [".js"]);
console.log(chalk.dim(`Files discovered: ${jsFiles.length}, filtered: ${filtered.length}`));

const versionInfo = createVersionedOutput("mixed-wrapkind", "2.0.0");
console.log(chalk.dim(`Version output: ${versionInfo?.dir}`));

const vcompare = compareVersions("1.0.0", "2.0.0");
console.log(chalk.dim(`Version comparison: 1.0.0 vs 2.0.0 → diff=${vcompare.diff}`));

// --- Network subsystem (ws/CJS + uuid/CJS + got/WrapESM + jose/WrapESM) ---
const server = await createServer(0);
console.log(chalk.dim(`WebSocket server started on port ${server.port}`));

const endpoint = await healthCheck("https://httpbin.org/get").catch(() => ({ ok: false }));
console.log(chalk.dim(`Health check: ${endpoint.ok ? "OK" : "unreachable"}`));

// Quick WebSocket round-trip
const wsResult = await connectAndSend(
  `ws://localhost:${server.port}`,
  [{ type: "ping", data: "hello" }]
).catch(() => ({ sent: 0, received: 0 }));
console.log(chalk.dim(`WebSocket test: sent=${wsResult.sent}, received=${wsResult.received}`));
server.wss.close();

// --- Auth flow (jose/WrapESM via require-bridge) ---
const authResult = await authenticatedFetch("https://httpbin.org/headers", "test-user")
  .catch(() => ({ ok: false, auth: { tokenValid: false } }));
console.log(chalk.dim(`Auth fetch: ok=${authResult.ok}, tokenValid=${authResult.auth?.tokenValid}`));

// --- CLI subsystem (lodash/CJS + ora/ESM + meow/ESM + dotenv/CJS) ---
const formatted = formatOutput({ name: "mixed-wrapkind", version: "2.0.0", modules: 17 });
console.log(chalk.dim("Formatted output:"));
console.log(formatted);

const spinnerResult = await withSpinner("Computing fibonacci sequence", async (update) => {
  const results = [];
  for (let i = 1; i <= 20; i++) {
    update(`fibonacci(${i})...`);
    results.push({ n: i, fib: fibonacci(i), prime: isPrime(i) });
  }
  return results;
});
console.log(chalk.dim(`Computed ${spinnerResult.length} fibonacci values`));

// --- Task execution (lodash/CJS + debug/CJS + semver/CJS + execa/WrapESM + p-queue/ESM) ---
const tasks = [
  createTask("echo-test", "command", { cmd: "echo", args: ["hello"], priority: "high" }),
  createTask("node-version", "command", { cmd: "node", args: ["--version"], priority: "normal" }),
];
const taskResults = await runTasks(tasks, { concurrency: 2, minNodeVersion: "16.0.0" });
console.log(chalk.dim(`Tasks: ${taskResults.succeeded}/${taskResults.total} succeeded`));

// --- Direct lodash usage (WrapCJS) ---
const numbers = _.range(1, 50);
const primes = _.filter(numbers, isPrime);
const chunks = _.chunk(primes, 5);
console.log(chalk.dim(`Primes < 50: ${primes.length} found, ${chunks.length} chunks`));
console.log(chalk.dim(`Sample: ${_.take(primes, 10).join(", ")}`));

// --- Direct semver usage (WrapCJS) ---
const versions = ["1.0.0", "1.2.3", "2.0.0-beta.1", "2.0.0", "3.0.0-rc.1"];
const sorted = semver.sort([...versions]);
const stable = versions.filter((v) => !semver.prerelease(v));
console.log(chalk.dim(`Versions sorted: ${sorted.join(", ")}`));
console.log(chalk.dim(`Stable only: ${stable.join(", ")}`));

// --- Direct p-queue usage (WrapNone ESM) ---
const directQueue = new PQueue({ concurrency: 2 });
const queueResults = await Promise.all(
  _.range(5).map((i) => directQueue.add(() => {
    const fib = fibonacci(i * 5);
    debug("queue task %d: fibonacci(%d) = %d", i, i * 5, fib);
    return { index: i, fib };
  }))
);
console.log(chalk.dim(`Queue results: ${queueResults.map((r) => r.fib).join(", ")}`));

// --- Direct globby + find-up usage (WrapNone ESM) ---
const packageJson = await findUp("package.json");
console.log(chalk.dim(`Nearest package.json: ${packageJson}`));

const allJsonFiles = await globby("**/*.json", { cwd: cwd, ignore: ["node_modules/**"], deep: 2 });
console.log(chalk.dim(`JSON files (depth 2): ${allJsonFiles.length}`));

// --- Large orchestrator (dense cross-module references) ---
console.log(chalk.dim(`Orchestrator: ${getVersion().name} v${getVersion().version}`));
console.log(chalk.dim(`runPipeline available: ${typeof runPipeline === "function"}`));

// --- Medium processor (builtins only — WrapNone) ---
console.log(chalk.dim(`processDirectory available: ${typeof processDirectory === "function"}`));
console.log(chalk.dim(`summarize available: ${typeof summarize === "function"}`));

// --- Pure utility (WrapNone — zero external refs) ---
console.log(chalk.dim(`fibonacci(10) = ${fibonacci(10)}`));
console.log(chalk.dim(`isPrime(17) = ${isPrime(17)}`));

console.log(chalk.green.bold("\n=== Mixed WrapKind Test Bundle Complete ==="));
debug("all subsystems exercised");
