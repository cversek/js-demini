/**
 * Large orchestrator — cross-module coordinator that ties all subsystems together.
 * Imports from mixed-WrapKind modules to create dense cross-references in the
 * dependency graph. This module's DFS subtree spans the entire bundle.
 */
import chalk from "chalk";                                          // ESM → WrapNone
import fs from "fs-extra";                                          // CJS → WrapCJS
import { WebSocketServer } from "ws";                               // CJS → WrapCJS
import { v4 as uuidv4 } from "uuid";                               // CJS → WrapCJS
import { loadConfig, validateConfig } from "./config-loader.js";    // mixed deps
import { discoverFiles, writeResults } from "./file-processor.js";  // mixed deps
import { createServer, authenticatedFetch } from "./network-handler.js"; // mixed deps
import { withSpinner, formatOutput } from "./cli-interface.js";     // mixed deps
import { runTasks, createTask } from "./task-runner.js";            // mixed deps
import { fibonacci, isPrime } from "./tiny-util.js";                // pure ESM
import { processDirectory, summarize } from "./medium-processor.js"; // builtins

export async function runPipeline(config) {
  const runId = uuidv4();
  const log = (msg) => console.log(chalk.cyan(`[pipeline:${runId.slice(0, 8)}] ${msg}`));
  const warn = (msg) => console.log(chalk.yellow(`[pipeline:${runId.slice(0, 8)}] ${msg}`));

  log("Starting pipeline...");

  // Phase 1: Load and validate config (CJS cosmiconfig + ESM find-up + chalk)
  const resolved = await loadConfig(config.workDir);
  const validation = validateConfig(resolved);
  if (!validation.valid) {
    warn(`Config invalid: missing ${validation.missing.join(", ")}`);
  }

  // Phase 2: Discover input files (CJS fs-extra + ESM globby)
  const workDir = config.workDir || "/tmp/pipeline-run";
  await fs.ensureDir(workDir);
  await fs.ensureDir(`${workDir}/input`);
  await fs.ensureDir(`${workDir}/output`);

  const inputFiles = await discoverFiles(
    [`${workDir}/input/**/*.json`],
    { ignore: ["**/node_modules/**"] }
  );
  log(`Discovered ${inputFiles.length} input files`);

  // Phase 3: Process data with spinners (CJS lodash + ESM ora)
  const results = await withSpinner("Processing files", async (update) => {
    const processed = [];
    for (let i = 0; i < inputFiles.length; i++) {
      update(`Processing file ${i + 1}/${inputFiles.length}`);
      const data = await fs.readJson(inputFiles[i]).catch(() => null);
      if (!data) continue;
      const n = data.value || 10;
      processed.push({
        name: inputFiles[i].split("/").pop(),
        fibonacci: fibonacci(n),
        isPrime: isPrime(n),
        value: n,
        bytes: JSON.stringify(data).length,
      });
    }
    return processed;
  });

  // Phase 4: Run verification tasks (CJS debug/semver + WrapESM execa/jose)
  const verifyTasks = [
    createTask("node-check", "command", { cmd: "node", args: ["--version"], priority: "high" }),
    createTask("npm-check", "command", { cmd: "npm", args: ["--version"], priority: "normal" }),
  ];
  const taskResults = await runTasks(verifyTasks, { concurrency: 2 });
  log(`Verification: ${taskResults.succeeded}/${taskResults.total} passed`);

  // Phase 5: Write results (CJS fs-extra + ESM globby via file-processor)
  const manifest = await writeResults(`${workDir}/output`, results);

  // Phase 6: Format summary (CJS lodash + ESM chalk via cli-interface)
  const summary = {
    runId,
    filesProcessed: results.length,
    totalBytes: manifest.totalBytes,
    verification: { passed: taskResults.succeeded, total: taskResults.total },
    timestamp: new Date().toISOString(),
  };
  console.log(formatOutput(summary, "text"));

  log(chalk.green("Pipeline complete!"));
  return summary;
}

export function getVersion() {
  return { version: "2.0.0", name: "mixed-wrapkind-orchestrator" };
}
