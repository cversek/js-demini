/**
 * demini-utils — Shared infrastructure for the demini pipeline
 *
 * DEMINI_NN/ output folder management, provenance tracking, and
 * common utilities shared across all pipeline stages.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEMINI_FOLDER_PATTERN = /^DEMINI_(\d+)$/;
const STAGE_PREFIX_PATTERN = /^\d{2}_/;

/**
 * Read package.json version for provenance tracking.
 * @returns {string}
 */
export function getVersion() {
  const pkgPath = new URL("./package.json", import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

/**
 * Compute SHA-256 hash of file contents.
 * @param {string} filePath - Absolute path to file
 * @returns {string} hex digest
 */
export function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Strip stage prefix (e.g., "00_") from a filename.
 * "00_beautified-bundle.js" → "beautified-bundle.js"
 * "bundle.js" → "bundle.js" (no prefix, unchanged)
 *
 * @param {string} filename
 * @returns {string}
 */
export function stripStagePrefix(filename) {
  return filename.replace(STAGE_PREFIX_PATTERN, "");
}

/**
 * Resolve the output folder for a pipeline stage.
 *
 * Context-aware behavior:
 * - If inputPath is INSIDE a DEMINI_NN/ folder → use that folder (same run)
 * - Otherwise → create the next DEMINI_NN/ folder in baseDir (new run)
 *
 * @param {string} inputPath - Absolute path to input file
 * @param {string} [baseDir] - Base directory for new DEMINI_NN/ folders
 *                              (default: parent of input's directory)
 * @returns {{ folderPath: string, runNumber: number, isExistingRun: boolean }}
 */
export function resolveOutputFolder(inputPath, baseDir) {
  const inputDir = path.dirname(inputPath);
  const inputDirName = path.basename(inputDir);

  // Check if input is already inside a DEMINI_NN/ folder
  const match = inputDirName.match(DEMINI_FOLDER_PATTERN);
  if (match) {
    return {
      folderPath: inputDir,
      runNumber: parseInt(match[1], 10),
      isExistingRun: true,
    };
  }

  // New run — create next DEMINI_NN/ folder
  const effectiveBase = baseDir || inputDir;
  return nextDeminiFolder(effectiveBase);
}

/**
 * Find the next available DEMINI_NN/ folder in the given directory.
 * Scans for existing DEMINI_00/, DEMINI_01/, etc. and returns the
 * path for the next one.
 *
 * @param {string} baseDir - Directory to create DEMINI_NN/ inside
 * @returns {{ folderPath: string, runNumber: number, isExistingRun: false }}
 */
export function nextDeminiFolder(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });

  let maxN = -1;
  for (const entry of fs.readdirSync(baseDir)) {
    const match = entry.match(DEMINI_FOLDER_PATTERN);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxN) maxN = n;
    }
  }

  const runNumber = maxN + 1;
  const folderName = `DEMINI_${String(runNumber).padStart(2, "0")}`;
  const folderPath = path.join(baseDir, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  return { folderPath, runNumber, isExistingRun: false };
}

/**
 * Write run.json provenance sidecar into a DEMINI_NN/ folder.
 *
 * @param {string} folderPath - The DEMINI_NN/ folder
 * @param {object} opts
 * @param {string} opts.tool - Tool name (e.g., "demini-beautify")
 * @param {string} opts.stage - Stage number (e.g., "00")
 * @param {string} opts.inputPath - Absolute path to input file
 * @param {string} opts.inputHash - SHA-256 of input
 * @param {object} opts.settings - Tool-specific settings used
 * @param {number} opts.startTime - Date.now() when processing began
 * @param {object} opts.results - Tool-specific output metrics
 */
export function writeProvenance(folderPath, opts) {
  const provenance = {
    tool: opts.tool,
    version: getVersion(),
    stage: opts.stage,
    timestamp: new Date().toISOString(),
    elapsed_ms: Date.now() - opts.startTime,
    input: {
      path: opts.inputPath,
      hash_sha256: opts.inputHash,
      size_bytes: fs.statSync(opts.inputPath).size,
    },
    settings: opts.settings,
    results: opts.results,
  };

  const runJsonPath = path.join(folderPath, "run.json");

  // If run.json already exists (multi-stage run), merge stages
  if (fs.existsSync(runJsonPath)) {
    const existing = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
    if (!existing.stages) {
      // Convert single-stage to multi-stage format
      existing.stages = [{ ...existing }];
      delete existing.tool;
      delete existing.stage;
      delete existing.timestamp;
      delete existing.elapsed_ms;
      delete existing.input;
      delete existing.settings;
      delete existing.results;
    }
    existing.stages.push(provenance);
    existing.last_updated = new Date().toISOString();
    fs.writeFileSync(runJsonPath, JSON.stringify(existing, null, 2));
  } else {
    fs.writeFileSync(runJsonPath, JSON.stringify(provenance, null, 2));
  }

  return provenance;
}
