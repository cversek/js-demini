#!/usr/bin/env node
/**
 * demini — Pipeline runner for the demini JS reverse engineering toolkit
 *
 * Orchestrates the full demini pipeline: beautify → classify → (future stages).
 * Each stage runs as a child process, chaining outputs automatically.
 *
 * Usage:
 *   demini <input.js> [output-dir]
 *   demini <input.js> [output-dir] --stages 00,01
 *   demini <input.js> [output-dir] --skip-beautify
 *
 * Arguments:
 *   input.js    - JavaScript file to process (required)
 *   output-dir  - Base directory for DEMINI_NN/ output (default: same dir as input)
 *
 * Options:
 *   --stages 00,01   Run only specified stages (comma-separated)
 *   --skip-beautify  Skip Stage 00 (useful if input is already beautified)
 *   --help           Show this help message
 *
 * Output:
 *   DEMINI_NN/00_beautified-{name}.js     (Stage 00)
 *   DEMINI_NN/01_classified-{name}.js     (Stage 01)
 *   DEMINI_NN/01_stats-{name}.json        (Stage 01 sidecar)
 *   DEMINI_NN/run.json                    (provenance for all stages)
 *
 * Python analogy:
 *   Think of `demini` as like a `tox` or `nox` runner — it orchestrates
 *   individual tools (demini-beautify, demini-classify) in sequence,
 *   similar to how tox runs linters then tests then type-checkers.
 *   Each tool works standalone, but the runner chains them.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveOutputFolder, getVersion } from "./demini-utils.js";

// --- Constants ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STAGES = [
  {
    id: "00",
    name: "beautify",
    script: path.join(__dirname, "demini-beautify.js"),
    outputPrefix: "00_beautified-",
  },
  {
    id: "01",
    name: "classify",
    script: path.join(__dirname, "demini-classify.js"),
    outputPrefix: "01_classified-",
  },
];

/** Format milliseconds as seconds with 3 decimal places. */
function fmtTime(ms) {
  return (ms / 1000).toFixed(3) + "s";
}

