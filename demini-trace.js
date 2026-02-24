#!/usr/bin/env node
/**
 * demini-trace - Dependency graph + module boundary identification
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Reads classified JS (from demini-classify), walks the AST to build a
 * bidirectional dependency graph, identifies module boundaries using
 * progressive wrapper elimination (CJS → ESM → WrapNone), and inserts
 * boundary comments into the source.
 *
 * Usage:
 *   demini-trace <input.js> [output-dir]
 *
 * Output:
 *   DEMINI_NN/02_traced-{basename}.js     — source with boundary comments
 *   DEMINI_NN/02_trace-{basename}.json    — dependency graph + modules
 *   DEMINI_NN/02_bundle-map-{basename}.html — bundle visualization
 *   DEMINI_NN/run.json                     — provenance (appends)
 *
 * Designed for esbuild bundles. Uses acorn + acorn-walk for AST analysis.
 */

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { resolveOutputFolder, stripStagePrefix, hashFile, writeProvenance } from "./demini-utils.js";

// --- Argument Parsing ---

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("demini-trace: dependency graph + module boundary identification");
  console.error("");
  console.error("Usage: demini-trace <input.js> [output-dir]");
  console.error("");
  console.error("Arguments:");
  console.error("  input.js    Classified JS bundle (from demini-classify)");
  console.error("  output-dir  Base directory for DEMINI_NN/ output (default: same dir as input)");
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`demini-trace: file not found: ${resolvedInput}`);
  process.exit(1);
}

const explicitOutputDir = process.argv[3] ? path.resolve(process.argv[3]) : null;

// --- Resolve DEMINI_NN/ output folder ---

const { folderPath, runNumber } = resolveOutputFolder(resolvedInput, explicitOutputDir);

const inputBasename = stripStagePrefix(path.basename(resolvedInput));
const tracedFilename = `02_traced-${inputBasename}`;
const traceJsonFilename = `02_trace-${inputBasename.replace(/\.js$/, ".json")}`;
const bundleMapFilename = `02_bundle-map-${inputBasename.replace(/\.js$/, ".html")}`;
const tracedPath = path.join(folderPath, tracedFilename);
const traceJsonPath = path.join(folderPath, traceJsonFilename);
const bundleMapPath = path.join(folderPath, bundleMapFilename);

