#!/usr/bin/env node
/**
 * demini-beautify - Stage 00 of the demini pipeline
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Beautifies minified JavaScript using prettier, preserving shebangs
 * and behavioral equivalence. This is the first step: make code
 * human-readable before annotation and splitting.
 *
 * Usage:
 *   demini-beautify <input.js> [output-dir]
 *
 * Arguments:
 *   input.js    - JavaScript file to beautify (required)
 *   output-dir  - Base directory for DEMINI_NN/ output (default: same dir as input)
 *
 * Output:
 *   DEMINI_NN/00_beautified-{input_basename}.js
 *   DEMINI_NN/run.json  (provenance sidecar)
 */

import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { resolveOutputFolder, stripStagePrefix, hashFile, writeProvenance } from "./demini-utils.js";

// --- Argument Parsing ---

const inputPath = process.argv[2];
if (!inputPath) {
  console.error(
    "demini-beautify: Stage 00 — prettier-based JavaScript beautification"
  );
  console.error("");
  console.error("Usage: demini-beautify <input.js> [output-dir]");
  console.error("");
  console.error("Arguments:");
  console.error("  input.js    JavaScript file to beautify (required)");
  console.error(
    "  output-dir  Base directory for DEMINI_NN/ output (default: same dir as input)"
  );
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`demini-beautify: file not found: ${resolvedInput}`);
  process.exit(1);
}

const explicitOutputDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : null;

// --- Resolve DEMINI_NN/ output folder ---

const { folderPath, runNumber } = resolveOutputFolder(resolvedInput, explicitOutputDir);

const inputBasename = stripStagePrefix(path.basename(resolvedInput));
const outputFilename = `00_beautified-${inputBasename}`;
const outputPath = path.join(folderPath, outputFilename);

console.log("=== demini-beautify (Stage 00) ===");
console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${outputPath}`);
console.log(`Run:    DEMINI_${String(runNumber).padStart(2, "0")}`);
console.log("");

// --- Main (async for prettier) ---

const prettierSettings = {
  parser: "babel",
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
};

async function main() {
  const startTime = Date.now();
  const inputHash = hashFile(resolvedInput);

  // Read source
  let code = fs.readFileSync(resolvedInput, "utf8");
  const originalSize = code.length;

  // Strip shebang if present (prettier chokes on shebangs)
  let shebang = "";
  if (code.startsWith("#!")) {
    const firstNewline = code.indexOf("\n");
    shebang = code.slice(0, firstNewline + 1);
    code = code.slice(firstNewline + 1);
    console.log(`Shebang: ${shebang.trim()} (preserved)`);
  }

  // Beautify with prettier
  console.log("Beautifying with prettier...");
  const prettierStart = Date.now();

  const formatted = await prettier.format(code, prettierSettings);

  const prettierElapsed = Date.now() - prettierStart;
  console.log(`Prettier time: ${prettierElapsed}ms`);

  // Reassemble with shebang
  const output = shebang + formatted;

  // Write output
  fs.writeFileSync(outputPath, output);

  // Write provenance
  writeProvenance(folderPath, {
    tool: "demini-beautify",
    stage: "00",
    inputPath: resolvedInput,
    inputHash,
    settings: prettierSettings,
    startTime,
    results: {
      original_bytes: originalSize,
      beautified_bytes: output.length,
      ratio: parseFloat((output.length / originalSize).toFixed(2)),
      shebang: shebang ? shebang.trim() : null,
      prettier_ms: prettierElapsed,
      output_file: outputFilename,
    },
  });

  // Summary
  console.log("");
  console.log("=== Summary ===");
  console.log(`Original:    ${originalSize.toLocaleString()} bytes`);
  console.log(`Beautified:  ${output.length.toLocaleString()} bytes`);
  console.log(`Ratio:       ${(output.length / originalSize).toFixed(2)}x`);
  console.log(`Shebang:     ${shebang ? "preserved" : "none"}`);
  console.log("");
  console.log(`Wrote: ${outputPath}`);
  console.log(`Provenance: ${path.join(folderPath, "run.json")}`);
  console.log("");
  console.log("✅ demini-beautify complete!");
  console.log(`\nVerify: node "${outputPath}" --version`);
}

main().catch((err) => {
  console.error(`demini-beautify: ${err.message}`);
  process.exit(1);
});
