#!/usr/bin/env node
/**
 * Test: Declaration-only alignment between minified and unminified same-source modules.
 * Hypothesis: variable/function DECLARATIONS are in the same order even when expressions differ.
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import fs from "node:fs";

function getDeclarations(code) {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 2025, sourceType: "module" });
    const decls = [];
    walk.simple(ast, {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier") decls.push(node.id.name);
      },
      FunctionDeclaration(node) {
        if (node.id) decls.push(node.id.name);
      },
    });
    return decls;
  } catch { return []; }
}

const minDir = "/tmp/rebundle-bun-minified/DEMINI_00/03_split-cli";
const refDir = "/tmp/rebundle-bun-pass1/DEMINI_00/03_split-cli";
const bkg = JSON.parse(fs.readFileSync("/tmp/rebundle-same-source-matched.json", "utf8"));
const minManifest = JSON.parse(fs.readFileSync(`${minDir}/manifest.json`, "utf8"));
const refManifest = JSON.parse(fs.readFileSync(`${refDir}/manifest.json`, "utf8"));

const refByName = {};
for (const m of refManifest.modules) {
  if (m.firstName) refByName[m.firstName] = m;
}

let exact = 0, close = 0, mismatch = 0, total = 0;
let totalDeclPairs = 0;
let sampleShown = false;

for (const minMod of minManifest.modules) {
  const bkgMod = bkg.modules.find(m => m.minified_name === minMod.firstName);
  if (!bkgMod || !bkgMod.semantic_name) continue;

  const refName = bkgMod.semantic_name.replace(/^near_/, "");
  const refMod = refByName[refName];
  if (!refMod) continue;

  const minPath = `${minDir}/${minMod.filename}`;
  const refPath = `${refDir}/${refMod.filename}`;
  if (!fs.existsSync(minPath) || !fs.existsSync(refPath)) continue;

  const minDecls = getDeclarations(fs.readFileSync(minPath, "utf8"));
  const refDecls = getDeclarations(fs.readFileSync(refPath, "utf8"));

  total++;

  if (minDecls.length === refDecls.length) {
    exact++;
    totalDeclPairs += minDecls.length;
  } else if (Math.abs(minDecls.length - refDecls.length) <= 2) {
    close++;
  } else {
    mismatch++;
  }

  // Show sample of exact match
  if (minDecls.length === refDecls.length && minDecls.length > 3 && !sampleShown) {
    console.log(`\nSample: ${bkgMod.id} (${minDecls.length} declarations)`);
    for (let i = 0; i < Math.min(15, minDecls.length); i++) {
      const marker = minDecls[i] === refDecls[i] ? "  (same)" : "";
      console.log(`  ${minDecls[i].padEnd(20)} → ${refDecls[i]}${marker}`);
    }
    sampleShown = true;
  }
}

console.log(`\nDeclaration count alignment (same source, min vs unmin):`);
console.log(`  Exact match: ${exact}/${total} (${(exact/total*100).toFixed(1)}%)`);
console.log(`  Close (±2):  ${close}/${total}`);
console.log(`  Mismatch:    ${mismatch}/${total}`);
console.log(`  Total declaration pairs (exact): ${totalDeclPairs}`);
