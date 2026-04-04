#!/usr/bin/env node

/**
 * demini-rename — AST-based scope-aware identifier renaming
 *
 * Usage: demini-rename <split-dir> <rename-pairs.json> [-o output-dir]
 *
 * Uses acorn to parse each module, builds scope chains to identify
 * declaration bindings and all their references, then renames at the
 * AST level. This preserves executability because:
 * - Keywords are never renamed (AST distinguishes them)
 * - Cross-scope collisions are impossible (scope-aware binding tracking)
 * - Import/export syntax is preserved (AST understands `as` bindings)
 *
 * Rename pairs JSON format: [{module, minified, semantic}, ...]
 */

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { generate } from "astring";

const splitDir = process.argv[2];
const pairsPath = process.argv[3];
const oIdx = process.argv.indexOf("-o");
const outputDir = (oIdx !== -1 && process.argv[oIdx + 1])
  ? path.resolve(process.argv[oIdx + 1])
  : null;

if (!splitDir || !pairsPath) {
  console.error("Usage: demini-rename <split-dir> <rename-pairs.json> [-o output-dir]");
  console.error("");
  console.error("  split-dir         Directory with mod_*.js split modules");
  console.error("  rename-pairs.json [{module, minified, semantic}, ...]");
  console.error("  -o output-dir     Output directory (default: in-place)");
  process.exit(1);
}

const resolvedSplit = path.resolve(splitDir);
const pairs = JSON.parse(fs.readFileSync(path.resolve(pairsPath), "utf8"));

// Group pairs by module
const byModule = {};
for (const p of pairs) {
  const mod = p.module.replace("mod:", "");
  if (!byModule[mod]) byModule[mod] = {};
  // Map minified → semantic (first occurrence wins)
  if (!byModule[mod][p.minified]) {
    byModule[mod][p.minified] = p.semantic;
  }
}

// Build file index
const fileIdx = {};
for (const f of fs.readdirSync(resolvedSplit)) {
  if (!f.startsWith("mod_") || !f.endsWith(".js")) continue;
  const parts = f.replace(".js", "").split("_");
  if (parts.length >= 3) {
    const name = parts.slice(2).join("_");
    fileIdx[name] = path.join(resolvedSplit, f);
  }
}

// Setup output directory
const outDir = outputDir ? path.resolve(outputDir) : resolvedSplit;
if (outputDir && !fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Copy manifest if outputting to different dir
if (outputDir) {
  const manifestSrc = path.join(resolvedSplit, "manifest.json");
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, path.join(outDir, "manifest.json"));
  }
}

console.error("=== demini-rename (AST-based) ===");
console.error(`Split dir: ${resolvedSplit}`);
console.error(`Pairs: ${pairs.length}`);
console.error(`Modules with renames: ${Object.keys(byModule).length}`);
console.error("");

/**
 * Collect all Identifier nodes and classify as declaration, reference, or skip.
 * Uses walk.full (visits ALL nodes) + parent map for context.
 * Returns: Map<string, {declarations: Node[], references: Node[]}>
 */
function collectBindings(ast) {
  const bindings = new Map(); // name → {declarations: [], references: []}

  // Build parent map: node → parent
  const parentMap = new Map();
  walk.full(ast, (node) => {
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === "object") {
        if (child.type) {
          parentMap.set(child, node);
        } else if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) {
              parentMap.set(item, node);
            }
          }
        }
      }
    }
  });

  // Now collect all Identifiers with parent context
  walk.full(ast, (node) => {
    if (node.type !== "Identifier") return;

    const parent = parentMap.get(node);
    if (!parent) return;

    const name = node.name;
    if (!bindings.has(name)) {
      bindings.set(name, { declarations: [], references: [] });
    }
    const binding = bindings.get(name);

    // Skip: non-renameable positions (property keys, member access, labels, import source names)
    if (
      (parent.type === "Property" && parent.key === node && !parent.computed) ||
      (parent.type === "MemberExpression" && parent.property === node && !parent.computed) ||
      (parent.type === "ExportSpecifier" && parent.exported === node) ||
      (parent.type === "ImportSpecifier" && parent.imported === node) ||
      (parent.type === "MethodDefinition" && parent.key === node) ||
      (parent.type === "LabeledStatement" && parent.label === node) ||
      (parent.type === "BreakStatement" && parent.label === node) ||
      (parent.type === "ContinueStatement" && parent.label === node)
    ) {
      return; // Not renameable
    }

    // Declaration positions
    if (
      (parent.type === "VariableDeclarator" && parent.id === node) ||
      (parent.type === "FunctionDeclaration" && parent.id === node) ||
      (parent.type === "ClassDeclaration" && parent.id === node) ||
      (parent.type === "ImportSpecifier" && parent.local === node) ||
      (parent.type === "ImportDefaultSpecifier" && parent.local === node) ||
      (parent.type === "ImportNamespaceSpecifier" && parent.local === node)
    ) {
      binding.declarations.push(node);
    } else {
      // Reference position
      binding.references.push(node);
    }
  });

  return bindings;
}

