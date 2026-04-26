#!/usr/bin/env node
/**
 * demini-extract - Green BKG extraction from pipeline artifacts
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Synthesizes classify stats, trace graph, split manifest, string literals,
 * and AST fingerprints into an initial "green" Bundle Knowledge Graph (BKG).
 * No reference source needed — purely structural intelligence.
 *
 * Usage:
 *   demini-extract <input.js> [output-dir]
 *
 * Input:
 *   Any JS file inside a DEMINI_NN/ folder that has trace + split output.
 *   Automatically discovers 01_stats, 02_trace, 03_split artifacts.
 *
 * Output:
 *   DEMINI_NN/04_bkg-{basename}.json  — Green BKG
 *   DEMINI_NN/run.json                 — provenance (appends)
 */

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { resolveOutputFolder, stripStagePrefix, hashFile, writeProvenance } from "./demini-utils.js";

// --- Argument Parsing ---

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("demini-extract: green BKG extraction from pipeline artifacts");
  console.error("");
  console.error("Usage: demini-extract <input.js> [output-dir]");
  console.error("");
  console.error("Arguments:");
  console.error("  input.js    Any JS file inside a DEMINI_NN/ folder");
  console.error("  output-dir  Base directory for DEMINI_NN/ output (default: same dir as input)");
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`demini-extract: file not found: ${resolvedInput}`);
  process.exit(1);
}

const explicitOutputDir = process.argv[3] ? path.resolve(process.argv[3]) : null;

// --- Resolve DEMINI_NN/ output folder ---

const { folderPath, runNumber } = resolveOutputFolder(resolvedInput, explicitOutputDir);

const inputBasename = stripStagePrefix(path.basename(resolvedInput));
const coreBasename = inputBasename
  .replace(/^traced-/, "")
  .replace(/^classified-/, "")
  .replace(/^beautified-/, "");
const bkgFilename = `04_bkg-${coreBasename.replace(/\.js$/, ".json")}`;
const bkgPath = path.join(folderPath, bkgFilename);

