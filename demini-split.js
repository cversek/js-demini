#!/usr/bin/env node
/**
 * demini-split - Module extraction from traced bundles
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Reads a traced JS bundle + its trace JSON (from demini-trace), splits
 * the monolithic bundle into individual module files using AST-precise
 * character ranges. Each extracted module is verified to parse independently.
 *
 * Usage:
 *   demini-split <input.js> [output-dir]
 *
 * Input:
 *   A traced JS file inside a DEMINI_NN/ folder with a corresponding
 *   02_trace-*.json file (produced by demini-trace).
 *
 * Output:
 *   DEMINI_NN/03_split-{basename}/mod_NNNN_{name}.js  — per-module files
 *   DEMINI_NN/03_split-{basename}/manifest.json        — module index
 *   DEMINI_NN/03_stats-{basename}.json                 — split statistics
 *   DEMINI_NN/run.json                                  — provenance (appends)
 *
 * Designed for esbuild bundles. Uses acorn for AST-precise extraction.
 */

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import { resolveOutputFolder, stripStagePrefix, hashFile, writeProvenance } from "./demini-utils.js";

// --- Argument Parsing ---

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("demini-split: module extraction from traced bundles");
  console.error("");
  console.error("Usage: demini-split <input.js> [output-dir]");
  console.error("");
  console.error("Arguments:");
  console.error("  input.js    Traced JS bundle (from demini-trace) inside DEMINI_NN/");
  console.error("  output-dir  Base directory for DEMINI_NN/ output (default: same dir as input)");
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`demini-split: file not found: ${resolvedInput}`);
  process.exit(1);
}

const explicitOutputDir = process.argv[3] ? path.resolve(process.argv[3]) : null;

// --- Resolve DEMINI_NN/ output folder ---

const { folderPath, runNumber } = resolveOutputFolder(resolvedInput, explicitOutputDir);

const inputBasename = stripStagePrefix(path.basename(resolvedInput));
// Strip additional stage prefixes that accumulate (e.g., "traced-classified-beautified-bundle.js")
const coreBasename = inputBasename
  .replace(/^traced-/, "")
  .replace(/^classified-/, "")
  .replace(/^beautified-/, "");

const splitDirName = `03_split-${coreBasename.replace(/\.js$/, "")}`;
const splitDir = path.join(folderPath, splitDirName);
const statsFilename = `03_stats-${coreBasename.replace(/\.js$/, ".json")}`;
const statsPath = path.join(folderPath, statsFilename);