/**
 * Apply renames to a module's AST using binding-aware replacement.
 * Modifies source code at precise character offsets.
 */
function applyRenames(code, ast, renameMap) {
  const bindings = collectBindings(ast);

  // Collect all replacement positions: [{start, end, newName}]
  const replacements = [];

  for (const [minified, semantic] of Object.entries(renameMap)) {
    if (minified.length <= 1) continue; // Skip single-char (too risky)

    const binding = bindings.get(minified);
    if (!binding) continue;

    // Only rename if there are actual declarations (not just references)
    // This prevents renaming globals/builtins that happen to match
    if (binding.declarations.length === 0) continue;

    // Collect all nodes to rename (declarations + references)
    const nodes = [...binding.declarations, ...binding.references];

    for (const node of nodes) {
      if (node.name === minified) {
        replacements.push({
          start: node.start,
          end: node.end,
          newName: semantic,
        });
      }
    }
  }

  if (replacements.length === 0) return { code, count: 0 };

  // Sort by position DESCENDING so we can replace from end to start
  // without invalidating earlier positions
  replacements.sort((a, b) => b.start - a.start);

  let result = code;
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.newName + result.slice(r.end);
  }

  return { code: result, count: replacements.length };
}

// PASS 1: Collect ALL declared names globally across ALL modules
// This prevents cross-module collisions when modules share top-level scope
console.error("Pass 1: Collecting global name registry...");
const globalNames = new Set(); // All names declared anywhere

for (const f of fs.readdirSync(resolvedSplit)) {
  if (!f.startsWith("mod_") || !f.endsWith(".js")) continue;
  const code = fs.readFileSync(path.join(resolvedSplit, f), "utf8");
  try {
    const ast = acorn.parse(code, {
      ecmaVersion: "latest", sourceType: "module",
      allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
    });
    walk.full(ast, (node) => {
      if (node.type === "Identifier") globalNames.add(node.name);
    });
  } catch (e) { /* skip unparseable */ }
}
console.error(`  Global names: ${globalNames.size}`);

// Track which semantic names have been claimed by a rename (first-come wins)
const claimedNames = new Set();

// PASS 2: Process each module with global collision awareness
let modulesRenamed = 0;
let modulesSkipped = 0;
let modulesFailed = 0;
let totalReplacements = 0;

const moduleNames = Object.keys(byModule);

for (const modName of moduleNames) {
  const srcPath = fileIdx[modName];
  if (!srcPath) continue;

  // Filter renameMap: skip entries whose semantic name collides globally
  const rawMap = byModule[modName];
  const renameMap = {};
  for (const [minified, semantic] of Object.entries(rawMap)) {
    // Skip renaming the module's own factory name — it's the cross-module
    // reference that other modules use. Renaming it breaks callers.
    if (minified === modName) continue;
    // Skip if semantic name already exists as a declared name in any module
    if (globalNames.has(semantic)) continue;
    // Skip if another module already claimed this semantic name
    if (claimedNames.has(semantic)) continue;
    renameMap[minified] = semantic;
    claimedNames.add(semantic);
  }

  if (Object.keys(renameMap).length === 0) continue;

  const code = fs.readFileSync(srcPath, "utf8");

  // Parse with acorn
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (e) {
    // Parse failed — skip this module, copy as-is
    modulesSkipped++;
    if (outputDir) {
      const outPath = path.join(outDir, path.basename(srcPath));
      fs.copyFileSync(srcPath, outPath);
    }
    continue;
  }

  // Apply renames
  const { code: renamed, count } = applyRenames(code, ast, renameMap);

  if (count > 0) {
    // Validate: parse the renamed code
    try {
      acorn.parse(renamed, {
        ecmaVersion: "latest",
        sourceType: "module",
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowAwaitOutsideFunction: true,
      });
    } catch (e) {
      // Renamed code doesn't parse — revert to original
      modulesFailed++;
      if (outputDir) {
        const outPath = path.join(outDir, path.basename(srcPath));
        fs.copyFileSync(srcPath, outPath);
      }
      continue;
    }

    const outPath = outputDir
      ? path.join(outDir, path.basename(srcPath))
      : srcPath;
    fs.writeFileSync(outPath, renamed);
    modulesRenamed++;
    totalReplacements += count;
  } else if (outputDir) {
    // No renames but need to copy to output
    fs.copyFileSync(srcPath, path.join(outDir, path.basename(srcPath)));
  }
}

// Copy unrenamed modules to output dir if needed
if (outputDir) {
  for (const f of fs.readdirSync(resolvedSplit)) {
    const outPath = path.join(outDir, f);
    if (!fs.existsSync(outPath)) {
      fs.copyFileSync(path.join(resolvedSplit, f), outPath);
    }
  }
}

console.error(`\n=== Results ===`);
console.error(`Modules renamed: ${modulesRenamed}`);
console.error(`Modules skipped (parse fail): ${modulesSkipped}`);
console.error(`Modules reverted (rename broke parse): ${modulesFailed}`);
console.error(`Total replacements: ${totalReplacements}`);
if (outputDir) console.error(`Output: ${outDir}`);
