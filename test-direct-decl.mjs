#!/usr/bin/env node
/** Direct declaration alignment: v87 minified ↔ pass1 unminified */
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import fs from "node:fs";

function getDeclarations(code) {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 2025, sourceType: "module" });
    const decls = [];
    walk.simple(ast, {
      VariableDeclarator(n) { if (n.id.type === "Identifier") decls.push(n.id.name); },
      FunctionDeclaration(n) { if (n.id) decls.push(n.id.name); },
    });
    return decls;
  } catch { return []; }
}

const v87Dir = "/tmp/demini-anchor/v87/DEMINI_00/03_split-cli";
const refDir = "/tmp/rebundle-bun-pass1/DEMINI_00/03_split-cli";
const bkg = JSON.parse(fs.readFileSync("/tmp/rebundle-bun-pass1/v87_propagated.json", "utf8"));
const v87Manifest = JSON.parse(fs.readFileSync(`${v87Dir}/manifest.json`, "utf8"));
const refManifest = JSON.parse(fs.readFileSync(`${refDir}/manifest.json`, "utf8"));
const refByName = {};
for (const m of refManifest.modules) if (m.firstName) refByName[m.firstName] = m;

let exact = 0, total = 0, totalPairs = 0, renamed2plus = 0;
const allPairs = {};

for (const v87Mod of v87Manifest.modules) {
  const bkgMod = bkg.modules.find(m => m.minified_name === v87Mod.firstName);
  if (!bkgMod || !bkgMod.semantic_name) continue;
  const refName = bkgMod.semantic_name.replace(/^near_/, "");
  const refMod = refByName[refName];
  if (!refMod) continue;
  const v87Path = `${v87Dir}/${v87Mod.filename}`;
  const refPath = `${refDir}/${refMod.filename}`;
  if (!fs.existsSync(v87Path) || !fs.existsSync(refPath)) continue;

  const v87Decls = getDeclarations(fs.readFileSync(v87Path, "utf8"));
  const refDecls = getDeclarations(fs.readFileSync(refPath, "utf8"));
  total++;

  if (v87Decls.length !== refDecls.length) continue;
  exact++;

  const pairs = [];
  for (let i = 0; i < v87Decls.length; i++) {
    if (v87Decls[i] !== refDecls[i]) {
      pairs.push({ minified: v87Decls[i], semantic: refDecls[i] });
      totalPairs++;
      if (v87Decls[i].length >= 2) renamed2plus++;
    }
  }
  if (pairs.length > 0) allPairs[bkgMod.id] = pairs;
}

console.log(`Exact decl count match: ${exact}/${total} (${(exact/total*100).toFixed(1)}%)`);
console.log(`Total rename pairs: ${totalPairs}`);
console.log(`  2+ char minified: ${renamed2plus}`);
console.log(`Modules with pairs: ${Object.keys(allPairs).length}`);

let shown = 0;
for (const [id, pairs] of Object.entries(allPairs)) {
  if (id === "mod:Y15") continue;
  const good = pairs.filter(p => p.minified.length >= 2);
  if (good.length >= 3 && shown < 5) {
    console.log(`\n${id}: ${pairs.length} pairs`);
    for (const p of good.slice(0, 5))
      console.log(`  ${p.minified.padEnd(25)} → ${p.semantic}`);
    shown++;
  }
}

fs.writeFileSync("/tmp/v87_direct_decl_pairs.json", JSON.stringify(allPairs, null, 2));
console.log(`\nSaved to /tmp/v87_direct_decl_pairs.json`);