console.log("=== demini-extract ===");
console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${bkgPath}`);
console.log(`Run:    DEMINI_${String(runNumber).padStart(2, "0")}`);
console.log("");

const startTime = Date.now();
const inputHash = hashFile(resolvedInput);

// --- Discover pipeline artifacts ---

function findFile(folder, pattern) {
  const entries = fs.readdirSync(folder);
  const matches = entries.filter(e => pattern.test(e));
  return matches.length > 0 ? path.join(folder, matches[0]) : null;
}

function findDir(folder, pattern) {
  const entries = fs.readdirSync(folder);
  const matches = entries.filter(e => pattern.test(e) && fs.statSync(path.join(folder, e)).isDirectory());
  return matches.length > 0 ? path.join(folder, matches[0]) : null;
}

const statsFile = findFile(folderPath, /^01_stats-.*\.json$/);
const traceFile = findFile(folderPath, /^02_trace-.*\.json$/);
const splitDir = findDir(folderPath, /^03_split-/);

if (!traceFile) {
  console.error("demini-extract: no 02_trace-*.json found. Run demini-trace first.");
  process.exit(1);
}

console.log(`Classify stats: ${statsFile ? path.basename(statsFile) : "(not found)"}`);
console.log(`Trace JSON:     ${path.basename(traceFile)}`);
console.log(`Split dir:      ${splitDir ? path.basename(splitDir) : "(not found)"}`);
console.log("");

// --- Load artifacts ---

const traceData = JSON.parse(fs.readFileSync(traceFile, "utf8"));
const classifyStats = statsFile ? JSON.parse(fs.readFileSync(statsFile, "utf8")) : null;

let splitManifest = null;
if (splitDir) {
  const manifestPath = path.join(splitDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    splitManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }
}

console.log(`Modules: ${traceData.modules.length}`);
console.log(`Statements: ${traceData.statements.length}`);

// --- Read source for string/AST extraction ---

let code = fs.readFileSync(resolvedInput, "utf8");
if (code.startsWith("#!")) {
  code = code.slice(code.indexOf("\n") + 1);
}

const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });

// --- Build module ID map ---

// Map numeric trace IDs to string BKG IDs
function makeModuleId(traceMod, stmtData) {
  // Use first defined name if available
  let name = null;
  for (const si of traceMod.statements) {
    const stmt = stmtData[si];
    if (stmt && stmt.names && stmt.names.length > 0) {
      name = stmt.names[0];
      break;
    }
  }
  return name ? `mod:${name}` : `mod:${traceMod.id}`;
}

const traceIdToBkgId = new Map();
for (const mod of traceData.modules) {
  const bkgId = makeModuleId(mod, traceData.statements);
  traceIdToBkgId.set(mod.id, bkgId);
}

// --- Extract strings and AST fingerprints per module ---

function extractStringsFromCode(moduleCode) {
  const strings = new Set();
  try {
    const moduleAst = acorn.parse(moduleCode, { ecmaVersion: "latest", sourceType: "module" });
    walk.simple(moduleAst, {
      Literal(node) {
        if (typeof node.value === "string" && node.value.length >= 2 && node.value.length <= 200) {
          strings.add(node.value);
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (quasi.value.cooked && quasi.value.cooked.length >= 2) {
            strings.add(quasi.value.cooked);
          }
        }
      },
    });
  } catch {
    // Parse failure — skip string extraction
  }
  return [...strings].sort();
}

function computeAstFingerprint(moduleCode) {
  try {
    const moduleAst = acorn.parse(moduleCode, { ecmaVersion: "latest", sourceType: "module" });
    // Depth-limited type sequence — captures structural skeleton
    const types = [];
    walk.simple(moduleAst, {
      FunctionDeclaration() { types.push("FD"); },
      FunctionExpression() { types.push("FE"); },
      ArrowFunctionExpression() { types.push("AF"); },
      ClassDeclaration() { types.push("CD"); },
      ClassExpression() { types.push("CE"); },
      IfStatement() { types.push("IF"); },
      ForStatement() { types.push("FOR"); },
      ForInStatement() { types.push("FIN"); },
      ForOfStatement() { types.push("FOF"); },
      WhileStatement() { types.push("WH"); },
      SwitchStatement() { types.push("SW"); },
      TryStatement() { types.push("TRY"); },
      ReturnStatement() { types.push("RET"); },
      ThrowStatement() { types.push("THR"); },
      YieldExpression() { types.push("YLD"); },
      AwaitExpression() { types.push("AWT"); },
      NewExpression() { types.push("NEW"); },
    });
    return types.join(":");
  } catch {
    return null;
  }
}

console.log("\nExtracting strings and AST fingerprints...");

// Get module code from split files or from source character ranges
function getModuleCode(traceMod) {
  // Prefer split files if available
  if (splitManifest) {
    const splitMod = splitManifest.modules.find(m => m.id === traceMod.id);
    if (splitMod) {
      const modPath = path.join(splitDir, splitMod.filename);
      if (fs.existsSync(modPath)) {
        return fs.readFileSync(modPath, "utf8");
      }
    }
  }

  // Fallback: extract from source by statement character ranges
  const nodes = [];
  for (const si of traceMod.statements) {
    if (si < ast.body.length) {
      nodes.push(ast.body[si]);
    }
  }
  if (nodes.length === 0) return "";
  nodes.sort((a, b) => a.start - b.start);
  return code.slice(nodes[0].start, nodes[nodes.length - 1].end);
}

// --- Build BKG modules ---

const bkgModules = [];
let modulesWithStrings = 0;
let totalStrings = 0;

for (const traceMod of traceData.modules) {
  const bkgId = traceIdToBkgId.get(traceMod.id);
  const moduleCode = getModuleCode(traceMod);

  // Get first name
  let firstName = null;
  for (const si of traceMod.statements) {
    const stmt = traceData.statements[si];
    if (stmt && stmt.names && stmt.names.length > 0) {
      firstName = stmt.names[0];
      break;
    }
  }

  // Character ranges from AST
  const nodes = [];
  for (const si of traceMod.statements) {
    if (si < ast.body.length) nodes.push(ast.body[si]);
  }
  nodes.sort((a, b) => a.start - b.start);
  const charStart = nodes.length > 0 ? nodes[0].start : 0;
  const charEnd = nodes.length > 0 ? nodes[nodes.length - 1].end : 0;

  const strings = extractStringsFromCode(moduleCode);
  if (strings.length > 0) modulesWithStrings++;
  totalStrings += strings.length;

  const fingerprint = computeAstFingerprint(moduleCode);

  bkgModules.push({
    id: bkgId,
    minified_name: firstName || String(traceMod.id),
    semantic_name: null,
    semantic_confidence: null,
    semantic_source: null,
    source_file: null,
    wrapKind: traceMod.wrapKind,
    range: {
      startLine: traceMod.line_start,
      endLine: traceMod.line_end,
      charStart,
      charEnd,
    },
    bytes: moduleCode.length,
    stmtCount: traceMod.statements.length,
    strings: strings.slice(0, 50),  // Cap at 50 most useful strings per module
    ast_fingerprint: fingerprint,
    exports: [],  // Populated by future enrichment
    deps_out: traceMod.deps_out.map(id => traceIdToBkgId.get(id) || `mod:${id}`),
    deps_in: traceMod.deps_in.map(id => traceIdToBkgId.get(id) || `mod:${id}`),
  });
}

console.log(`Strings extracted: ${totalStrings} across ${modulesWithStrings} modules`);
console.log(`AST fingerprints: ${bkgModules.filter(m => m.ast_fingerprint).length}/${bkgModules.length}`);

// --- Detect bundler ---

let bundler = "unknown";
if (classifyStats && classifyStats.bundler) {
  bundler = classifyStats.bundler;
} else {
  // Heuristic from runtime helpers
  const runtimeMod = bkgModules.find(m => m.wrapKind === "RUNTIME");
  if (runtimeMod && runtimeMod.strings.some(s => s.includes("__commonJS") || s.includes("__esm"))) {
    bundler = "esbuild";
  }
}

// --- Assemble BKG ---

const bkg = {
  bkg_version: "1.0",
  bundle: {
    file: path.basename(resolvedInput),
    version: null,
    bundler,
    size_bytes: code.length,
    total_modules: traceData.modules.length,
    total_statements: traceData.statements.length,
    hash_sha256: inputHash,
  },
  reference: null,
  modules: bkgModules,
  identifiers: [],  // Populated by future enrichment (variable-level)
  annotations: [],  // Populated by manual/inferred annotations
  enrichments: [{
    timestamp: new Date().toISOString(),
    technique: "green_extraction",
    reference_version: null,
    modules_enriched: bkgModules.length,
    identifiers_enriched: 0,
    provenance: "demini-extract v1.0",
  }],
  coverage: {
    modules_named: 0,  // Green BKG has no semantic names yet
    modules_total: bkgModules.length,
    identifiers_semantic: 0,
    identifiers_placeholder: 0,
    identifiers_raw: 0,
    identifier_coverage_semantic: 0,
    identifier_coverage_touched: 0,
  },
};

// --- Write BKG ---

fs.writeFileSync(bkgPath, JSON.stringify(bkg, null, 2));

const elapsed = Date.now() - startTime;
const bkgSize = fs.statSync(bkgPath).size;

console.log(`\n=== BKG extraction complete ===`);
console.log(`Modules: ${bkg.modules.length}`);
console.log(`Strings: ${totalStrings} (${modulesWithStrings} modules with strings)`);
console.log(`AST fingerprints: ${bkgModules.filter(m => m.ast_fingerprint).length}`);
console.log(`Bundler: ${bundler}`);
console.log(`BKG size: ${(bkgSize / 1024).toFixed(1)}K`);
console.log(`Elapsed: ${elapsed}ms`);
console.log(`\nWrote: ${bkgPath}`);

// --- Provenance ---

writeProvenance(folderPath, {
  tool: "demini-extract",
  stage: "04",
  inputPath: resolvedInput,
  inputHash,
  startTime,
  settings: {
    traceJson: path.basename(traceFile),
    splitDir: splitDir ? path.basename(splitDir) : null,
    classifyStats: statsFile ? path.basename(statsFile) : null,
    stringCap: 50,
  },
  results: {
    modules: bkg.modules.length,
    total_strings: totalStrings,
    modules_with_strings: modulesWithStrings,
    ast_fingerprints: bkgModules.filter(m => m.ast_fingerprint).length,
    bkg_size_bytes: bkgSize,
    elapsed_ms: elapsed,
  },
});
