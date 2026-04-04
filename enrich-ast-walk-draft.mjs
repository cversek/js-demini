#!/usr/bin/env node
/**
 * Prototype v2: parallel AST walk with cross-validation and filtering.
 */

import fs from "node:fs";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

function collectIdentifiers(code) {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 2025, sourceType: "module" });
    const ids = [];
    walk.simple(ast, {
      Identifier(node) {
        ids.push({ name: node.name, start: node.start, end: node.end });
      }
    });
    return ids;
  } catch {
    try {
      const ast = acorn.parse(code, { ecmaVersion: 2025, sourceType: "script" });
      const ids = [];
      walk.simple(ast, {
        Identifier(node) {
          ids.push({ name: node.name, start: node.start, end: node.end });
        }
      });
      return ids;
    } catch { return []; }
  }
}

const targetDir = process.argv[2];
const refDir = process.argv[3];
const bkgPath = process.argv[4];

const bkg = JSON.parse(fs.readFileSync(bkgPath, "utf8"));
const targetManifest = JSON.parse(fs.readFileSync(`${targetDir}/manifest.json`, "utf8"));
const refManifest = JSON.parse(fs.readFileSync(`${refDir}/manifest.json`, "utf8"));

const refByName = {};
for (const m of refManifest.modules) {
  if (m.firstName) refByName[m.firstName] = m;
}

let totalPairs = 0;
let totalValidated = 0;
let totalConflicts = 0;
let modulesProcessed = 0;
let modulesWithPairs = 0;

const allPairs = {};

for (const targetMod of targetManifest.modules) {
  const bkgMod = bkg.modules.find(m => m.minified_name === targetMod.firstName);
  if (!bkgMod || !bkgMod.semantic_name) continue;

  const refName = bkgMod.semantic_name.replace(/^near_/, "");
  const refMod = refByName[refName];
  if (!refMod) continue;

  const targetPath = `${targetDir}/${targetMod.filename}`;
  const refPath = `${refDir}/${refMod.filename}`;
  if (!fs.existsSync(targetPath) || !fs.existsSync(refPath)) continue;

  const targetCode = fs.readFileSync(targetPath, "utf8");
  const refCode = fs.readFileSync(refPath, "utf8");

  const targetIds = collectIdentifiers(targetCode);
  const refIds = collectIdentifiers(refCode);

  modulesProcessed++;

  const len = Math.min(targetIds.length, refIds.length);
  const rawPairs = [];
  for (let i = 0; i < len; i++) {
    const tName = targetIds[i].name;
    const rName = refIds[i].name;
    if (tName !== rName) {
      rawPairs.push({ minified: tName, semantic: rName });
    }
  }

  // Cross-validate: consistency check per minified name
  const mapping = {};
  for (const p of rawPairs) {
    if (!mapping[p.minified]) mapping[p.minified] = {};
    mapping[p.minified][p.semantic] = (mapping[p.minified][p.semantic] || 0) + 1;
  }

  const validated = [];
  let conflicts = 0;
  for (const [min, semMap] of Object.entries(mapping)) {
    const entries = Object.entries(semMap).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, e) => s + e[1], 0);
    const [bestSem, bestCount] = entries[0];

    if (entries.length === 1 || bestCount / total > 0.7) {
      validated.push({ minified: min, semantic: bestSem, count: bestCount, confidence: bestCount / total });
    } else {
      conflicts++;
    }
  }

  if (validated.length > 0) {
    allPairs[bkgMod.id] = validated;
    totalPairs += rawPairs.length;
    totalValidated += validated.length;
    totalConflicts += conflicts;
    modulesWithPairs++;
  }
}

console.log(`Modules processed: ${modulesProcessed}`);
console.log(`Modules with validated pairs: ${modulesWithPairs}`);
console.log(`Raw identifier pairs: ${totalPairs}`);
console.log(`Validated unique mappings: ${totalValidated}`);
console.log(`Conflicted (dropped): ${totalConflicts}`);
console.log(`Validation rate: ${(totalValidated / (totalValidated + totalConflicts) * 100).toFixed(1)}%`);

// Sample a non-RUNTIME module
for (const [modId, pairs] of Object.entries(allPairs)) {
  if (modId === "mod:Y15") continue;
  if (pairs.length > 5) {
    console.log(`\nSample from ${modId} (${pairs.length} validated pairs):`);
    for (const p of pairs.slice(0, 10)) {
      console.log(`  ${p.minified.padEnd(20)} → ${p.semantic} (${(p.confidence * 100).toFixed(0)}%, n=${p.count})`);
    }
    break;
  }
}

fs.writeFileSync("/tmp/ast_walk_pairs.json", JSON.stringify(allPairs, null, 2));
console.log(`\nWrote pairs to /tmp/ast_walk_pairs.json`);