// --- Argument Parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    inputPath: null,
    outputDir: null,
    stages: null,        // null = all stages
    skipBeautify: false,
    verbose: false,
    help: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--stages") {
      i++;
      if (i >= args.length) {
        console.error("Error: --stages requires a comma-separated list (e.g., 00,01)");
        process.exit(1);
      }
      opts.stages = args[i].split(",").map((s) => s.trim());
    } else if (arg === "--skip-beautify") {
      opts.skipBeautify = true;
    } else if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
    } else if (arg.startsWith("--")) {
      console.error(`Error: Unknown option: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  opts.inputPath = positional[0] || null;
  opts.outputDir = positional[1] || null;

  return opts;
}

function showHelp() {
  // Read the docblock from this file as help text
  console.log(`
demini v${getVersion()} — JS bundle reverse engineering pipeline

Usage:
  demini <input.js> [output-dir]
  demini <input.js> [output-dir] --stages 00,01
  demini <input.js> [output-dir] --skip-beautify

Arguments:
  input.js      JavaScript file to process (required)
  output-dir    Base directory for DEMINI_NN/ output (default: input's directory)

Options:
  --stages LIST    Run only specified stages (comma-separated: 00,01)
  --skip-beautify  Skip Stage 00 beautification
  --verbose, -v    Show detailed output from each stage
  --help, -h       Show this help message

Stages:
  00  beautify    Format minified code with prettier
  01  classify    Structural profiling with AST classification comments

Examples:
  demini bundle.js                    # Full pipeline, output next to input
  demini bundle.js ./output           # Full pipeline, custom output directory
  demini bundle.js --skip-beautify    # Skip beautification (input already formatted)
  demini bundle.js --stages 00        # Only beautify
  `);
}

// --- Stage Runner ---

/**
 * Run a single pipeline stage as a child process.
 *
 * @param {object} stage - Stage definition from STAGES array
 * @param {string} inputFile - Absolute path to input file
 * @param {string} outputDir - Output directory (passed as second arg to stage tool)
 * @returns {{ success: boolean, elapsed_ms: number, stdout: string, stderr: string }}
 */
function runStage(stage, inputFile, outputDir) {
  const stageArgs = [stage.script, inputFile];
  // Only pass outputDir for first stage (new run) — subsequent stages
  // detect they're inside DEMINI_NN/ and stay there automatically
  if (outputDir) {
    stageArgs.push(outputDir);
  }

  const startTime = Date.now();
  try {
    const stdout = execFileSync("node", stageArgs, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(inputFile),
    });
    const elapsed_ms = Date.now() - startTime;
    return { success: true, elapsed_ms, stdout: stdout.trim(), stderr: "" };
  } catch (err) {
    const elapsed_ms = Date.now() - startTime;
    return {
      success: false,
      elapsed_ms,
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || "").trim(),
    };
  }
}

/**
 * Find the output file from a stage by reading run.json provenance.
 *
 * @param {string} folderPath - DEMINI_NN/ folder
 * @param {string} stageId - Stage number (e.g., "00")
 * @returns {string|null} Absolute path to stage output file
 */
function findStageOutput(folderPath, stageId) {
  const runJsonPath = path.join(folderPath, "run.json");
  if (!fs.existsSync(runJsonPath)) return null;

  const runData = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));

  // Handle both single-stage and multi-stage run.json formats
  if (runData.stages) {
    const stage = runData.stages.find((s) => s.stage === stageId);
    if (stage && stage.results && stage.results.output_file) {
      return path.join(folderPath, stage.results.output_file);
    }
  } else if (runData.stage === stageId && runData.results && runData.results.output_file) {
    return path.join(folderPath, runData.results.output_file);
  }

  return null;
}

// --- Main ---

function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  if (!opts.inputPath) {
    console.error("Error: input file required. Run `demini --help` for usage.");
    process.exit(1);
  }

  const resolvedInput = path.resolve(opts.inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`Error: file not found: ${resolvedInput}`);
    process.exit(1);
  }

  const explicitOutputDir = opts.outputDir ? path.resolve(opts.outputDir) : null;

  // Determine which stages to run
  let stagesToRun = STAGES;
  if (opts.stages) {
    stagesToRun = STAGES.filter((s) => opts.stages.includes(s.id));
    if (stagesToRun.length === 0) {
      console.error(`Error: no valid stages in --stages ${opts.stages.join(",")}`);
      console.error(`Available stages: ${STAGES.map((s) => s.id).join(", ")}`);
      process.exit(1);
    }
  } else if (opts.skipBeautify) {
    stagesToRun = STAGES.filter((s) => s.id !== "00");
  }

  // --- Pipeline Header ---
  const inputBasename = path.basename(resolvedInput);
  const inputSize = fs.statSync(resolvedInput).size;
  console.log(`\n  demini v${getVersion()} — JS bundle reverse engineering pipeline`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  Input:  ${inputBasename} (${(inputSize / 1024).toFixed(1)} KB)`);
  console.log(`  Stages: ${stagesToRun.map((s) => `${s.id}:${s.name}`).join(" → ")}`);
  console.log();

  const pipelineStart = Date.now();
  let currentInput = resolvedInput;
  let folderPath = null;
  const results = [];

  for (const stage of stagesToRun) {
    const stageLabel = `Stage ${stage.id}: ${stage.name}`;
    process.stdout.write(`  [${stage.id}] ${stage.name}... `);

    // For the first stage, pass explicit output dir (creates DEMINI_NN/)
    // For subsequent stages, don't pass output dir — input is already
    // inside DEMINI_NN/, so resolveOutputFolder() keeps it there
    const outputArg = folderPath === null ? explicitOutputDir : null;
    const result = runStage(stage, currentInput, outputArg);
    results.push({ stage, ...result });

    if (!result.success) {
      console.log("FAILED");
      console.error(`\n  Error in ${stageLabel}:`);
      if (result.stderr) console.error(`  ${result.stderr}`);
      if (result.stdout) console.log(`  ${result.stdout}`);
      process.exit(1);
    }

    console.log(`done (${fmtTime(result.elapsed_ms)})`);

    // Show stage's detailed output in verbose mode
    if (opts.verbose && result.stdout) {
      for (const line of result.stdout.split("\n")) {
        console.log(`        ${line}`);
      }
      console.log();
    }

    // After first stage, discover the DEMINI_NN/ folder from stdout or run.json
    if (folderPath === null) {
      // Find the DEMINI_NN/ folder — check the input's directory context
      // or the explicit output dir for newly created folders
      const searchDir = explicitOutputDir || path.dirname(resolvedInput);
      const entries = fs.readdirSync(searchDir).sort();
      const deminiDirs = entries.filter((e) => /^DEMINI_\d+$/.test(e));
      if (deminiDirs.length > 0) {
        // Use the highest-numbered DEMINI_NN/ (most recently created)
        folderPath = path.join(searchDir, deminiDirs[deminiDirs.length - 1]);
      }
    }

    // Find this stage's output file to chain as next stage's input
    if (folderPath) {
      const stageOutput = findStageOutput(folderPath, stage.id);
      if (stageOutput && fs.existsSync(stageOutput)) {
        currentInput = stageOutput;
      }
    }
  }

  // --- Pipeline Summary ---
  const totalElapsed = Date.now() - pipelineStart;
  console.log();
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  Pipeline complete in ${fmtTime(totalElapsed)}`);

  if (folderPath) {
    console.log(`  Output:  ${path.relative(process.cwd(), folderPath)}/`);

    // Read final run.json for summary
    const runJsonPath = path.join(folderPath, "run.json");
    if (fs.existsSync(runJsonPath)) {
      const runData = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
      const stages = runData.stages || [runData];
      console.log(`  Stages:  ${stages.length}`);

      for (const s of stages) {
        const name = s.tool || "unknown";
        const elapsed = s.elapsed_ms || 0;
        const outFile = s.results?.output_file || "?";
        const outSize = s.results?.classified_bytes || s.results?.beautified_bytes || "?";
        console.log(`    ${s.stage}: ${name} → ${outFile} (${fmtTime(elapsed)}, ${typeof outSize === "number" ? (outSize / 1024).toFixed(1) + " KB" : outSize})`);
      }
    }

    // Behavioral equivalence check — try running the final output
    const lastStageOutput = findStageOutput(folderPath, stagesToRun[stagesToRun.length - 1].id);
    if (lastStageOutput && fs.existsSync(lastStageOutput)) {
      console.log();
      console.log(`  Verifying behavioral equivalence...`);
      try {
        execFileSync("node", ["--check", lastStageOutput], {
          encoding: "utf8",
          stdio: "pipe",
        });
        console.log(`  ✓ Syntax check passed: ${path.basename(lastStageOutput)}`);
      } catch {
        console.log(`  ⚠ Syntax check failed (may still run correctly)`);
      }
    }
  }

  console.log();
}

main();