console.log("=== demini-trace ===");
console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${folderPath}`);
console.log(`Run:    DEMINI_${String(runNumber).padStart(2, "0")}`);
console.log("");

// --- Load stats from classify stage (if available) ---

const statsPath = path.join(folderPath, `01_stats-${inputBasename.replace(/\.js$/, ".json")}`);
let classifyStats = null;
if (fs.existsSync(statsPath)) {
  classifyStats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
  console.log(`Loaded classify stats: ${classifyStats.total_statements} statements`);
}

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

// Strip shebang if present (preserve for output)
let shebang = "";
if (code.startsWith("#!")) {
  const firstNewline = code.indexOf("\n");
  shebang = code.slice(0, firstNewline + 1);
  code = code.slice(firstNewline + 1);
}

// Acorn ignores block comments — all classify annotations (header + per-statement)
// pass through as-is. No stripping needed.

console.log("Parsing with acorn...");
const parseStart = Date.now();
const ast = acorn.parse(code, acornSettings);
const parseElapsed = Date.now() - parseStart;
console.log(`Parse time: ${parseElapsed}ms`);
console.log(`Top-level statements: ${ast.body.length}`);

// --- Detect Runtime Helpers (same logic as classify) ---

function detectRuntimeHelpers(ast, code) {
  const helpers = {};
  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;
    for (const decl of node.declarations) {
      if (!decl.init || !decl.id || decl.id.type !== "Identifier") continue;
      const name = decl.id.name;
      const initSrc = code.slice(decl.init.start, decl.init.end);
      if (decl.init.type === "ArrowFunctionExpression" && decl.init.params.length === 2 &&
          decl.init.body.type === "ArrowFunctionExpression" && decl.init.body.params.length === 0) {
        const innerSrc = code.slice(decl.init.body.start, decl.init.body.end);
        if (innerSrc.includes("exports") && innerSrc.includes("{}")) { helpers[name] = "__commonJS"; continue; }
        if (innerSrc.includes("= 0") && !innerSrc.includes("exports")) { helpers[name] = "__esm"; continue; }
      }
      if ((decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression") &&
          (initSrc.includes("__esModule") || initSrc.includes("esModule"))) { helpers[name] = "__toESM"; continue; }
      if ((decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression") &&
          initSrc.includes("getOwnPropertyNames") && initSrc.includes("defineProperty")) { helpers[name] = "__copyProps"; continue; }
    }
  }
  return helpers;
}

const runtimeHelpers = detectRuntimeHelpers(ast, code);
const helperCount = Object.keys(runtimeHelpers).length;
if (helperCount > 0) {
  console.log(`\nRuntime helpers: ${helperCount}`);
  for (const [minified, semantic] of Object.entries(runtimeHelpers)) {
    console.log(`  ${minified} → ${semantic}`);
  }
}

// --- Build Definition Map ---

console.log("\nBuilding definition map...");

const definedBy = new Map();  // name → stmt index
const stmtDefs = [];          // index → [names]

function extractPatternNames(node, names) {
  if (!node) return;
  if (node.type === "Identifier") names.push(node.name);
  else if (node.type === "ObjectPattern") {
    for (const prop of node.properties) {
      extractPatternNames(prop.type === "RestElement" ? prop.argument : prop.value, names);
    }
  } else if (node.type === "ArrayPattern") {
    for (const elem of node.elements) { if (elem) extractPatternNames(elem, names); }
  }
}

for (let i = 0; i < ast.body.length; i++) {
  const stmt = ast.body[i];
  const names = [];
  if (stmt.type === "VariableDeclaration") {
    for (const decl of stmt.declarations) extractPatternNames(decl.id, names);
  } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
    names.push(stmt.id.name);
  } else if (stmt.type === "ClassDeclaration" && stmt.id) {
    names.push(stmt.id.name);
  } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    if (stmt.declaration.type === "VariableDeclaration") {
      for (const decl of stmt.declaration.declarations) extractPatternNames(decl.id, names);
    } else if (stmt.declaration.id) {
      names.push(stmt.declaration.id.name);
    }
  }
  for (const name of names) definedBy.set(name, i);
  stmtDefs.push(names);
}

console.log(`Top-level names: ${definedBy.size}`);

// --- Trace Dependencies ---

console.log("Tracing dependencies...");

const graph = [];
for (let i = 0; i < ast.body.length; i++) {
  graph.push({ refs_out: new Set(), refs_in: new Set() });
}

for (let i = 0; i < ast.body.length; i++) {
  const stmt = ast.body[i];
  const selfNames = new Set(stmtDefs[i]);

  walk.simple(stmt, {
    Identifier(node) {
      const defIdx = definedBy.get(node.name);
      if (defIdx !== undefined && defIdx !== i && !selfNames.has(node.name)) {
        graph[i].refs_out.add(defIdx);
        graph[defIdx].refs_in.add(i);
      }
    },
  });
}

let totalEdges = 0;
for (const g of graph) totalEdges += g.refs_out.size;
console.log(`Dependency edges: ${totalEdges}`);

// --- Classify WrapKind per Statement ---

function classifyStmtWrapKind(stmt, index, runtimeHelpers, code) {
  if (stmt.type !== "VariableDeclaration") return "None";

  for (const decl of stmt.declarations) {
    // Runtime helper definition
    if (decl.id && decl.id.type === "Identifier" && runtimeHelpers[decl.id.name]) {
      return "RUNTIME";
    }
    // Factory call
    if (decl.init && decl.init.type === "CallExpression" &&
        decl.init.callee && decl.init.callee.type === "Identifier") {
      const helper = runtimeHelpers[decl.init.callee.name];
      if (helper === "__commonJS") return "CJS";
      if (helper === "__esm") return "ESM";
      if (helper === "__toESM") return "ESM";
      if (helper === "__copyProps") return "ESM";
    }
  }
  return "None";
}

// --- Progressive Module Identification ---

console.log("Identifying modules...");

const stmtInfo = [];
for (let i = 0; i < ast.body.length; i++) {
  const stmt = ast.body[i];
  const wrapKind = classifyStmtWrapKind(stmt, i, runtimeHelpers, code);
  stmtInfo.push({
    index: i,
    wrapKind,
    moduleId: -1, // will be assigned
    names: stmtDefs[i],
    startLine: stmt.loc.start.line,
    endLine: stmt.loc.end.line,
    start: stmt.start,
    end: stmt.end,
  });
}

// Module identification:
// 1. Each CJS factory = one module
// 2. Each ESM __esm() call = one module (+ back-trace hoisted vars above it)
// 3. Runtime helpers = module 0 (infrastructure)
// 4. Remaining None statements = grouped by connectivity (or each is own module)

const modules = [];
let nextModuleId = 0;

// Pass 1: CJS factories — each is a self-contained module
for (let i = 0; i < stmtInfo.length; i++) {
  if (stmtInfo[i].wrapKind === "CJS") {
    stmtInfo[i].moduleId = nextModuleId;
    modules.push({
      id: nextModuleId,
      wrapKind: "CJS",
      statements: [i],
      primary: i,
    });
    nextModuleId++;
  }
}

// Pass 2: ESM modules — __esm() call + back-trace hoisted vars
// ESM back-tracing (D2): scan backward from __esm() call to find hoisted declarations
// that are referenced inside the __esm factory
for (let i = 0; i < stmtInfo.length; i++) {
  if (stmtInfo[i].wrapKind === "ESM") {
    const esmStmt = ast.body[i];
    // Check if this is an __esm factory call (not __toESM adapter)
    let isEsmFactory = false;
    if (esmStmt.type === "VariableDeclaration") {
      for (const decl of esmStmt.declarations) {
        if (decl.init && decl.init.type === "CallExpression" &&
            decl.init.callee && decl.init.callee.type === "Identifier" &&
            runtimeHelpers[decl.init.callee.name] === "__esm") {
          isEsmFactory = true;
        }
      }
    }

    if (isEsmFactory) {
      const modStmts = [i];
      stmtInfo[i].moduleId = nextModuleId;

      // Back-trace: scan backward for unassigned None stmts that this __esm references
      // (hoisted declarations like `var x, y, z;` before the __esm call)
      const refsFromEsm = graph[i].refs_out;
      for (const refIdx of refsFromEsm) {
        if (refIdx < i && stmtInfo[refIdx].wrapKind === "None" && stmtInfo[refIdx].moduleId === -1) {
          // Check if this is likely a hoisted declaration (var/let/const or function)
          const refStmt = ast.body[refIdx];
          if (refStmt.type === "VariableDeclaration" || refStmt.type === "FunctionDeclaration") {
            stmtInfo[refIdx].moduleId = nextModuleId;
            stmtInfo[refIdx].wrapKind = "ESM"; // reclassify as part of ESM module
            modStmts.push(refIdx);
          }
        }
      }

      modStmts.sort((a, b) => a - b);
      modules.push({
        id: nextModuleId,
        wrapKind: "ESM",
        statements: modStmts,
        primary: i,
      });
      nextModuleId++;
    } else {
      // __toESM adapter — treat as its own micro-module
      stmtInfo[i].moduleId = nextModuleId;
      modules.push({
        id: nextModuleId,
        wrapKind: "ESM",
        statements: [i],
        primary: i,
      });
      nextModuleId++;
    }
  }
}

// Pass 3: Runtime helpers — group into module 0 equivalent
const runtimeStmts = [];
for (let i = 0; i < stmtInfo.length; i++) {
  if (stmtInfo[i].wrapKind === "RUNTIME") {
    stmtInfo[i].moduleId = nextModuleId;
    runtimeStmts.push(i);
  }
}
if (runtimeStmts.length > 0) {
  modules.push({
    id: nextModuleId,
    wrapKind: "RUNTIME",
    statements: runtimeStmts,
    primary: runtimeStmts[0],
  });
  nextModuleId++;
}

// Pass 4: Remaining None — each unassigned statement is its own "bare" module
for (let i = 0; i < stmtInfo.length; i++) {
  if (stmtInfo[i].moduleId === -1) {
    stmtInfo[i].moduleId = nextModuleId;
    modules.push({
      id: nextModuleId,
      wrapKind: "None",
      statements: [i],
      primary: i,
    });
    nextModuleId++;
  }
}

// Compute module-level dependencies
for (const mod of modules) {
  mod.deps_out = new Set();
  mod.deps_in = new Set();
  mod.line_start = Infinity;
  mod.line_end = 0;
  mod.bytes = 0;

  for (const si of mod.statements) {
    mod.line_start = Math.min(mod.line_start, stmtInfo[si].startLine);
    mod.line_end = Math.max(mod.line_end, stmtInfo[si].endLine);
    mod.bytes += ast.body[si].end - ast.body[si].start;

    for (const ref of graph[si].refs_out) {
      const refModId = stmtInfo[ref].moduleId;
      if (refModId !== mod.id) mod.deps_out.add(refModId);
    }
    for (const ref of graph[si].refs_in) {
      const refModId = stmtInfo[ref].moduleId;
      if (refModId !== mod.id) mod.deps_in.add(refModId);
    }
  }
}

// Module summary
const wrapCounts = { CJS: 0, ESM: 0, RUNTIME: 0, None: 0 };
for (const mod of modules) wrapCounts[mod.wrapKind]++;

console.log(`\nModules identified: ${modules.length}`);
console.log(`  CJS: ${wrapCounts.CJS}  ESM: ${wrapCounts.ESM}  RUNTIME: ${wrapCounts.RUNTIME}  None: ${wrapCounts.None}`);

// --- Build Traced Output (with boundary comments) ---

console.log("\nInserting boundary comments...");

// Build a set of statement indices that START a new module
const boundaryStmts = new Map(); // stmtIndex → module
for (const mod of modules) {
  const firstStmt = Math.min(...mod.statements);
  boundaryStmts.set(firstStmt, mod);
}

let output = shebang;
let lastEnd = 0;
let boundaryBytes = 0;

// Re-parse from the full code (with header) to get correct positions
// AST positions are relative to code. Use code directly for output slicing.
const sourceForOutput = code;

for (let i = 0; i < ast.body.length; i++) {
  const node = ast.body[i];

  // Preserve gap
  if (node.start > lastEnd) {
    const gap = sourceForOutput.slice(lastEnd, node.start);
    output += gap;
  }

  // Insert boundary comment if this statement starts a module
  if (boundaryStmts.has(i)) {
    const mod = boundaryStmts.get(i);
    const boundary = `/* --- MODULE BOUNDARY [${String(mod.id).padStart(3, "0")}] Wrap${mod.wrapKind} (${mod.statements.length} stmts, ${mod.bytes} bytes) --- */\n`;
    output += boundary;
    boundaryBytes += boundary.length;
  }

  output += sourceForOutput.slice(node.start, node.end);
  lastEnd = node.end;
}

// Trailing content
if (lastEnd < sourceForOutput.length) {
  output += sourceForOutput.slice(lastEnd);
}

// Prepend shebang back if we had one (already added above if present)
// output starts with shebang (if present), then all source with comments preserved

console.log(`Boundary comments: ${boundaryStmts.size}`);
console.log(`Boundary overhead: ${boundaryBytes} bytes`);

// --- Build Trace JSON ---

const traceData = {
  bundler: classifyStats?.bundler || "unknown",
  total_statements: ast.body.length,
  total_modules: modules.length,
  total_edges: totalEdges,
  top_level_names: definedBy.size,
  wrapkind_modules: wrapCounts,
  modules: modules.map(mod => ({
    id: mod.id,
    wrapKind: mod.wrapKind,
    statements: mod.statements,
    line_start: mod.line_start,
    line_end: mod.line_end,
    bytes: mod.bytes,
    deps_out: [...mod.deps_out].sort((a, b) => a - b),
    deps_in: [...mod.deps_in].sort((a, b) => a - b),
  })),
  statements: stmtInfo.map((si, i) => ({
    index: i,
    module_id: si.moduleId,
    wrapKind: si.wrapKind,
    names: si.names,
    line_start: si.startLine,
    line_end: si.endLine,
    refs_out: [...graph[i].refs_out].sort((a, b) => a - b),
    refs_in: [...graph[i].refs_in].sort((a, b) => a - b),
  })),
};

// --- Build HTML Bundle Visualization ---

function generateBundleMap(modules, totalStatements, basename) {
  const colors = { CJS: "#4a90d9", ESM: "#50c878", RUNTIME: "#e74c3c", None: "#f5c542" };
  const totalStmts = totalStatements;

  // Build SVG strips
  let svgStrips = "";
  let xOffset = 0;
  const svgWidth = 1200;
  const svgHeight = 60;

  // Sort modules by their first statement position for linear layout
  const sortedMods = [...modules].sort((a, b) => Math.min(...a.statements) - Math.min(...b.statements));

  for (const mod of sortedMods) {
    const width = Math.max(1, (mod.statements.length / totalStmts) * svgWidth);
    const color = colors[mod.wrapKind] || "#999";
    svgStrips += `    <rect x="${xOffset}" y="0" width="${width}" height="${svgHeight}" fill="${color}" stroke="#333" stroke-width="0.5" data-module-id="${mod.id}" data-wrapkind="${mod.wrapKind}" data-stmts="${mod.statements.length}" data-bytes="${mod.bytes}" data-deps-out="${[...mod.deps_out].join(",")}" data-deps-in="${[...mod.deps_in].join(",")}">\n      <title>Module ${mod.id} (${mod.wrapKind}) — ${mod.statements.length} stmts, ${mod.bytes} bytes</title>\n    </rect>\n`;
    xOffset += width;
  }

  // Summary stats
  const bytesByKind = { CJS: 0, ESM: 0, RUNTIME: 0, None: 0 };
  for (const mod of modules) bytesByKind[mod.wrapKind] += mod.bytes;
  const totalBytes = Object.values(bytesByKind).reduce((a, b) => a + b, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Bundle Map — ${basename}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #1a1a2e; color: #e0e0e0; margin: 20px; }
    h1 { color: #f5c542; font-size: 18px; }
    .strip-container { margin: 20px 0; }
    svg rect { cursor: pointer; }
    svg rect:hover { opacity: 0.8; stroke: #fff; stroke-width: 2; }
    .legend { display: flex; gap: 20px; margin: 15px 0; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .legend-swatch { width: 16px; height: 16px; border: 1px solid #555; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 20px 0; }
    .stat-card { background: #16213e; border: 1px solid #333; border-radius: 6px; padding: 12px; }
    .stat-card h3 { margin: 0 0 6px; font-size: 13px; color: #888; }
    .stat-card .value { font-size: 22px; font-weight: bold; }
    .stat-card .detail { font-size: 11px; color: #666; margin-top: 4px; }
    table { border-collapse: collapse; width: 100%; margin: 15px 0; font-size: 12px; }
    th, td { border: 1px solid #333; padding: 4px 8px; text-align: left; }
    th { background: #16213e; }
    tr:nth-child(even) { background: #1a1a2e; }
    tr:nth-child(odd) { background: #16213e; }
  </style>
</head>
<body>
  <h1>demini bundle map — ${basename}</h1>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background:${colors.CJS}"></div> CJS (${wrapCounts.CJS})</div>
    <div class="legend-item"><div class="legend-swatch" style="background:${colors.ESM}"></div> ESM (${wrapCounts.ESM})</div>
    <div class="legend-item"><div class="legend-swatch" style="background:${colors.None}"></div> None (${wrapCounts.None})</div>
    <div class="legend-item"><div class="legend-swatch" style="background:${colors.RUNTIME}"></div> RUNTIME (${wrapCounts.RUNTIME})</div>
  </div>

  <div class="strip-container">
    <svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
${svgStrips}    </svg>
  </div>

  <div class="stats">
    <div class="stat-card"><h3>Total Modules</h3><div class="value">${modules.length}</div></div>
    <div class="stat-card"><h3>Total Statements</h3><div class="value">${totalStmts}</div></div>
    <div class="stat-card"><h3>Dependency Edges</h3><div class="value">${totalEdges}</div></div>
    <div class="stat-card"><h3>CJS Bytes</h3><div class="value">${(bytesByKind.CJS / 1024).toFixed(0)}K</div><div class="detail">${totalBytes > 0 ? ((bytesByKind.CJS / totalBytes) * 100).toFixed(1) : 0}%</div></div>
    <div class="stat-card"><h3>ESM Bytes</h3><div class="value">${(bytesByKind.ESM / 1024).toFixed(0)}K</div><div class="detail">${totalBytes > 0 ? ((bytesByKind.ESM / totalBytes) * 100).toFixed(1) : 0}%</div></div>
    <div class="stat-card"><h3>Other Bytes</h3><div class="value">${((bytesByKind.None + bytesByKind.RUNTIME) / 1024).toFixed(0)}K</div><div class="detail">${totalBytes > 0 ? (((bytesByKind.None + bytesByKind.RUNTIME) / totalBytes) * 100).toFixed(1) : 0}%</div></div>
  </div>

  <h2 style="font-size:14px; color:#888;">Largest Modules (top 15)</h2>
  <table>
    <tr><th>ID</th><th>WrapKind</th><th>Stmts</th><th>Bytes</th><th>Deps Out</th><th>Deps In</th><th>Lines</th></tr>
${[...modules].sort((a, b) => b.bytes - a.bytes).slice(0, 15).map(m =>
    `    <tr><td>${m.id}</td><td style="color:${colors[m.wrapKind]}">${m.wrapKind}</td><td>${m.statements.length}</td><td>${m.bytes.toLocaleString()}</td><td>${m.deps_out.size}</td><td>${m.deps_in.size}</td><td>${m.line_start}-${m.line_end}</td></tr>`
  ).join("\n")}
  </table>
</body>
</html>`;
}

