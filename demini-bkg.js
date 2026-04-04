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

if (!subcommand || !["match", "propagate", "apply", "merge", "diff", "enrich-sourcemap", "stats"].includes(subcommand)) {
  console.error("demini-bkg: Bundle Knowledge Graph operations");
  console.error("");
  console.error("Subcommands:");
  console.error("  match <target.bkg> <reference.bkg> [-o output.bkg]  — Cross-version matching");
  console.error("  propagate <bkg> [-o output.bkg]                      — Spread names via deps");
  console.error("  apply <bkg> <split-dir> [-o outdir]                  — Annotate modules with BKG");
  console.error("  merge <bkg1> <bkg2> [-o output.bkg]                  — Combine BKGs (high-conf wins)");
  console.error("  diff <bkg1> <bkg2>                                   — Compare BKG versions");
  console.error("  enrich-sourcemap <bkg> <bundle.js> <map> [-o out]    — Enrich from source map");
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
// SUBCOMMAND: propagate
// =====================================================================

if (subcommand === "propagate") {
  const bkgPath = process.argv[3];
  if (!bkgPath) { console.error("Usage: demini-bkg propagate <bkg.json> [-o output.bkg]"); process.exit(1); }

  const oIdx = process.argv.indexOf("-o");
  const outputPath = (oIdx !== -1 && process.argv[oIdx + 1])
    ? path.resolve(process.argv[oIdx + 1])
    : path.resolve(bkgPath).replace(/\.json$/, ".propagated.json");

  console.log("=== demini-bkg propagate ===");
  console.log(`Input:  ${bkgPath}`);
  console.log(`Output: ${outputPath}`);
  console.log("");

  const propStart = Date.now();
  const bkg = readBkg(path.resolve(bkgPath));
  const modMap = buildModuleMap(bkg);

  const namedBefore = bkg.modules.filter(m => m.semantic_name).length;
  console.log(`Named modules before: ${namedBefore}/${bkg.modules.length}`);

  let propagated = 0;
  let changed = true;
  let iterations = 0;
  const MAX_ITER = 10;

  while (changed && iterations < MAX_ITER) {
    changed = false;
    iterations++;

    for (const mod of bkg.modules) {
      if (mod.semantic_name) continue; // Already named

      // Collect named neighbors
      const namedDepsOut = mod.deps_out
        .map(id => modMap.get(id))
        .filter(m => m && m.semantic_name);
      const namedDepsIn = mod.deps_in
        .map(id => modMap.get(id))
        .filter(m => m && m.semantic_name);

      const totalNamed = namedDepsOut.length + namedDepsIn.length;
      const totalDeps = mod.deps_out.length + mod.deps_in.length;

      if (totalNamed === 0 || totalDeps === 0) continue;

      // Propagation heuristic: if >50% of neighbors are named,
      // derive a context-based name from the most connected named neighbor
      const namedRatio = totalNamed / totalDeps;
      if (namedRatio < 0.4) continue; // Not enough context

      // Find the best-connected named neighbor (highest deps_in = most important)
      const allNamed = [...namedDepsOut, ...namedDepsIn];
      allNamed.sort((a, b) => b.deps_in.length - a.deps_in.length);
      const primary = allNamed[0];

      // Uniqueness gate: the unnamed module must have a distinctive position
      // (not just a generic leaf with one connection)
      if (totalDeps < 2 && !mod.strings?.length) continue;

      // Generate propagated name: "near_{primary_name}"
      const baseName = primary.semantic_name.replace(/^near_/, "");
      mod.semantic_name = `near_${baseName}`;
      mod.semantic_confidence = Math.min(0.6, namedRatio * 0.7);
      mod.semantic_source = "propagation";

      propagated++;
      changed = true;
    }
  }

  const namedAfter = bkg.modules.filter(m => m.semantic_name).length;
  const improvement = namedAfter - namedBefore;
  const pctImprovement = namedBefore > 0 ? ((improvement / namedBefore) * 100).toFixed(1) : "N/A";

  // Update coverage
  bkg.coverage.modules_named = namedAfter;

  // Log enrichment
  bkg.enrichments.push({
    timestamp: new Date().toISOString(),
    technique: "graph_propagation",
    reference_version: null,
    modules_enriched: propagated,
    identifiers_enriched: 0,
    provenance: `demini-bkg propagate: ${iterations} iterations, ${pctImprovement}% improvement`,
  });

  fs.writeFileSync(outputPath, JSON.stringify(bkg, null, 2));
  const propElapsed = Date.now() - propStart;

  console.log(`\n=== Propagation complete ===`);
  console.log(`Named before: ${namedBefore}`);
  console.log(`Named after: ${namedAfter} (+${improvement}, ${pctImprovement}%)`);
  console.log(`Iterations: ${iterations}`);
  console.log(`Elapsed: ${propElapsed}ms`);
  console.log(`\nWrote: ${outputPath}`);

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
// SUBCOMMAND: merge
// =====================================================================

if (subcommand === "merge") {
  const bkg1Path = process.argv[3];
  const bkg2Path = process.argv[4];
  if (!bkg1Path || !bkg2Path) { console.error("Usage: demini-bkg merge <bkg1.json> <bkg2.json> [-o output.bkg]"); process.exit(1); }

  const oIdx = process.argv.indexOf("-o");
  const outputPath = (oIdx !== -1 && process.argv[oIdx + 1])
    ? path.resolve(process.argv[oIdx + 1])
    : path.resolve(bkg1Path).replace(/\.json$/, ".merged.json");

  console.log("=== demini-bkg merge ===");
  const mergeStart = Date.now();

  const bkg1 = readBkg(path.resolve(bkg1Path));
  const bkg2 = readBkg(path.resolve(bkg2Path));

  console.log(`BKG1: ${bkg1.modules.length} modules (${bkg1.coverage.modules_named} named)`);
  console.log(`BKG2: ${bkg2.modules.length} modules (${bkg2.coverage.modules_named} named)`);

  // Build module maps by ID
  const map1 = buildModuleMap(bkg1);
  const map2 = buildModuleMap(bkg2);

  // Merge: union of modules, highest confidence wins per field
  const allIds = new Set([...map1.keys(), ...map2.keys()]);
  const mergedModules = [];
  let conflicts = 0;

  for (const id of allIds) {
    const m1 = map1.get(id);
    const m2 = map2.get(id);

    if (m1 && !m2) { mergedModules.push({ ...m1 }); continue; }
    if (!m1 && m2) { mergedModules.push({ ...m2 }); continue; }

    // Both exist — merge with highest confidence wins
    const merged = { ...m1 };

    const conf1 = m1.semantic_confidence || 0;
    const conf2 = m2.semantic_confidence || 0;

    if (conf2 > conf1 && m2.semantic_name) {
      merged.semantic_name = m2.semantic_name;
      merged.semantic_confidence = m2.semantic_confidence;
      merged.semantic_source = m2.semantic_source;
      if (m1.semantic_name && m1.semantic_name !== m2.semantic_name) conflicts++;
    }

    // Merge strings (union, capped)
    if (m1.strings && m2.strings) {
      const combined = new Set([...m1.strings, ...m2.strings]);
      merged.strings = [...combined].slice(0, 50);
    }

    // Take better source_file
    if (!merged.source_file && m2.source_file) merged.source_file = m2.source_file;

    mergedModules.push(merged);
  }

  // Merge identifiers (union by ID, highest confidence wins)
  const idMap1 = new Map((bkg1.identifiers || []).map(i => [i.id, i]));
  const idMap2 = new Map((bkg2.identifiers || []).map(i => [i.id, i]));
  const allIdentIds = new Set([...idMap1.keys(), ...idMap2.keys()]);
  const mergedIdentifiers = [];

  for (const id of allIdentIds) {
    const i1 = idMap1.get(id);
    const i2 = idMap2.get(id);
    if (i1 && !i2) { mergedIdentifiers.push(i1); continue; }
    if (!i1 && i2) { mergedIdentifiers.push(i2); continue; }
    const conf1 = i1.confidence || 0;
    const conf2 = i2.confidence || 0;
    mergedIdentifiers.push(conf2 > conf1 ? i2 : i1);
  }

  // Assemble merged BKG
  const merged = {
    bkg_version: "1.0",
    bundle: bkg1.bundle,
    reference: bkg1.reference || bkg2.reference,
    modules: mergedModules,
    identifiers: mergedIdentifiers,
    annotations: [...(bkg1.annotations || []), ...(bkg2.annotations || [])],
    enrichments: [...bkg1.enrichments, ...bkg2.enrichments, {
      timestamp: new Date().toISOString(),
      technique: "merge",
      reference_version: null,
      modules_enriched: mergedModules.length,
      identifiers_enriched: mergedIdentifiers.length,
      provenance: `demini-bkg merge: ${conflicts} conflicts resolved by confidence`,
    }],
    coverage: {
      modules_named: mergedModules.filter(m => m.semantic_name).length,
      modules_total: mergedModules.length,
      identifiers_semantic: mergedIdentifiers.filter(i => i.state === "semantic").length,
      identifiers_placeholder: mergedIdentifiers.filter(i => i.state === "placeholder").length,
      identifiers_raw: mergedIdentifiers.filter(i => i.state === "raw").length,
      identifier_coverage_semantic: 0,
      identifier_coverage_touched: 0,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  const mergeElapsed = Date.now() - mergeStart;

  console.log(`\n=== Merge complete ===`);
  console.log(`Merged modules: ${mergedModules.length} (${merged.coverage.modules_named} named)`);
  console.log(`Conflicts: ${conflicts} (resolved by confidence)`);
  console.log(`Identifiers: ${mergedIdentifiers.length}`);
  console.log(`Elapsed: ${mergeElapsed}ms`);
  console.log(`\nWrote: ${outputPath}`);

  process.exit(0);
}

// =====================================================================
// SUBCOMMAND: diff
// =====================================================================

if (subcommand === "diff") {
  const bkg1Path = process.argv[3];
  const bkg2Path = process.argv[4];
  if (!bkg1Path || !bkg2Path) { console.error("Usage: demini-bkg diff <bkg1.json> <bkg2.json>"); process.exit(1); }

  console.log("=== demini-bkg diff ===");

  const bkg1 = readBkg(path.resolve(bkg1Path));
  const bkg2 = readBkg(path.resolve(bkg2Path));

  const map1 = buildModuleMap(bkg1);
  const map2 = buildModuleMap(bkg2);

  const ids1 = new Set(map1.keys());
  const ids2 = new Set(map2.keys());

  const added = [...ids2].filter(id => !ids1.has(id));
  const removed = [...ids1].filter(id => !ids2.has(id));
  const shared = [...ids1].filter(id => ids2.has(id));

  // Check for modifications in shared modules
  let nameChanged = 0;
  let depsChanged = 0;
  let bytesChanged = 0;

  for (const id of shared) {
    const m1 = map1.get(id);
    const m2 = map2.get(id);
    if (m1.semantic_name !== m2.semantic_name) nameChanged++;
    if (JSON.stringify(m1.deps_out) !== JSON.stringify(m2.deps_out)) depsChanged++;
    if (Math.abs(m1.bytes - m2.bytes) > m1.bytes * 0.1) bytesChanged++;
  }

  console.log(`\nBKG1: ${path.basename(bkg1Path)} — ${bkg1.modules.length} modules`);
  console.log(`BKG2: ${path.basename(bkg2Path)} — ${bkg2.modules.length} modules`);
  console.log(`\n--- Module Delta ---`);
  console.log(`  Added:   ${added.length}`);
  console.log(`  Removed: ${removed.length}`);
  console.log(`  Shared:  ${shared.length}`);
  console.log(`\n--- Modifications (in shared) ---`);
  console.log(`  Name changed:  ${nameChanged}`);
  console.log(`  Deps changed:  ${depsChanged}`);
  console.log(`  Size changed (>10%): ${bytesChanged}`);
  console.log(`\n--- Coverage Delta ---`);
  console.log(`  Named: ${bkg1.coverage.modules_named} → ${bkg2.coverage.modules_named} (${bkg2.coverage.modules_named - bkg1.coverage.modules_named >= 0 ? "+" : ""}${bkg2.coverage.modules_named - bkg1.coverage.modules_named})`);

  if (added.length > 0 && added.length <= 20) {
    console.log(`\n--- Added Modules ---`);
    for (const id of added.slice(0, 20)) {
      const m = map2.get(id);
      console.log(`  ${id} (${m.wrapKind}, ${m.bytes}b)`);
    }
  }
  if (removed.length > 0 && removed.length <= 20) {
    console.log(`\n--- Removed Modules ---`);
    for (const id of removed.slice(0, 20)) {
      const m = map1.get(id);
      console.log(`  ${id} (${m.wrapKind}, ${m.bytes}b)`);
    }
  }

  process.exit(0);
}

// =====================================================================
// SUBCOMMAND: enrich-sourcemap
// =====================================================================

if (subcommand === "enrich-sourcemap") {
  const bkgPath = process.argv[3];
  const bundlePath = process.argv[4];
  const mapPath = process.argv[5];

  if (!bkgPath || !bundlePath || !mapPath) {
    console.error("Usage: demini-bkg enrich-sourcemap <bkg.json> <bundle.js> <bundle.js.map> [-o out.bkg]");
    process.exit(1);
  }

  const oIdx = process.argv.indexOf("-o");
  const outputPath = (oIdx !== -1 && process.argv[oIdx + 1])
    ? path.resolve(process.argv[oIdx + 1])
    : path.resolve(bkgPath).replace(/\.json$/, ".enriched.json");

  console.log("=== demini-bkg enrich-sourcemap ===");
  console.log(`BKG:    ${bkgPath}`);
  console.log(`Bundle: ${bundlePath}`);
  console.log(`Map:    ${mapPath}`);
  console.log(`Output: ${outputPath}`);
  console.log("");

  const enrichStart = Date.now();
  const bkg = readBkg(path.resolve(bkgPath));
  const modMap = buildModuleMap(bkg);
  const sourceMap = JSON.parse(fs.readFileSync(path.resolve(mapPath), "utf8"));
  const bundleCode = fs.readFileSync(path.resolve(bundlePath), "utf8");

  // Build line→offset table for bundle
  const lineOffsets = [0];
  for (let i = 0; i < bundleCode.length; i++) {
    if (bundleCode[i] === '\n') lineOffsets.push(i + 1);
  }

  const sources = sourceMap.sources || [];
  const names = sourceMap.names || [];
  console.log(`Sources: ${sources.length}`);
  console.log(`Names: ${names.length}`);

  // VLQ decode
  const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const VLQ_LOOKUP = {};
  for (let i = 0; i < VLQ_CHARS.length; i++) VLQ_LOOKUP[VLQ_CHARS[i]] = i;

  function decodeVLQ(str) {
    const segments = [];
    let i = 0;
    while (i < str.length) {
      let value = 0, shift = 0, digit;
      do {
        digit = VLQ_LOOKUP[str[i++]];
        value |= (digit & 31) << shift;
        shift += 5;
      } while (digit & 32);
      segments.push(value & 1 ? -(value >> 1) : value >> 1);
    }
    return segments;
  }

  // Decode all mappings
  const mappings = sourceMap.mappings || "";
  const decoded = []; // {genLine, genCol, sourceIdx, sourceLine, sourceCol, nameIdx}

  let genLine = 0, genCol = 0, sourceIdx = 0, sourceLine = 0, sourceCol = 0, nameIdx = 0;

  for (const line of mappings.split(";")) {
    genCol = 0;
    if (line.length === 0) { genLine++; continue; }
    for (const seg of line.split(",")) {
      if (seg.length === 0) continue;
      const fields = decodeVLQ(seg);
      genCol += fields[0];
      if (fields.length >= 4) {
        sourceIdx += fields[1];
        sourceLine += fields[2];
        sourceCol += fields[3];
        const entry = { genLine, genCol, sourceIdx, sourceLine, sourceCol, nameIdx: -1 };
        if (fields.length >= 5) {
          nameIdx += fields[4];
          entry.nameIdx = nameIdx;
        }
        decoded.push(entry);
      }
    }
    genLine++;
  }

  console.log(`Decoded ${decoded.length} mappings`);
  const withNames = decoded.filter(d => d.nameIdx >= 0);
  console.log(`Mappings with names: ${withNames.length}`);

  // Map positions to absolute offsets in bundle
  for (const d of decoded) {
    d.offset = (lineOffsets[d.genLine] || 0) + d.genCol;
  }

  // Associate each mapping with a BKG module (by charStart/charEnd range)
  // Build sorted module ranges for binary search
  const moduleRanges = bkg.modules
    .filter(m => m.range && m.range.charStart != null)
    .map(m => ({ id: m.id, start: m.range.charStart, end: m.range.charEnd }))
    .sort((a, b) => a.start - b.start);

  function findModule(offset) {
    let lo = 0, hi = moduleRanges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offset < moduleRanges[mid].start) hi = mid - 1;
      else if (offset >= moduleRanges[mid].end) lo = mid + 1;
      else return moduleRanges[mid].id;
    }
    return null;
  }

  // Collect per-module: source files and names
  const moduleSourceFiles = {}; // modId → {file: count}
  const moduleNames = {};       // modId → [{minified, semantic}]

  for (const d of decoded) {
    const modId = findModule(d.offset);
    if (!modId) continue;

    // Source file attribution
    if (d.sourceIdx >= 0 && d.sourceIdx < sources.length) {
      if (!moduleSourceFiles[modId]) moduleSourceFiles[modId] = {};
      const src = sources[d.sourceIdx];
      moduleSourceFiles[modId][src] = (moduleSourceFiles[modId][src] || 0) + 1;
    }

    // Name attribution
    if (d.nameIdx >= 0 && d.nameIdx < names.length) {
      if (!moduleNames[modId]) moduleNames[modId] = [];
      moduleNames[modId].push({
        semantic: names[d.nameIdx],
        offset: d.offset,
      });
    }
  }

  // Enrich BKG modules
  let modulesWithSource = 0;
  let modulesWithNames = 0;
  let totalNamePairs = 0;

  for (const mod of bkg.modules) {
    // Source file: pick the most frequent
    const srcFiles = moduleSourceFiles[mod.id];
    if (srcFiles) {
      const best = Object.entries(srcFiles).sort((a, b) => b[1] - a[1])[0];
      mod.source_file = best[0];
      // Derive semantic name from source file path
      const fname = best[0].replace(/.*\//, "").replace(/\.[^.]+$/, "");
      if (!mod.semantic_name || mod.semantic_source === "propagation") {
        mod.semantic_name = fname;
        mod.semantic_confidence = 0.95;
        mod.semantic_source = "source_map_file";
      }
      modulesWithSource++;
    }

    // Names: add to identifiers
    const modNames = moduleNames[mod.id];
    if (modNames) {
      modulesWithNames++;
      totalNamePairs += modNames.length;
    }
  }

  // Populate identifiers from name mappings
  const identifiers = [];
  for (const [modId, nameList] of Object.entries(moduleNames)) {
    const seen = new Set();
    for (const n of nameList) {
      if (seen.has(n.semantic)) continue;
      seen.add(n.semantic);
      identifiers.push({
        id: `var:${modId}:${n.semantic}`,
        module: modId,
        minified: "",  // Would need the minified name from bundle at that offset
        semantic: n.semantic,
        state: "semantic",
        confidence: 1.0,
        source: "source_map",
        role: "variable",
      });
    }
  }
  bkg.identifiers = identifiers;

  // Update coverage
  bkg.coverage.modules_named = bkg.modules.filter(m => m.semantic_name).length;
  bkg.coverage.identifiers_semantic = identifiers.length;

  // Log enrichment
  bkg.enrichments.push({
    timestamp: new Date().toISOString(),
    technique: "source_map_enrichment",
    reference_version: null,
    modules_enriched: modulesWithSource,
    identifiers_enriched: identifiers.length,
    provenance: `demini-bkg enrich-sourcemap: ${sources.length} sources, ${names.length} names, ${decoded.length} mappings`,
  });

  fs.writeFileSync(outputPath, JSON.stringify(bkg, null, 2));
  const enrichElapsed = Date.now() - enrichStart;

  console.log(`\n=== Enrichment complete ===`);
  console.log(`Modules with source_file: ${modulesWithSource}/${bkg.modules.length}`);
  console.log(`Modules with names: ${modulesWithNames}`);
  console.log(`Unique identifiers: ${identifiers.length}`);
  console.log(`Total name mappings: ${totalNamePairs}`);
  console.log(`Elapsed: ${enrichElapsed}ms`);
  console.log(`\nWrote: ${outputPath}`);

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
