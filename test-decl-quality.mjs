#!/usr/bin/env node
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
for (const m of refManifest.modules) if (m.firstName) refByName[m.firstName] = m;

// Collect all validated declaration pairs from exact-count modules
const allPairs = {};
let totalPairs = 0;
let identityPairs = 0;  // same name in both (not renamed)
let renamedPairs = 0;
let shortMin = 0;  // minified name is 1 char

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

  if (minDecls.length !== refDecls.length) continue;

  const pairs = [];
  for (let i = 0; i < minDecls.length; i++) {
    totalPairs++;
    if (minDecls[i] === refDecls[i]) {
      identityPairs++;
    } else {
      renamedPairs++;
      if (minDecls[i].length === 1) shortMin++;
      pairs.push({ minified: minDecls[i], semantic: refDecls[i] });
    }
  }
  if (pairs.length > 0) allPairs[bkgMod.id] = pairs;
}

const totalRenamed = Object.values(allPairs).reduce((s, v) => s + v.length, 0);
console.log(`Total declaration pairs: ${totalPairs}`);
console.log(`  Identity (same name): ${identityPairs} (${(identityPairs/totalPairs*100).toFixed(1)}%)`);
console.log(`  Renamed: ${renamedPairs}`);
console.log(`    1-char minified: ${shortMin}`);
console.log(`    2+ char minified: ${renamedPairs - shortMin}`);
console.log(`Modules with rename pairs: ${Object.keys(allPairs).length}`);

// Show 3 good samples (2+ char minified, not RUNTIME)
let shown = 0;
for (const [modId, pairs] of Object.entries(allPairs)) {
  if (modId === "mod:Y15") continue;
  const good = pairs.filter(p => p.minified.length >= 2);
  if (good.length >= 3 && shown < 3) {
    console.log(`\n${modId}:`);
    for (const p of good.slice(0, 5)) {
      console.log(`  ${p.minified.padEnd(25)} → ${p.semantic}`);
    }
    shown++;
  }
}

// Save for later use
fs.writeFileSync("/tmp/decl_pairs.json", JSON.stringify(allPairs, null, 2));
console.log(`\nSaved to /tmp/decl_pairs.json`);
