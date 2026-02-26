#!/usr/bin/env node
/**
 * demini-classify - AST-based structural classification of JavaScript bundles
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
 *   demini-classify <input.js> [output-dir]
 *
 * Arguments:
 *   input.js    - JavaScript bundle to annotate (required)
 *   output-dir  - Base directory for DEMINI_NN/ output (default: same dir as input)
 *
 * Output:
 *   DEMINI_NN/01_classified-{input_basename}.js
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
  console.error("demini-classify: AST-based JavaScript bundle annotator");
  console.error("");
  console.error("Usage: demini-classify <input.js> [output-dir]");
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
  console.error(`demini-classify: file not found: ${resolvedInput}`);
  process.exit(1);
}

const explicitOutputDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : null;

// --- Resolve DEMINI_NN/ output folder ---

const { folderPath, runNumber } = resolveOutputFolder(resolvedInput, explicitOutputDir);

const inputBasename = stripStagePrefix(path.basename(resolvedInput));
const classifiedFilename = `01_classified-${inputBasename}`;
const statsFilename = `01_stats-${inputBasename.replace(/\.js$/, ".json")}`;
const classifiedPath = path.join(folderPath, classifiedFilename);
const statsPath = path.join(folderPath, statsFilename);

console.log("=== demini-classify ===");
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

// Detect bundle type from structural signatures
const bundleType = detectBundleType(ast, code, runtimeHelpers);
console.log(`Bundle type: ${bundleType.bundler} (${bundleType.confidence} confidence)`);
for (const sig of bundleType.signals) {
  console.log(`  signal: ${sig}`);
}
console.log("");

// --- Bundle Type Detection ---

/**
 * Detect the bundler that produced this bundle from structural signatures.
 * Returns an object: { bundler: "esbuild"|"unknown", confidence: "high"|"medium"|"low", signals: string[] }
 *
 * esbuild detection signals (by AST shape, not name — per D3):
 *   - __commonJS helper: higher-order arrow (a,b) => () => (...exports...)
 *   - __esm helper: higher-order arrow (a,b) => () => (...= 0...)
 *   - __toESM helper: function containing __esModule check
 *   - __copyProps helper: function using getOwnPropertyNames + defineProperty
 *   - Object.create/defineProperty/getOwnPropertyDescriptor/getOwnPropertyNames boilerplate
 *   - createRequire(import.meta.url) banner pattern
 */
function detectBundleType(ast, code, runtimeHelpers) {
  const signals = [];

  // Check for esbuild runtime helpers (already detected)
  const helperNames = Object.values(runtimeHelpers);
  if (helperNames.includes("__commonJS")) signals.push("__commonJS helper detected");
  if (helperNames.includes("__esm")) signals.push("__esm helper detected");
  if (helperNames.includes("__toESM")) signals.push("__toESM helper detected");
  if (helperNames.includes("__copyProps")) signals.push("__copyProps helper detected");

  // Check for Object.* boilerplate at start (esbuild CJS preamble)
  const preamblePatterns = ["Object.create", "Object.defineProperty", "Object.getOwnPropertyDescriptor", "Object.getOwnPropertyNames"];
  const first5 = ast.body.slice(0, 5);
  let preambleCount = 0;
  for (const node of first5) {
    const src = code.slice(node.start, node.end);
    for (const pat of preamblePatterns) {
      if (src.includes(pat)) { preambleCount++; break; }
    }
  }
  if (preambleCount >= 3) signals.push("Object.* preamble (3+ in first 5 statements)");

  // Check for createRequire banner (ESM format esbuild bundles)
  if (code.includes("createRequire") && code.includes("import.meta.url")) {
    signals.push("createRequire(import.meta.url) banner");
  }

  // Determine bundler
  if (signals.length >= 2) return { bundler: "esbuild", confidence: "high", signals };
  if (signals.length === 1) return { bundler: "esbuild", confidence: "medium", signals };
  return { bundler: "unknown", confidence: "low", signals };
}

// --- WrapKind Classification ---

