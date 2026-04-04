#!/usr/bin/env node

/**
 * demini-annotate-modules — Inject BKG metadata as comments into split modules
 *
 * Usage: demini-annotate-modules <split-dir> <bkg.json> [-o output-dir]
 *
 * For each split module, injects a header comment block with:
 * - Module semantic name (from BKG match)
 * - Source file path (from source map enrichment)
 * - Match technique and confidence
 * - Dependency list (imports from / imported by)
 * - Identifier count and coverage stats
 *
 * Annotations are block comments that don't affect execution.
 */

import fs from "node:fs";
import path from "node:path";

const splitDir = process.argv[2];
const bkgPath = process.argv[3];
const oIdx = process.argv.indexOf("-o");
const outputDir = (oIdx !== -1 && process.argv[oIdx + 1])
  ? path.resolve(process.argv[oIdx + 1])
  : null;

if (!splitDir || !bkgPath) {
  console.error("Usage: demini-annotate-modules <split-dir> <bkg.json> [-o output-dir]");
  console.error("");
  console.error("  split-dir   Directory with mod_*.js split modules");
  console.error("  bkg.json    BKG file (matched/enriched for best results)");
  console.error("  -o dir      Output directory (default: in-place)");
  process.exit(1);
}

const resolvedSplit = path.resolve(splitDir);
const bkg = JSON.parse(fs.readFileSync(path.resolve(bkgPath), "utf8"));

// Build module lookup by minified name
const modByName = {};
for (const mod of bkg.modules) {
  modByName[mod.minified_name] = mod;
}

// Build file index
const files = {};
for (const f of fs.readdirSync(resolvedSplit)) {
  if (!f.startsWith("mod_") || !f.endsWith(".js")) continue;
  const parts = f.replace(".js", "").split("_");
  if (parts.length >= 3) {
    const name = parts.slice(2).join("_");
    files[name] = path.join(resolvedSplit, f);
  }
}

// Setup output
const outDir = outputDir ? path.resolve(outputDir) : resolvedSplit;
if (outputDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // Copy non-module files (manifest, etc.)
  for (const f of fs.readdirSync(resolvedSplit)) {
    if (!f.startsWith("mod_")) {
      fs.copyFileSync(path.join(resolvedSplit, f), path.join(outDir, f));
    }
  }
}

console.error("=== demini-annotate-modules ===");
console.error(`Split dir: ${resolvedSplit}`);
console.error(`BKG: ${bkgPath} (${bkg.modules.length} modules)`);
console.error("");

let annotated = 0;
let skipped = 0;

for (const [modName, srcPath] of Object.entries(files)) {
  const mod = modByName[modName];
  const code = fs.readFileSync(srcPath, "utf8");

  if (!mod) {
    // No BKG entry — copy as-is
    if (outputDir) {
      fs.copyFileSync(srcPath, path.join(outDir, path.basename(srcPath)));
    }
    skipped++;
    continue;
  }

  // Build annotation block
  const lines = [];
  lines.push(`/**`);
  lines.push(` * @module ${mod.minified_name}`);

  if (mod.semantic_name) {
    lines.push(` * @name ${mod.semantic_name}`);
  }
  if (mod.source_file) {
    lines.push(` * @source ${mod.source_file}`);
  }
  if (mod.semantic_source) {
    lines.push(` * @matched ${mod.semantic_source} (confidence: ${mod.semantic_confidence || "?"})`);
  }
  if (mod.wrapKind && mod.wrapKind !== "None") {
    lines.push(` * @wrap ${mod.wrapKind}`);
  }

  // Dependencies
  if (mod.deps_out && mod.deps_out.length > 0) {
    const depNames = mod.deps_out
      .map(id => {
        const dep = bkg.modules.find(m => m.id === `mod:${id}` || m.id === id);
        return dep ? (dep.semantic_name || dep.minified_name) : String(id);
      })
      .slice(0, 15); // Limit for readability
    lines.push(` * @imports ${depNames.join(", ")}${mod.deps_out.length > 15 ? ` (+${mod.deps_out.length - 15} more)` : ""}`);
  }

  if (mod.deps_in && mod.deps_in.length > 0) {
    lines.push(` * @importedBy ${mod.deps_in.length} modules`);
  }

  // Stats
  const stats = [];
  if (mod.stmtCount) stats.push(`${mod.stmtCount} stmts`);
  if (mod.bytes) stats.push(`${mod.bytes}B`);
  if (mod.strings && mod.strings.length > 0) stats.push(`${mod.strings.length} strings`);
  if (stats.length > 0) {
    lines.push(` * @stats ${stats.join(", ")}`);
  }

  lines.push(` */`);

  const annotation = lines.join("\n") + "\n";
  const annotatedCode = annotation + code;

  const outPath = outputDir
    ? path.join(outDir, path.basename(srcPath))
    : srcPath;
  fs.writeFileSync(outPath, annotatedCode);
  annotated++;
}

console.error(`Annotated: ${annotated} modules`);
console.error(`Skipped (no BKG entry): ${skipped}`);
if (outputDir) console.error(`Output: ${outDir}`);
