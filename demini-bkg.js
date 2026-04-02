#!/usr/bin/env node
/**
 * demini-bkg - Bundle Knowledge Graph operations
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Subcommands:
 *   match <target.bkg> <reference.bkg>  — Cross-version module matching
 *   apply <bkg> <split-dir> [-o outdir]  — Annotate split modules with BKG knowledge
 *   stats <bkg>                          — Coverage report
 *
 * The match command enriches a green target BKG by finding module
 * correspondences in a reference BKG using:
 *   1. String literal seed matching (Jaccard similarity)
 *   2. Dependency graph propagation (structural correspondence)
 *   3. AST fingerprint matching (structural skeleton)
 */

import fs from "node:fs";
import path from "node:path";
import { readBkg, buildModuleMap } from "./demini-utils.js";

// --- Argument Parsing ---

const subcommand = process.argv[2];

if (!subcommand || !["match", "apply", "stats"].includes(subcommand)) {
  console.error("demini-bkg: Bundle Knowledge Graph operations");
  console.error("");
  console.error("Subcommands:");
  console.error("  match <target.bkg> <reference.bkg> [-o output.bkg]  — Cross-version matching");
  console.error("  apply <bkg> <split-dir> [-o outdir]                  — Annotate modules with BKG");
  console.error("  stats <bkg>                                          — Coverage report");
  process.exit(1);
}

// =====================================================================
// SUBCOMMAND: stats
// =====================================================================

if (subcommand === "stats") {
  const bkgPath = process.argv[3];
  if (!bkgPath) { console.error("Usage: demini-bkg stats <bkg.json>"); process.exit(1); }

  const bkg = readBkg(path.resolve(bkgPath));
  const mods = bkg.modules;

  console.log(`=== BKG Stats: ${path.basename(bkgPath)} ===`);
  console.log(`Version: ${bkg.bkg_version}`);
  console.log(`Bundle: ${bkg.bundle.file} (${bkg.bundle.bundler})`);
  console.log(`Modules: ${mods.length}`);
  console.log(`  Named: ${bkg.coverage.modules_named}/${bkg.coverage.modules_total} (${(bkg.coverage.modules_named / bkg.coverage.modules_total * 100).toFixed(1)}%)`);

  const byKind = {};
  for (const m of mods) {
    byKind[m.wrapKind] = (byKind[m.wrapKind] || 0) + 1;
  }
  console.log(`\nBy wrapKind:`);
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const withStrings = mods.filter(m => m.strings && m.strings.length > 0).length;
  const totalStrings = mods.reduce((s, m) => s + (m.strings ? m.strings.length : 0), 0);
  const withFingerprint = mods.filter(m => m.ast_fingerprint).length;
  console.log(`\nStrings: ${totalStrings} across ${withStrings} modules`);
  console.log(`AST fingerprints: ${withFingerprint}/${mods.length}`);

  if (bkg.enrichments.length > 0) {
    console.log(`\nEnrichments: ${bkg.enrichments.length}`);
    for (const e of bkg.enrichments) {
      console.log(`  ${e.technique}: ${e.modules_enriched} mods, ${e.identifiers_enriched} ids (${e.timestamp})`);
    }
  }

  process.exit(0);
}

// =====================================================================
// SUBCOMMAND: apply
// =====================================================================

