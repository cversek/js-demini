#!/usr/bin/env node
/**
 * demini-chain - Version chain orchestrator
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Orchestrates the full demini pipeline across multiple versions of a bundle,
 * matching adjacent versions to build a chain of enriched BKGs. Knowledge
 * accumulates as each version is matched against its neighbor.
 *
 * Usage:
 *   demini-chain <manifest.json> [-o output-dir]
 *
 * Manifest format:
 *   {
 *     "versions": [
 *       { "version": "1.0.0", "bundle": "/path/to/v1/bundle.js" },
 *       { "version": "1.1.0", "bundle": "/path/to/v1.1/bundle.js" }
 *     ],
 *     "anchor": "1.0.0"   // optional: version with known semantic names
 *   }
 *
 * Output:
 *   output-dir/
 *     v_1.0.0/DEMINI_00/  — full pipeline output for each version
 *     v_1.1.0/DEMINI_00/
 *     chain_report.json    — chain-wide coverage and match statistics
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("demini-chain: version chain orchestrator");
  console.error("");
  console.error("Usage: demini-chain <manifest.json> [-o output-dir]");
  console.error("");
  console.error("Manifest format: { versions: [{ version, bundle }], anchor? }");
  process.exit(1);
}

const oIdx = process.argv.indexOf("-o");
const outputDir = (oIdx !== -1 && process.argv[oIdx + 1])
  ? path.resolve(process.argv[oIdx + 1])
  : path.resolve(path.dirname(manifestPath), "chain_output");

const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
const versions = manifest.versions;

if (!versions || versions.length < 2) {
  console.error("demini-chain: need at least 2 versions in manifest");
  process.exit(1);
}

// Resolve tool paths relative to this script
const toolDir = path.dirname(new URL(import.meta.url).pathname);
const tools = {
  beautify: path.join(toolDir, "demini-beautify.js"),
  classify: path.join(toolDir, "demini-classify.js"),
  trace: path.join(toolDir, "demini-trace.js"),
  split: path.join(toolDir, "demini-split.js"),
  extract: path.join(toolDir, "demini-extract.js"),
  bkg: path.join(toolDir, "demini-bkg.js"),
};

console.log("=== demini-chain ===");
console.log(`Versions: ${versions.length}`);
console.log(`Output: ${outputDir}`);
console.log(`Anchor: ${manifest.anchor || "(none)"}`);
console.log("");

fs.mkdirSync(outputDir, { recursive: true });

const chainStart = Date.now();
const report = { versions: [], matches: [], total_elapsed_ms: 0 };

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    console.error(`  FAILED: ${cmd.slice(0, 80)}...`);
    console.error(`  ${e.stderr?.slice(0, 200) || e.message}`);
    return null;
  }
}

// --- Phase 1: Run full pipeline on each version ---

console.log("--- Phase 1: Pipeline each version ---\n");

const bkgPaths = new Map(); // version → bkg path

for (const v of versions) {
  const vDir = path.join(outputDir, `v_${v.version}`);
  fs.mkdirSync(vDir, { recursive: true });

  const bundlePath = path.resolve(v.bundle);
  if (!fs.existsSync(bundlePath)) {
    console.error(`  SKIP ${v.version}: bundle not found: ${bundlePath}`);
    continue;
  }

  console.log(`[${v.version}] Pipeline...`);
  const vStart = Date.now();

  // Check if DEMINI_00 already exists (resume support)
  const deminiDir = path.join(vDir, "DEMINI_00");
  const existingBkg = fs.readdirSync(fs.existsSync(deminiDir) ? deminiDir : ".").find(f => f.startsWith("04_bkg-"));

  if (existingBkg && fs.existsSync(path.join(deminiDir, existingBkg))) {
    console.log(`  [cached] BKG exists: ${existingBkg}`);
    bkgPaths.set(v.version, path.join(deminiDir, existingBkg));
  } else {
    // Run pipeline stages
    const b = run(`node "${tools.beautify}" "${bundlePath}" "${vDir}"`);
    if (!b) continue;

    // Find beautified output
    const beautified = fs.readdirSync(path.join(vDir, "DEMINI_00")).find(f => f.startsWith("00_"));
    if (!beautified) { console.error(`  SKIP: no beautified output`); continue; }
    const beautifiedPath = path.join(vDir, "DEMINI_00", beautified);

    run(`node "${tools.classify}" "${beautifiedPath}"`);
    const classified = fs.readdirSync(path.join(vDir, "DEMINI_00")).find(f => f.startsWith("01_classified"));
    if (!classified) { console.error(`  SKIP: no classified output`); continue; }
    const classifiedPath = path.join(vDir, "DEMINI_00", classified);

    run(`node "${tools.trace}" "${classifiedPath}"`);
    const traced = fs.readdirSync(path.join(vDir, "DEMINI_00")).find(f => f.startsWith("02_traced"));
    if (!traced) { console.error(`  SKIP: no traced output`); continue; }
    const tracedPath = path.join(vDir, "DEMINI_00", traced);

    run(`node "${tools.split}" "${tracedPath}"`);
    run(`node "${tools.extract}" "${tracedPath}"`);

    const bkg = fs.readdirSync(path.join(vDir, "DEMINI_00")).find(f => f.startsWith("04_bkg-"));
    if (!bkg) { console.error(`  SKIP: no BKG output`); continue; }
    bkgPaths.set(v.version, path.join(vDir, "DEMINI_00", bkg));
  }

  const vElapsed = Date.now() - vStart;
  console.log(`  [${v.version}] done in ${(vElapsed / 1000).toFixed(1)}s`);
  report.versions.push({ version: v.version, elapsed_ms: vElapsed, bkg: bkgPaths.get(v.version) });
}

// --- Phase 2: Chain match adjacent versions ---

console.log("\n--- Phase 2: Chain match ---\n");

const sortedVersions = versions.map(v => v.version).filter(v => bkgPaths.has(v));

for (let i = 0; i < sortedVersions.length - 1; i++) {
  const v1 = sortedVersions[i];
  const v2 = sortedVersions[i + 1];
  const bkg1 = bkgPaths.get(v1);
  const bkg2 = bkgPaths.get(v2);

  const matchOutput = bkg2.replace(/\.json$/, ".matched.json");

  console.log(`[${v1} → ${v2}] Matching...`);
  const matchResult = run(`node "${tools.bkg}" match "${bkg2}" "${bkg1}" -o "${matchOutput}"`);

  if (matchResult) {
    // Extract match stats from output
    const totalMatch = matchResult.match(/Total matched: (\d+)\/(\d+)/);
    if (totalMatch) {
      const [, matched, total] = totalMatch;
      console.log(`  ${matched}/${total} modules matched`);
      report.matches.push({ from: v1, to: v2, matched: parseInt(matched), total: parseInt(total) });
    }

    // Propagate
    const propOutput = matchOutput.replace(/\.matched\.json$/, ".propagated.json");
    run(`node "${tools.bkg}" propagate "${matchOutput}" -o "${propOutput}"`);
    bkgPaths.set(v2, propOutput); // Use enriched BKG for next chain link
  }
}

// --- Report ---

const chainElapsed = Date.now() - chainStart;
report.total_elapsed_ms = chainElapsed;

const reportPath = path.join(outputDir, "chain_report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n=== Chain complete ===`);
console.log(`Versions processed: ${report.versions.length}`);
console.log(`Chain matches: ${report.matches.length}`);
console.log(`Total elapsed: ${(chainElapsed / 1000).toFixed(1)}s`);
console.log(`\nWrote: ${reportPath}`);