/**
 * Classify a statement's WrapKind based on its category (from classifyNode).
 *
 * WrapKind describes the module wrapping architecture:
 *   CJS     — __commonJS closure: var x = __commonJS((exports, module) => { ... })
 *   ESM     — __esm terminator or ESM interop adapter (__toESM, __copyProps)
 *   RUNTIME — Runtime helper definition (not a module, but interop infrastructure)
 *   None    — Bare inline code with no module wrapper
 *
 * Note: ESM back-tracing (hoisted vars above __esm calls) is a Phase 2 (trace)
 * concern. Phase 1.5 classifies each statement individually by its own shape.
 */
function classifyWrapKind(category) {
  if (category.startsWith("MODULE_FACTORY.__commonJS")) return "CJS";
  if (category.startsWith("MODULE_FACTORY.__esm")) return "ESM";
  if (category.startsWith("ADAPTED_IMPORT.__toESM")) return "ESM";
  if (category.startsWith("REEXPORT.__copyProps")) return "ESM";
  if (category.startsWith("RUNTIME_HELPER")) return "RUNTIME";
  return "None";
}

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
  // Known esbuild helper names (non-minified bundles use these directly)
  const knownHelpers = { __commonJS: "__commonJS", __esm: "__esm", __toESM: "__toESM", __copyProps: "__copyProps" };

  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;

    for (const decl of node.declarations) {
      if (!decl.init || !decl.id || decl.id.type !== "Identifier") continue;

      const name = decl.id.name;
      // Name-based detection (non-minified bundles)
      if (knownHelpers[name]) { helpers[name] = knownHelpers[name]; continue; }
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
        const innerNorm = innerSrc.replace(/\s+/g, '');

        // __commonJS: inner body contains { exports: {} } pattern
        if (innerNorm.includes("exports") && innerNorm.includes("{}")) {
          helpers[name] = "__commonJS";
          continue;
        }

        // __esm: inner body contains nullification (=0) but not exports
        if (innerNorm.includes("=0") && !innerNorm.includes("exports")) {
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
function classifyNode(node, runtimeHelpers, stmtIndex = Infinity) {
  if (node.type === "VariableDeclaration") {
    // Scan ALL declarators — multi-declarator vars may contain multiple helpers
    // (newer esbuild merges consecutive var declarations into one statement)
    const helperSubtypes = new Set();
    const factoryCategories = new Set();

    for (const decl of node.declarations) {
      // Is this a runtime helper DEFINITION?
      if (
        decl.id &&
        decl.id.type === "Identifier" &&
        runtimeHelpers[decl.id.name]
      ) {
        helperSubtypes.add(runtimeHelpers[decl.id.name]);
        continue;
      }

      // Is this an esbuild Object.* preamble alias?
      // Pattern: var X = Object.create / .defineProperty / .getOwnPropertyDescriptor /
      //          .getOwnPropertyNames / .getPrototypeOf / .prototype.hasOwnProperty
      // Only in first 10 statements to prevent false positives deeper in bundle.
      if (stmtIndex < 10 && decl.init && decl.init.type === "MemberExpression") {
        const obj = decl.init.object;
        const prop = decl.init.property;
        // Direct: Object.<method>
        if (obj.type === "Identifier" && obj.name === "Object" && prop.type === "Identifier") {
          const known = ["create", "defineProperty", "getOwnPropertyDescriptor", "getOwnPropertyNames", "getPrototypeOf"];
          if (known.includes(prop.name)) { helperSubtypes.add("preamble"); continue; }
        }
        // Chained: Object.prototype.hasOwnProperty
        if (obj.type === "MemberExpression" &&
            obj.object.type === "Identifier" && obj.object.name === "Object" &&
            obj.property.type === "Identifier" && obj.property.name === "prototype" &&
            prop.type === "Identifier" && prop.name === "hasOwnProperty") {
          helperSubtypes.add("preamble"); continue;
        }
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
        if (helperName === "__commonJS") { factoryCategories.add("MODULE_FACTORY.__commonJS"); continue; }
        if (helperName === "__esm") { factoryCategories.add("MODULE_FACTORY.__esm"); continue; }
        if (helperName === "__toESM") { factoryCategories.add("ADAPTED_IMPORT.__toESM"); continue; }
        if (helperName === "__copyProps") { factoryCategories.add("REEXPORT.__copyProps"); continue; }
      }
    }

    // Helper definitions take priority (they define the interop layer)
    if (helperSubtypes.size > 0) {
      const sorted = [...helperSubtypes].sort();
      return `RUNTIME_HELPER.${sorted.join("+")}`;
    }
    // Factory calls next
    if (factoryCategories.size > 0) {
      const sorted = [...factoryCategories].sort();
      return sorted.join("+");
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
  bundler: bundleType.bundler,
  bundler_confidence: bundleType.confidence,
  bundler_signals: bundleType.signals,
  runtime_helpers: runtimeHelpers,
  total_statements: 0,
  categories: {},
  wrapkind_distribution: { CJS: 0, ESM: 0, RUNTIME: 0, None: 0 },
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

  const category = classifyNode(node, runtimeHelpers, i);
  const wrapKind = classifyWrapKind(category);
  const name = extractName(node, runtimeHelpers);
  const stmtCode = code.slice(node.start, node.end);
  const paddedIndex = String(i).padStart(4, "0");

  // Machine-parseable annotation comment (enriched with WRAPKIND)
  const annotation = `/* === [${paddedIndex}] TYPE: ${category} | WRAPKIND: ${wrapKind} | NAME: ${name} | LINES: ${node.loc.start.line}-${node.loc.end.line} | BYTES: ${stmtCode.length} === */\n`;

  output += annotation + stmtCode;
  stats.annotation_bytes += annotation.length;
  lastEnd = node.end;

  stats.total_statements++;
  stats.categories[category] = (stats.categories[category] || 0) + 1;
  stats.wrapkind_distribution[wrapKind] = (stats.wrapkind_distribution[wrapKind] || 0) + 1;
  stats.total_bytes_statements += stmtCode.length;
  stats.statements.push({
    index: i,
    category,
    wrapKind,
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

// --- Prepend Bundle Analysis Header ---

const wk = stats.wrapkind_distribution;
const headerLines = [
  `/* ====================================================================`,
  ` * DEMINI-CLASSIFY BUNDLE ANALYSIS`,
  ` * Bundler: ${bundleType.bundler} (${bundleType.confidence} confidence)`,
  ` * Statements: ${stats.total_statements}`,
  ` * WrapKind: CJS=${wk.CJS} ESM=${wk.ESM} None=${wk.None} RUNTIME=${wk.RUNTIME}`,
  ` * Size: ${originalSize.toLocaleString()} bytes (${code.length.toLocaleString()} body)`,
  ` * ==================================================================== */`,
];
const headerComment = headerLines.join("\n") + "\n";
stats.annotation_bytes += headerComment.length;

// Insert header after shebang, before first statement annotation
if (shebang) {
  output = shebang + headerComment + output.slice(shebang.length);
} else {
  output = headerComment + output;
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

fs.writeFileSync(classifiedPath, output);
console.log(`\nWrote: ${classifiedPath}`);

stats.byte_accounting_match = accountingMatch;
fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
console.log(`Wrote: ${statsPath}`);

// Write provenance
writeProvenance(folderPath, {
  tool: "demini-classify",
  stage: "01",
  inputPath: resolvedInput,
  inputHash,
  settings: acornSettings,
  startTime,
  results: {
    total_statements: stats.total_statements,
    categories: stats.categories,
    wrapkind_distribution: stats.wrapkind_distribution,
    bundler: bundleType.bundler,
    bundler_confidence: bundleType.confidence,
    original_bytes: originalSize,
    classified_bytes: output.length,
    annotation_overhead_bytes: stats.annotation_bytes,
    byte_accounting_match: accountingMatch,
    parse_ms: parseElapsed,
    output_file: classifiedFilename,
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

console.log("\n=== WrapKind Distribution ===");
for (const [kind, count] of Object.entries(stats.wrapkind_distribution)) {
  if (count === 0) continue;
  const pct = ((count / stats.total_statements) * 100).toFixed(1);
  const kindBytes = stats.statements
    .filter((s) => s.wrapKind === kind)
    .reduce((sum, s) => sum + s.bytes, 0);
  const bytePct = ((kindBytes / stats.total_bytes_statements) * 100).toFixed(1);
  console.log(
    `  ${kind.padEnd(10)} ${String(count).padStart(5)} stmts (${pct}%)  ${kindBytes.toLocaleString().padStart(12)} bytes (${bytePct}%)`
  );
}

console.log(`\nBundler: ${bundleType.bundler} (${bundleType.confidence})`);

console.log("\n✅ demini-classify complete!");
console.log(`\nVerify: node "${classifiedPath}" --version`);