console.log("=== demini-split ===");
console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${splitDir}`);
console.log(`Run:    DEMINI_${String(runNumber).padStart(2, "0")}`);
console.log("");

// --- Find trace JSON ---

function findTraceJson(folder) {
  const entries = fs.readdirSync(folder);
  const traceFiles = entries.filter(e => e.startsWith("02_trace-") && e.endsWith(".json"));
  if (traceFiles.length === 0) {
    console.error("demini-split: no 02_trace-*.json found in DEMINI folder");
    console.error(`Searched: ${folder}`);
    console.error("Run demini-trace first.");
    process.exit(1);
  }
  if (traceFiles.length > 1) {
    console.warn(`Warning: multiple trace JSONs found, using first: ${traceFiles[0]}`);
  }
  return path.join(folder, traceFiles[0]);
}

const traceJsonPath = findTraceJson(folderPath);
const traceData = JSON.parse(fs.readFileSync(traceJsonPath, "utf8"));
console.log(`Trace JSON: ${path.basename(traceJsonPath)}`);
console.log(`Modules: ${traceData.modules.length}`);
console.log(`Statements: ${traceData.statements.length}`);
console.log("");

// --- Parse input with acorn ---

const startTime = Date.now();
const inputHash = hashFile(resolvedInput);

let code = fs.readFileSync(resolvedInput, "utf8");

// Strip shebang if present
let shebang = "";
if (code.startsWith("#!")) {
  const firstNewline = code.indexOf("\n");
  shebang = code.slice(0, firstNewline + 1);
  code = code.slice(firstNewline + 1);
}

const acornSettings = {
  ecmaVersion: "latest",
  sourceType: "module",
  locations: true,
};

console.log("Parsing with acorn...");
const ast = acorn.parse(code, acornSettings);
console.log(`Top-level statements: ${ast.body.length}`);

// Validate statement count matches trace
if (ast.body.length !== traceData.statements.length) {
  console.warn(`Warning: AST has ${ast.body.length} statements but trace has ${traceData.statements.length}`);
  console.warn("Line numbers may not align. Using AST statement indices from trace.");
}

// --- Extract modules ---

fs.mkdirSync(splitDir, { recursive: true });

const manifest = {
  source: resolvedInput,
  trace_json: traceJsonPath,
  tool: "demini-split",
  timestamp: new Date().toISOString(),
  modules: [],
};

let totalExtracted = 0;
let parseSuccessCount = 0;
let parseFailCount = 0;
const parseFailures = [];

for (const mod of traceData.modules) {
  const stmtIndices = mod.statements;
  if (stmtIndices.length === 0) continue;

  // Collect AST nodes for this module's statements
  const nodes = [];
  for (const si of stmtIndices) {
    if (si < ast.body.length) {
      nodes.push(ast.body[si]);
    }
  }
  if (nodes.length === 0) continue;

  // Extract code by character range (first node start to last node end)
  // Sort by position to handle non-contiguous statement indices
  nodes.sort((a, b) => a.start - b.start);
  const charStart = nodes[0].start;
  const charEnd = nodes[nodes.length - 1].end;
  const moduleCode = code.slice(charStart, charEnd);

  // Determine filename
  // Get first defined name from trace statements
  let firstName = null;
  for (const si of stmtIndices) {
    const stmtData = traceData.statements[si];
    if (stmtData && stmtData.names && stmtData.names.length > 0) {
      firstName = stmtData.names[0];
      break;
    }
  }

  const idStr = String(mod.id).padStart(4, "0");
  let filename;
  if (mod.wrapKind === "RUNTIME") {
    filename = `mod_${idStr}_RUNTIME.js`;
  } else if (mod.wrapKind === "None" && stmtIndices.length > 5) {
    // Large "None" module is likely the toplevel/entrypoint
    filename = `mod_${idStr}_TOPLEVEL.js`;
  } else if (firstName) {
    filename = `mod_${idStr}_${firstName}.js`;
  } else {
    filename = `mod_${idStr}_${mod.wrapKind}.js`;
  }

  const modulePath = path.join(splitDir, filename);
  fs.writeFileSync(modulePath, moduleCode);
  totalExtracted++;

  // Verify the extracted module parses independently
  let parseable = false;
  try {
    acorn.parse(moduleCode, { ecmaVersion: "latest", sourceType: "module" });
    parseable = true;
    parseSuccessCount++;
  } catch {
    // Try as script (some CJS modules aren't valid ESM)
    try {
      acorn.parse(moduleCode, { ecmaVersion: "latest", sourceType: "script" });
      parseable = true;
      parseSuccessCount++;
    } catch (e) {
      parseFailCount++;
      parseFailures.push({ id: mod.id, filename, error: e.message });
    }
  }

  manifest.modules.push({
    id: mod.id,
    filename,
    wrapKind: mod.wrapKind,
    firstName: firstName || null,
    stmtCount: stmtIndices.length,
    stmtIndices,
    line_start: mod.line_start,
    line_end: mod.line_end,
    char_start: charStart,
    char_end: charEnd,
    bytes: moduleCode.length,
    deps_out: mod.deps_out,
    deps_in: mod.deps_in,
    parseable,
  });
}

// --- Write manifest ---

const manifestPath = path.join(splitDir, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// --- Write stats ---

const stats = {
  total_modules: traceData.modules.length,
  extracted: totalExtracted,
  parse_success: parseSuccessCount,
  parse_fail: parseFailCount,
  parse_failures: parseFailures,
  by_wrapKind: {},
  total_bytes_extracted: manifest.modules.reduce((sum, m) => sum + m.bytes, 0),
  source_bytes: code.length,
  coverage_pct: ((manifest.modules.reduce((sum, m) => sum + m.bytes, 0) / code.length) * 100).toFixed(1),
};

for (const m of manifest.modules) {
  const kind = m.wrapKind;
  if (!stats.by_wrapKind[kind]) stats.by_wrapKind[kind] = { count: 0, bytes: 0 };
  stats.by_wrapKind[kind].count++;
  stats.by_wrapKind[kind].bytes += m.bytes;
}

fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

// --- Console summary ---

const elapsed = Date.now() - startTime;
console.log(`\n=== Split complete ===`);
console.log(`Modules extracted: ${totalExtracted}/${traceData.modules.length}`);
console.log(`Parse success: ${parseSuccessCount}, fail: ${parseFailCount}`);
console.log(`Coverage: ${stats.coverage_pct}% of source bytes`);
console.log(`Elapsed: ${elapsed}ms`);
console.log("");

for (const [kind, data] of Object.entries(stats.by_wrapKind)) {
  console.log(`  ${kind}: ${data.count} modules, ${(data.bytes / 1024).toFixed(1)}K`);
}

if (parseFailures.length > 0) {
  console.log(`\nParse failures:`);
  for (const f of parseFailures) {
    console.log(`  ${f.filename}: ${f.error}`);
  }
}

console.log(`\nWrote: ${splitDir}/`);
console.log(`Wrote: ${statsPath}`);

// --- Provenance ---

writeProvenance(folderPath, {
  tool: "demini-split",
  stage: "03",
  inputPath: resolvedInput,
  inputHash,
  startTime,
  settings: {
    acornVersion: acornSettings.ecmaVersion,
    sourceType: acornSettings.sourceType,
    traceJson: path.basename(traceJsonPath),
  },
  results: {
    modules_extracted: totalExtracted,
    parse_success: parseSuccessCount,
    parse_fail: parseFailCount,
    coverage_pct: parseFloat(stats.coverage_pct),
    elapsed_ms: elapsed,
  },
});