if (subcommand === "apply") {
  const bkgPath = process.argv[3];
  const splitDirArg = process.argv[4];

  if (!bkgPath || !splitDirArg) {
    console.error("Usage: demini-bkg apply <bkg.json> <split-dir> [-o outdir]");
    process.exit(1);
  }

  const oIdx = process.argv.indexOf("-o");
  const outDir = (oIdx !== -1 && process.argv[oIdx + 1])
    ? path.resolve(process.argv[oIdx + 1])
    : path.resolve(splitDirArg) + ".applied";

  console.log("=== demini-bkg apply ===");
  console.log(`BKG:      ${bkgPath}`);
  console.log(`Split:    ${splitDirArg}`);
  console.log(`Output:   ${outDir}`);
  console.log("");

  const applyStart = Date.now();
  const bkg = readBkg(path.resolve(bkgPath));
  const splitDir = path.resolve(splitDirArg);
  const manifestPath = path.join(splitDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    console.error("apply: manifest.json not found in split directory");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const modMap = buildModuleMap(bkg);

  fs.mkdirSync(outDir, { recursive: true });

  let annotated = 0;
  let matched = 0;
  let unmatched = 0;

  // Build BKG module lookup by minified_name for matching to split manifest
  const bkgByMinified = new Map();
  for (const m of bkg.modules) {
    bkgByMinified.set(m.minified_name, m);
  }

  // Also build by numeric id for fallback
  const bkgById = new Map();
  for (const m of bkg.modules) {
    // Extract numeric id from "mod:123" or "mod:name" patterns
    const numMatch = m.id.match(/^mod:(\d+)$/);
    if (numMatch) bkgById.set(parseInt(numMatch[1]), m);
  }

  for (const splitMod of manifest.modules) {
    const modFilePath = path.join(splitDir, splitMod.filename);
    if (!fs.existsSync(modFilePath)) continue;

    let code = fs.readFileSync(modFilePath, "utf8");

    // Find corresponding BKG module
    let bkgMod = null;
    // Try by firstName match to minified_name
    if (splitMod.firstName) bkgMod = bkgByMinified.get(splitMod.firstName);
    // Try by numeric ID
    if (!bkgMod && typeof splitMod.id === "number") bkgMod = bkgById.get(splitMod.id);
    // Try by id directly
    if (!bkgMod) bkgMod = modMap.get(`mod:${splitMod.firstName || splitMod.id}`);

    // Build annotation header comment
    const lines = [];
    lines.push(`/**`);
    lines.push(` * demini-bkg: Module ${splitMod.id} (${splitMod.wrapKind})`);

    if (bkgMod) {
      if (bkgMod.semantic_name) {
        lines.push(` * Matched: ${bkgMod.semantic_name} (${(bkgMod.semantic_confidence * 100).toFixed(0)}% confidence)`);
        lines.push(` * Source: ${bkgMod.semantic_source || "unknown"}`);
        matched++;
      } else {
        lines.push(` * Status: unmatched (_dvph_${splitMod.id}_)`);
        unmatched++;
      }

      if (bkgMod.source_file) {
        lines.push(` * Source file: ${bkgMod.source_file}`);
      }

      if (bkgMod.deps_out.length > 0) {
        const depNames = bkgMod.deps_out.slice(0, 5).map(d => {
          const dep = modMap.get(d);
          return dep?.semantic_name || d.replace("mod:", "");
        });
        const suffix = bkgMod.deps_out.length > 5 ? ` (+${bkgMod.deps_out.length - 5} more)` : "";
        lines.push(` * Depends on: ${depNames.join(", ")}${suffix}`);
      }

      if (bkgMod.deps_in.length > 0) {
        lines.push(` * Used by: ${bkgMod.deps_in.length} modules`);
      }

      if (bkgMod.strings && bkgMod.strings.length > 0) {
        const preview = bkgMod.strings.slice(0, 3).map(s => `"${s.slice(0, 30)}"`).join(", ");
        const suffix = bkgMod.strings.length > 3 ? ` (+${bkgMod.strings.length - 3} more)` : "";
        lines.push(` * Key strings: ${preview}${suffix}`);
      }
    } else {
      lines.push(` * Status: no BKG entry found`);
      unmatched++;
    }

    lines.push(` */`);
    const header = lines.join("\n");

    const annotatedCode = header + "\n" + code;
    const outPath = path.join(outDir, splitMod.filename);
    fs.writeFileSync(outPath, annotatedCode);
    annotated++;
  }

  // Copy manifest with apply metadata
  const appliedManifest = {
    ...manifest,
    applied: {
      timestamp: new Date().toISOString(),
      bkg: path.basename(bkgPath),
      matched,
      unmatched,
      total: annotated,
    },
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(appliedManifest, null, 2));

  const applyElapsed = Date.now() - applyStart;
  console.log(`=== Apply complete ===`);
  console.log(`Annotated: ${annotated} modules`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Unmatched: ${unmatched}`);
  console.log(`Elapsed: ${applyElapsed}ms`);
  console.log(`\nWrote: ${outDir}/`);

  process.exit(0);
}

// =====================================================================
// SUBCOMMAND: match
// =====================================================================

const targetPath = process.argv[3];
const refPath = process.argv[4];

if (!targetPath || !refPath) {
  console.error("Usage: demini-bkg match <target.bkg> <reference.bkg> [-o output.bkg]");
  process.exit(1);
}

// Parse -o flag
let outputPath = null;
const oIdx = process.argv.indexOf("-o");
if (oIdx !== -1 && process.argv[oIdx + 1]) {
  outputPath = path.resolve(process.argv[oIdx + 1]);
} else {
  // Default: write enriched BKG next to target
  outputPath = path.resolve(targetPath).replace(/\.json$/, ".matched.json");
}

console.log("=== demini-bkg match ===");
console.log(`Target:    ${targetPath}`);
console.log(`Reference: ${refPath}`);
console.log(`Output:    ${outputPath}`);
console.log("");

const startTime = Date.now();

const target = readBkg(path.resolve(targetPath));
const ref = readBkg(path.resolve(refPath));

const targetMap = buildModuleMap(target);
const refMap = buildModuleMap(ref);

console.log(`Target modules: ${target.modules.length}`);
console.log(`Reference modules: ${ref.modules.length}`);

// --- Technique 1: String Seed Matching (Jaccard Similarity) ---

console.log("\n--- Technique 1: String Seed Matching ---");

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

const JACCARD_THRESHOLD = 0.15;       // Minimum similarity to consider
const UNIQUENESS_RATIO = 1.3;         // Best must be this much better than 2nd best

// Pre-build string sets for reference modules
const refStringSets = new Map();
for (const rm of ref.modules) {
  if (rm.strings && rm.strings.length >= 2) {
    refStringSets.set(rm.id, new Set(rm.strings));
  }
}

// Match target modules to reference modules
const matches = new Map();       // target mod ID → { refId, confidence, technique }
const reverseMatches = new Map(); // ref mod ID → target mod ID (for uniqueness)

let stringSeedCount = 0;

for (const tm of target.modules) {
  if (!tm.strings || tm.strings.length < 2) continue;
  const targetStrings = new Set(tm.strings);

  let bestScore = 0;
  let bestRefId = null;
  let secondBest = 0;

  for (const [refId, refStrings] of refStringSets) {
    const score = jaccard(targetStrings, refStrings);
    if (score > bestScore) {
      secondBest = bestScore;
      bestScore = score;
      bestRefId = refId;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (bestScore >= JACCARD_THRESHOLD && bestRefId &&
      (secondBest === 0 || bestScore >= secondBest * UNIQUENESS_RATIO)) {
    // Check reverse uniqueness — avoid many-to-one
    if (!reverseMatches.has(bestRefId) || bestScore > matches.get(reverseMatches.get(bestRefId))?.confidence) {
      // Evict previous match if this is better
      const prev = reverseMatches.get(bestRefId);
      if (prev) matches.delete(prev);

      matches.set(tm.id, { refId: bestRefId, confidence: bestScore, technique: "string_seed" });
      reverseMatches.set(bestRefId, tm.id);
      stringSeedCount++;
    }
  }
}

console.log(`String seeds: ${stringSeedCount} matches`);

// --- Technique 2: Dependency Graph Propagation ---

console.log("\n--- Technique 2: Graph Propagation ---");

let graphPropCount = 0;
let changed = true;
let iterations = 0;

while (changed && iterations < 20) {
  changed = false;
  iterations++;

  for (const tm of target.modules) {
    if (matches.has(tm.id)) continue; // Already matched

    // Check if any matched neighbor can propagate
    const matchedDepsOut = tm.deps_out
      .filter(d => matches.has(d))
      .map(d => ({ targetDep: d, refDep: matches.get(d).refId }));

    const matchedDepsIn = tm.deps_in
      .filter(d => matches.has(d))
      .map(d => ({ targetDep: d, refDep: matches.get(d).refId }));

    const allMatchedNeighbors = [...matchedDepsOut, ...matchedDepsIn];
    if (allMatchedNeighbors.length === 0) continue;

    // For each matched neighbor, find candidate reference modules
    const candidateScores = new Map(); // refId → score

    for (const { refDep } of matchedDepsOut) {
      // tm depends on matchedDep. In reference, the corresponding module depends on...
      const refMod = refMap.get(refDep);
      if (!refMod) continue;
      // Look at what depends on refMod (its deps_in) — those are candidates for tm's match
      for (const refDepIn of refMod.deps_in) {
        if (reverseMatches.has(refDepIn)) continue; // Already matched
        candidateScores.set(refDepIn, (candidateScores.get(refDepIn) || 0) + 1);
      }
    }

    for (const { refDep } of matchedDepsIn) {
      const refMod = refMap.get(refDep);
      if (!refMod) continue;
      for (const refDepOut of refMod.deps_out) {
        if (reverseMatches.has(refDepOut)) continue;
        candidateScores.set(refDepOut, (candidateScores.get(refDepOut) || 0) + 1);
      }
    }

    if (candidateScores.size === 0) continue;

    // Find best candidate with uniqueness gate
    const sorted = [...candidateScores.entries()].sort((a, b) => b[1] - a[1]);
    const [bestRefId, bestScore] = sorted[0];
    const secondScore = sorted.length > 1 ? sorted[1][1] : 0;

    // Uniqueness gate: best must have strictly more evidence than second
    if (bestScore >= 2 && bestScore > secondScore) {
      // Boost confidence with AST fingerprint similarity
      let fpBoost = 0;
      const targetFp = tm.ast_fingerprint;
      const refMod = refMap.get(bestRefId);
      if (targetFp && refMod && refMod.ast_fingerprint) {
        fpBoost = fingerprintSimilarity(targetFp, refMod.ast_fingerprint) * 0.3;
      }

      const confidence = Math.min(0.95, 0.5 + (bestScore / allMatchedNeighbors.length) * 0.3 + fpBoost);

      matches.set(tm.id, { refId: bestRefId, confidence, technique: "graph_propagation" });
      reverseMatches.set(bestRefId, tm.id);
      graphPropCount++;
      changed = true;
    }
  }
}

console.log(`Graph propagation: ${graphPropCount} matches (${iterations} iterations)`);

// --- Technique 3: AST Fingerprint Matching (for remaining unmatched) ---

console.log("\n--- Technique 3: AST Fingerprint Matching ---");

function fingerprintSimilarity(fpA, fpB) {
  if (!fpA || !fpB) return 0;
  const tokA = fpA.split(":");
  const tokB = fpB.split(":");
  if (tokA.length === 0 || tokB.length === 0) return 0;
  // LCS-based similarity
  const maxLen = Math.max(tokA.length, tokB.length);
  if (maxLen === 0) return 0;
  // Use set intersection as fast approximation
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let common = 0;
  for (const t of setA) if (setB.has(t)) common++;
  // Weight by length similarity
  const lenRatio = Math.min(tokA.length, tokB.length) / maxLen;
  return (common / Math.max(setA.size, setB.size)) * lenRatio;
}

const FP_THRESHOLD = 0.7;
let fpMatchCount = 0;

// Only try fingerprint matching for modules with neighbors already matched
// (prevents false positives from short/generic fingerprints)
for (const tm of target.modules) {
  if (matches.has(tm.id)) continue;
  if (!tm.ast_fingerprint || tm.ast_fingerprint.split(":").length < 5) continue;

  // Must have at least one matched neighbor for context
  const hasMatchedNeighbor = tm.deps_out.some(d => matches.has(d)) ||
                              tm.deps_in.some(d => matches.has(d));
  if (!hasMatchedNeighbor) continue;

  let bestScore = 0;
  let bestRefId = null;
  let secondBest = 0;

  for (const rm of ref.modules) {
    if (reverseMatches.has(rm.id)) continue;
    if (!rm.ast_fingerprint) continue;

    const score = fingerprintSimilarity(tm.ast_fingerprint, rm.ast_fingerprint);
    if (score > bestScore) {
      secondBest = bestScore;
      bestScore = score;
      bestRefId = rm.id;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (bestScore >= FP_THRESHOLD && bestRefId &&
      (secondBest === 0 || bestScore >= secondBest * 1.2)) {
    matches.set(tm.id, { refId: bestRefId, confidence: bestScore * 0.8, technique: "ast_fingerprint" });
    reverseMatches.set(bestRefId, tm.id);
    fpMatchCount++;
  }
}

console.log(`AST fingerprint: ${fpMatchCount} matches`);

// --- Apply matches to target BKG ---

const totalMatched = matches.size;
const matchPct = ((totalMatched / target.modules.length) * 100).toFixed(1);

console.log(`\n=== Match Summary ===`);
console.log(`Total matched: ${totalMatched}/${target.modules.length} (${matchPct}%)`);
console.log(`  String seeds: ${stringSeedCount}`);
console.log(`  Graph propagation: ${graphPropCount}`);
console.log(`  AST fingerprint: ${fpMatchCount}`);

// Enrich the target BKG with match results
for (const [targetId, matchInfo] of matches) {
  const targetMod = targetMap.get(targetId);
  const refMod = refMap.get(matchInfo.refId);
  if (!targetMod || !refMod) continue;

  // Transfer semantic name from reference if it has one
  // For green-green matching, use the reference's minified name as identifier
  targetMod.semantic_name = refMod.semantic_name || refMod.minified_name;
  targetMod.semantic_confidence = matchInfo.confidence;
  targetMod.semantic_source = `cross_version_match:${matchInfo.technique}`;
  // If reference has source_file, transfer it
  if (refMod.source_file) targetMod.source_file = refMod.source_file;
}

// Update coverage
target.coverage.modules_named = totalMatched;

// Add enrichment log
target.enrichments.push({
  timestamp: new Date().toISOString(),
  technique: "cross_version_match",
  reference_version: ref.bundle.version || path.basename(refPath),
  modules_enriched: totalMatched,
  identifiers_enriched: 0,
  provenance: `demini-bkg match: string_seed=${stringSeedCount}, graph_prop=${graphPropCount}, ast_fp=${fpMatchCount}`,
});

// --- Write enriched BKG ---

fs.writeFileSync(outputPath, JSON.stringify(target, null, 2));
const elapsed = Date.now() - startTime;

console.log(`\nElapsed: ${elapsed}ms`);
console.log(`Wrote: ${outputPath}`);
