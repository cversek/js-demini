/**
 * Task runner — mixes CJS (lodash, debug, semver) with WrapESM (execa via require-bridge)
 * and ESM (p-queue, chalk). Coordinates parallel task execution with version constraints.
 */
import chalk from "chalk";                    // ESM → WrapNone (shared)
import PQueue from "p-queue";                // ESM → WrapNone
import _ from "lodash";                       // CJS → WrapCJS (shared with cli-interface)
import createDebug from "debug";             // CJS → WrapCJS (shared with config-loader)
import semver from "semver";                 // CJS → WrapCJS (shared with file-processor)
import {
  runCommand,
  getSystemInfo,
  createSignedManifest,
} from "./require-bridge.cjs";               // CJS bridge → WrapESM for execa/jose/got
import { join as taskJoin, resolve as taskResolve } from "node:path";  // BMI: path
import { randomUUID } from "node:crypto";                              // BMI: crypto
import { tmpdir } from "node:os";                                      // BMI: os

const debug = createDebug("gt:tasks");

export async function runTasks(tasks, options = {}) {
  const concurrency = options.concurrency || 3;
  const queue = new PQueue({ concurrency });
  const results = [];
  const startTime = Date.now();

  debug("starting %d tasks (concurrency=%d)", tasks.length, concurrency);
  console.log(chalk.cyan(`[tasks] Running ${tasks.length} tasks (concurrency: ${concurrency})`));

  // Check system requirements if specified
  if (options.minNodeVersion) {
    const sysInfo = await getSystemInfo();
    const nodeVer = sysInfo.node.replace("v", "");
    if (!semver.gte(nodeVer, options.minNodeVersion)) {
      console.log(chalk.red(`[tasks] Node ${nodeVer} < required ${options.minNodeVersion}`));
      return { success: false, error: "version_mismatch", required: options.minNodeVersion, actual: nodeVer };
    }
    debug("node version check passed: %s >= %s", nodeVer, options.minNodeVersion);
  }

  // Group tasks by priority using lodash
  const grouped = _.groupBy(tasks, (t) => t.priority || "normal");
  const priorities = ["critical", "high", "normal", "low"];
  const ordered = _.flatMap(priorities, (p) => grouped[p] || []);
  debug("task order: %O", ordered.map((t) => `${t.name}(${t.priority || "normal"})`));

  // Execute tasks via queue
  for (const task of ordered) {
    queue.add(async () => {
      const taskStart = Date.now();
      debug("starting task: %s", task.name);
      console.log(chalk.dim(`[tasks] Start: ${task.name}`));

      try {
        let result;
        if (task.type === "command") {
          // Use execa via require-bridge (WrapESM path)
          result = await runCommand(task.cmd, task.args || [], task.options || {});
        } else if (task.type === "compute") {
          result = await executeCompute(task);
        } else {
          result = { skipped: true, reason: `unknown type: ${task.type}` };
        }

        const elapsed = Date.now() - taskStart;
        const entry = {
          name: task.name,
          success: true,
          elapsed,
          result: _.pick(result, ["stdout", "exitCode", "value", "skipped"]),
        };
        results.push(entry);
        console.log(chalk.green(`[tasks] Done: ${task.name} (${elapsed}ms)`));
        return entry;
      } catch (err) {
        const elapsed = Date.now() - taskStart;
        const entry = { name: task.name, success: false, elapsed, error: err.message };
        results.push(entry);
        console.log(chalk.red(`[tasks] Failed: ${task.name}: ${err.message}`));
        return entry;
      }
    });
  }

  await queue.onIdle();
  const totalElapsed = Date.now() - startTime;
  const succeeded = results.filter((r) => r.success).length;

  debug("all tasks complete: %d/%d succeeded in %dms", succeeded, results.length, totalElapsed);
  console.log(chalk.bold(`[tasks] Complete: ${succeeded}/${results.length} succeeded (${totalElapsed}ms)`));

  // Create signed manifest of results (uses jose via require-bridge)
  const manifest = await createSignedManifest(
    results.map((r) => _.pick(r, ["name", "success", "elapsed"]))
  );

  return {
    success: succeeded === results.length,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    elapsed: totalElapsed,
    results,
    manifest,
  };
}

async function executeCompute(task) {
  const fn = task.fn || (() => null);
  const value = await fn();
  return { value, type: "compute" };
}

export function createTask(name, type, config) {
  return {
    name,
    type,
    priority: config.priority || "normal",
    ..._.omit(config, ["priority"]),
  };
}

export function filterTasks(tasks, predicate) {
  return _.filter(tasks, predicate);
}

// --- BMI exercising functions (path, crypto, os) ---

export function createTaskWorkdir(taskName) {
  const id = randomUUID();
  const dir = taskJoin(tmpdir(), "gt-tasks", `${taskName}-${id.slice(0, 8)}`);
  debug("task workdir: %s", dir);
  return { dir, id, resolved: taskResolve(dir) };
}
