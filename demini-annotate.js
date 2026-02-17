#!/usr/bin/env node
/**
 * demini-annotate - AST-based annotation of JavaScript bundles
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * "Mark the cuts before cutting" - Preserves ALL original code verbatim
 * while inserting machine-parseable annotation comments before each
 * top-level AST statement. The output executes identically to the
 * original (JS ignores block comments) but contains rich metadata
 * for analysis and future splitting.
 *
 * Usage:
 *   demini-annotate <input.js> [output-dir]
 *
 * Arguments:
 *   input.js    - JavaScript bundle to annotate (required)
 *   output-dir  - Base directory for DEMINI_NN/ output (default: same dir as input)
 *
 * Output:
 *   DEMINI_NN/01_annotated-{input_basename}.js
 *   DEMINI_NN/01_stats-{input_basename}.json
 *   DEMINI_NN/run.json  (provenance sidecar — appends if exists)
 *
 * Annotation format:
 *   /* === [INDEX] TYPE: CATEGORY | NAME: identifier | LINES: start-end | BYTES: size === * /
 *
 * Designed for esbuild bundles but works on any JavaScript file parsed by acorn.
 */

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import { resolveOutputFolder, stripStagePrefix, hashFile, writeProvenance } from "./demini-utils.js";

// --- Argument Parsing ---

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("demini-annotate: AST-based JavaScript bundle annotator");
  console.error("");
  console.error("Usage: demini-annotate <input.js> [output-dir]");
  console.error("");
  console.error("Arguments:");
  console.error("  input.js    JavaScript bundle to annotate (required)");
  console.error(
    "  output-dir  Base directory for DEMINI_NN/ output (default: same dir as input)"
  );
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`demini-annotate: file not found: ${resolvedInput}`);
  process.exit(1);
}

const explicitOutputDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : null;

// --- Resolve DEMINI_NN/ output folder ---

const { folderPath, runNumber } = resolveOutputFolder(resolvedInput, explicitOutputDir);

const inputBasename = stripStagePrefix(path.basename(resolvedInput));
const annotatedFilename = `01_annotated-${inputBasename}`;
const statsFilename = `01_stats-${inputBasename.replace(/\.js$/, ".json")}`;
const annotatedPath = path.join(folderPath, annotatedFilename);
const statsPath = path.join(folderPath, statsFilename);

