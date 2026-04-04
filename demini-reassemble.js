#!/usr/bin/env node

/**
 * demini-reassemble — Reconstruct an executable bundle from split modules
 * 
 * Usage: demini-reassemble <split-dir> [-o output.js] [--strip-markers]
 * 
 * Reads the manifest.json from a split directory, concatenates modules
 * in order with the original header/footer, producing an executable bundle.
 * 
 * Works with both original and renamed split directories.
 */

import fs from "node:fs";
import path from "node:path";

const splitDir = process.argv[2];
const oIdx = process.argv.indexOf("-o");
const outputPath = (oIdx !== -1 && process.argv[oIdx + 1])
  ? path.resolve(process.argv[oIdx + 1])
  : null;
const stripMarkers = process.argv.includes("--strip-markers");

if (!splitDir) {
  console.error("Usage: demini-reassemble <split-dir> [-o output.js] [--strip-markers]");
  console.error("");
  console.error("Arguments:");
  console.error("  split-dir       Directory containing manifest.json + mod_*.js files");
  console.error("  -o output.js    Output file (default: stdout)");
  console.error("  --strip-markers Remove MODULE BOUNDARY comments from output");
  process.exit(1);
}

const resolvedDir = path.resolve(splitDir);
const manifestPath = path.join(resolvedDir, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error(`demini-reassemble: manifest.json not found in ${resolvedDir}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const modules = manifest.modules;

console.error(`=== demini-reassemble ===`);
console.error(`Split dir: ${resolvedDir}`);
console.error(`Modules: ${modules.length}`);

// Read the original beautified bundle for header/footer
// The manifest.source points to the traced file, but we need the beautified file
// The header is everything before the first module's char_start
// The footer is everything after the last module's char_end

// We reconstruct from the split modules themselves — they contain the full module code
// The header (shebang, imports, runtime setup) is in module 0 (RUNTIME)
// The footer (entry point invocation) is in the last module(s) with wrapKind "None"

// Simple approach: read each module file in order and concatenate
const parts = [];
let totalBytes = 0;
let missing = 0;

for (const mod of modules) {
  const modPath = path.join(resolvedDir, mod.filename);
  if (!fs.existsSync(modPath)) {
    console.error(`  WARN: Missing ${mod.filename}`);
    missing++;
    continue;
  }
  
  let code = fs.readFileSync(modPath, "utf8");
  
  // Add module boundary comment for readability (unless --strip-markers)
  if (!stripMarkers) {
    const label = mod.wrapKind !== "None" ? `Wrap${mod.wrapKind}` : "WrapNone";
    parts.push(`\n/* --- MODULE [${mod.id}] ${label} ${mod.filename} --- */\n`);
  }
  
  parts.push(code);
  parts.push("\n");
  totalBytes += code.length;
}

// Prepend shebang (the RUNTIME module doesn't include it since it's before the first statement)
const shebang = "#!/usr/bin/env node\n";
const output = shebang + parts.join("");

if (outputPath) {
  fs.writeFileSync(outputPath, output);
  console.error(`Wrote: ${outputPath} (${(output.length / 1024).toFixed(1)}K)`);
} else {
  process.stdout.write(output);
}

console.error(`Total: ${modules.length - missing} modules, ${(totalBytes / 1024).toFixed(1)}K`);
if (missing) console.error(`Missing: ${missing} modules`);