const bundleMapHtml = generateBundleMap(modules, ast.body.length, inputBasename);

// --- Write Outputs ---

fs.writeFileSync(tracedPath, output);
console.log(`\nWrote: ${tracedPath}`);

fs.writeFileSync(traceJsonPath, JSON.stringify(traceData, null, 2));
console.log(`Wrote: ${traceJsonPath}`);

fs.writeFileSync(bundleMapPath, bundleMapHtml);
console.log(`Wrote: ${bundleMapPath}`);

// Write provenance
writeProvenance(folderPath, {
  tool: "demini-trace",
  stage: "02",
  inputPath: resolvedInput,
  inputHash,
  settings: acornSettings,
  startTime,
  results: {
    total_statements: ast.body.length,
    total_modules: modules.length,
    total_edges: totalEdges,
    top_level_names: definedBy.size,
    wrapkind_modules: wrapCounts,
    boundary_comments: boundaryStmts.size,
    boundary_overhead_bytes: boundaryBytes,
    parse_ms: parseElapsed,
    output_file: tracedFilename,
    trace_file: traceJsonFilename,
    bundle_map_file: bundleMapFilename,
  },
});
console.log(`Provenance: ${path.join(folderPath, "run.json")}`);

// --- Console Summary ---

console.log("\n=== Module Summary ===");
console.log(`  CJS modules:     ${String(wrapCounts.CJS).padStart(5)}`);
console.log(`  ESM modules:     ${String(wrapCounts.ESM).padStart(5)}`);
console.log(`  RUNTIME modules: ${String(wrapCounts.RUNTIME).padStart(5)}`);
console.log(`  None modules:    ${String(wrapCounts.None).padStart(5)}`);
console.log(`  TOTAL:           ${String(modules.length).padStart(5)}`);

console.log("\n=== Top 5 Most Connected Modules ===");
const byDeps = [...modules].sort((a, b) => (b.deps_out.size + b.deps_in.size) - (a.deps_out.size + a.deps_in.size)).slice(0, 5);
for (const m of byDeps) {
  console.log(`  Module ${String(m.id).padStart(3)} (${m.wrapKind.padEnd(7)}) — deps_out=${m.deps_out.size} deps_in=${m.deps_in.size} stmts=${m.statements.length}`);
}

console.log("\n✅ demini-trace complete!");
console.log(`\nVerify: node "${tracedPath}" --version`);