console.log("=== demini-annotate ===");
console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${folderPath}`);
console.log(`Run:    DEMINI_${String(runNumber).padStart(2, "0")}`);
console.log("");

// --- Configuration ---

const acornSettings = {
  ecmaVersion: 2022,
  sourceType: "module",
  locations: true,
};

// --- Read & Parse ---

const startTime = Date.now();
const inputHash = hashFile(resolvedInput);

let code = fs.readFileSync(resolvedInput, "utf8");
const originalSize = code.length;

// Strip shebang if present (preserve for output)
let shebang = "";
if (code.startsWith("#!")) {
  const firstNewline = code.indexOf("\n");
  shebang = code.slice(0, firstNewline + 1);
  code = code.slice(firstNewline + 1);
  console.log(`Shebang: ${shebang.trim()}`);
}

console.log("Parsing with acorn...");
const parseStart = Date.now();
const ast = acorn.parse(code, acornSettings);
const parseElapsed = Date.now() - parseStart;
console.log(`Parse time: ${parseElapsed}ms`);
console.log(`Top-level statements: ${ast.body.length}`);

// Detect esbuild runtime helpers by pattern matching
const runtimeHelpers = detectRuntimeHelpers(ast, code);
const helperCount = Object.keys(runtimeHelpers).length;
if (helperCount > 0) {
  console.log(`\nRuntime helpers detected: ${helperCount}`);
  for (const [minified, semantic] of Object.entries(runtimeHelpers)) {
    console.log(`  ${minified} → ${semantic}`);
  }
}
console.log("");

// --- Runtime Helper Detection ---

/**
 * Detect esbuild runtime helper patterns in top-level declarations.
 * Returns a map of { minifiedName: semanticName }.
 *
 * esbuild injects runtime helpers for CJS/ESM interop. When minified,
 * these get arbitrary single-letter names that vary per bundle.
 * We identify them by AST structure + source patterns, not by name.
 *
 * Known helpers and their signatures:
 *   __commonJS: (a, b) => () => (b || a((b = {exports: {}}).exports, b), b.exports)
 *   __esm:      (fn, res) => () => (fn && (res = fn(fn = 0)), res)
 *   __toESM:    Contains __esModule property check
 *   __copyProps: Uses getOwnPropertyNames + defineProperty loop
 */
function detectRuntimeHelpers(ast, code) {
  const helpers = {};

  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;

    for (const decl of node.declarations) {
      if (!decl.init || !decl.id || decl.id.type !== "Identifier") continue;

      const name = decl.id.name;
      const initSrc = code.slice(decl.init.start, decl.init.end);

      // Higher-order arrow pattern: (a, b) => () => (...)
      // Both __commonJS and __esm share this shape
      if (
        decl.init.type === "ArrowFunctionExpression" &&
        decl.init.params.length === 2 &&
        decl.init.body.type === "ArrowFunctionExpression" &&
        decl.init.body.params.length === 0
      ) {
        const innerSrc = code.slice(decl.init.body.start, decl.init.body.end);

        // __commonJS: inner body contains { exports: {} } pattern
        if (innerSrc.includes("exports") && innerSrc.includes("{}")) {
          helpers[name] = "__commonJS";
          continue;
        }

        // __esm: inner body contains nullification (= 0) but not exports
        if (innerSrc.includes("= 0") && !innerSrc.includes("exports")) {
          helpers[name] = "__esm";
          continue;
        }
      }

      // __toESM: must be a FUNCTION containing __esModule property check
      // (not a call site like `var koA = L(J)` whose source doesn't define the logic)
      if (
        (decl.init.type === "ArrowFunctionExpression" ||
          decl.init.type === "FunctionExpression") &&
        (initSrc.includes("__esModule") || initSrc.includes("esModule"))
      ) {
        helpers[name] = "__toESM";
        continue;
      }

      // __copyProps: must be a FUNCTION using getOwnPropertyNames + defineProperty
      if (
        (decl.init.type === "ArrowFunctionExpression" ||
          decl.init.type === "FunctionExpression") &&
        initSrc.includes("getOwnPropertyNames") &&
        initSrc.includes("defineProperty")
      ) {
        helpers[name] = "__copyProps";
        continue;
      }
    }
  }

  return helpers;
}

// --- Classification Functions ---

/**
 * Classify a top-level AST node into a human-readable category.
 *
 * Uses detected runtime helpers for pattern-based factory classification
 * rather than hardcoded minified names.
 */
function classifyNode(node, runtimeHelpers) {
  if (node.type === "VariableDeclaration") {
    for (const decl of node.declarations) {
      // Is this a runtime helper DEFINITION?
      if (
        decl.id &&
        decl.id.type === "Identifier" &&
        runtimeHelpers[decl.id.name]
      ) {
        return "RUNTIME_HELPER";
      }

      // Does this CALL a runtime helper? (module factory wrapping)
      if (
        decl.init &&
        decl.init.type === "CallExpression" &&
        decl.init.callee &&
        decl.init.callee.type === "Identifier"
      ) {
        const callee = decl.init.callee.name;
        const helperName = runtimeHelpers[callee];
        if (helperName === "__commonJS") return "MODULE_FACTORY_COMMONJS";
        if (helperName === "__esm") return "MODULE_FACTORY_ESM";
        if (helperName === "__toESM") return "ADAPTED_IMPORT";
        if (helperName === "__copyProps") return "REEXPORT";
      }
    }
    return "VAR_DECL";
  }
  if (node.type === "FunctionDeclaration") return "FUNCTION_DECL";
  if (node.type === "ClassDeclaration") return "CLASS_DECL";
  if (node.type === "ExpressionStatement") return "EXPRESSION";
  if (node.type === "ExportNamedDeclaration") return "EXPORT_NAMED";
  if (node.type === "ExportDefaultDeclaration") return "EXPORT_DEFAULT";
  if (node.type === "ExportAllDeclaration") return "EXPORT_ALL";
  if (node.type === "ImportDeclaration") return "IMPORT";
  if (node.type === "IfStatement") return "IF_STMT";
  if (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  )
    return "FOR_STMT";
  if (node.type === "WhileStatement" || node.type === "DoWhileStatement")
    return "WHILE_STMT";
  if (node.type === "TryStatement") return "TRY_STMT";
  if (node.type === "SwitchStatement") return "SWITCH_STMT";
  if (node.type === "BlockStatement") return "BLOCK_STMT";
  if (node.type === "EmptyStatement") return "EMPTY";
  return node.type.toUpperCase();
}

/**
 * Extract human-readable name(s) from a node.
 * For multi-declarator var statements (var a=1, b=2), joins all names.
 * When runtime helpers are detected, shows semantic mapping (e.g. "w → __commonJS").
 */
function extractName(node, runtimeHelpers) {
  if (node.type === "VariableDeclaration") {
    const names = node.declarations.map((d) => {
      if (d.id && d.id.type === "Identifier") {
        const baseName = d.id.name;
        // Show semantic name for helper definitions
        const helperName = runtimeHelpers[baseName];
        if (helperName) return `${baseName} → ${helperName}`;
        // Show helper used for factory call sites
        if (
          d.init &&
          d.init.type === "CallExpression" &&
          d.init.callee &&
          d.init.callee.type === "Identifier"
        ) {
          const calleeHelper = runtimeHelpers[d.init.callee.name];
          if (calleeHelper) return `${baseName} (via ${calleeHelper})`;
        }
        return baseName;
      }
      if (d.id && d.id.type === "ObjectPattern") return "{...}";
      if (d.id && d.id.type === "ArrayPattern") return "[...]";
      return "?";
    });
    return names.join(", ");
  }
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (node.type === "ClassDeclaration" && node.id) return node.id.name;
  if (node.type === "ExportNamedDeclaration" && node.declaration) {
    return extractName(node.declaration, runtimeHelpers);
  }
  if (node.type === "ExportDefaultDeclaration" && node.declaration) {
    if (node.declaration.id) return node.declaration.id.name;
    return "default";
  }
  return "-";
}

// --- Build Annotated Output ---

console.log("Annotating top-level statements...");

let output = shebang;
let lastEnd = 0;

const stats = {
  input_file: resolvedInput,
  original_size: originalSize,
  body_size: code.length,
  shebang_size: shebang.length,
  runtime_helpers: runtimeHelpers,
  total_statements: 0,
  categories: {},
  total_bytes_statements: 0,
  total_bytes_gaps: 0,
  annotation_bytes: 0,
  statements: [],
};

for (let i = 0; i < ast.body.length; i++) {
  const node = ast.body[i];

  // Preserve any gap between previous node end and this node start.
  if (node.start > lastEnd) {
    const gap = code.slice(lastEnd, node.start);
    output += gap;
    stats.total_bytes_gaps += gap.length;
  }

  const category = classifyNode(node, runtimeHelpers);
  const name = extractName(node, runtimeHelpers);
  const stmtCode = code.slice(node.start, node.end);
  const paddedIndex = String(i).padStart(4, "0");

  // Machine-parseable annotation comment
  const annotation = `/* === [${paddedIndex}] TYPE: ${category} | NAME: ${name} | LINES: ${node.loc.start.line}-${node.loc.end.line} | BYTES: ${stmtCode.length} === */\n`;

  output += annotation + stmtCode;
  stats.annotation_bytes += annotation.length;
  lastEnd = node.end;

  stats.total_statements++;
  stats.categories[category] = (stats.categories[category] || 0) + 1;
  stats.total_bytes_statements += stmtCode.length;
  stats.statements.push({
    index: i,
    category,
    name: name !== "-" ? name : null,
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    bytes: stmtCode.length,
  });
}

// Preserve trailing content after last AST node
if (lastEnd < code.length) {
  const trailing = code.slice(lastEnd);
  output += trailing;
  stats.total_bytes_gaps += trailing.length;
}

// --- Byte Accounting Verification ---

const accountedBytes = stats.total_bytes_statements + stats.total_bytes_gaps;
const accountingMatch = accountedBytes === code.length;

console.log("");
console.log("=== Byte Accounting ===");
console.log(`Original file:     ${originalSize.toLocaleString()} bytes`);
console.log(`Shebang:           ${shebang.length.toLocaleString()} bytes`);
console.log(`Code body:         ${code.length.toLocaleString()} bytes`);
console.log(
  `Statement bytes:   ${stats.total_bytes_statements.toLocaleString()} bytes`
);
console.log(
  `Gap bytes:         ${stats.total_bytes_gaps.toLocaleString()} bytes`
);
console.log(`Accounted:         ${accountedBytes.toLocaleString()} bytes`);
console.log(
  `Match:             ${accountingMatch ? "✅ 100%" : "❌ MISMATCH"}`
);
if (!accountingMatch) {
  console.log(
    `  DELTA: ${(code.length - accountedBytes).toLocaleString()} bytes unaccounted`
  );
}
console.log(
  `Annotation overhead: ${stats.annotation_bytes.toLocaleString()} bytes`
);
console.log(`Output size:       ${output.length.toLocaleString()} bytes`);

// --- Write Outputs ---

fs.writeFileSync(annotatedPath, output);
console.log(`\nWrote: ${annotatedPath}`);

stats.byte_accounting_match = accountingMatch;
fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
console.log(`Wrote: ${statsPath}`);

// Write provenance
writeProvenance(folderPath, {
  tool: "demini-annotate",
  stage: "01",
  inputPath: resolvedInput,
  inputHash,
  settings: acornSettings,
  startTime,
  results: {
    total_statements: stats.total_statements,
    categories: stats.categories,
    original_bytes: originalSize,
    annotated_bytes: output.length,
    annotation_overhead_bytes: stats.annotation_bytes,
    byte_accounting_match: accountingMatch,
    parse_ms: parseElapsed,
    output_file: annotatedFilename,
    stats_file: statsFilename,
  },
});
console.log(`Provenance: ${path.join(folderPath, "run.json")}`);

// --- Summary Table ---

console.log("\n=== Statement Classification ===");
const sorted = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);
for (const [cat, count] of sorted) {
  const pct = ((count / stats.total_statements) * 100).toFixed(1);
  const catBytes = stats.statements
    .filter((s) => s.category === cat)
    .reduce((sum, s) => sum + s.bytes, 0);
  const bytePct = ((catBytes / stats.total_bytes_statements) * 100).toFixed(1);
  console.log(
    `  ${cat.padEnd(20)} ${String(count).padStart(5)} stmts (${pct}%)  ${catBytes.toLocaleString().padStart(12)} bytes (${bytePct}%)`
  );
}

console.log(
  `\n  ${"TOTAL".padEnd(20)} ${String(stats.total_statements).padStart(5)} stmts        ${stats.total_bytes_statements.toLocaleString().padStart(12)} bytes`
);

console.log("\n✅ demini-annotate complete!");
console.log(`\nVerify: node "${annotatedPath}" --version`);
