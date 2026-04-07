#!/usr/bin/env node

/**
 * demini-infer — LLM-assisted identifier inference pipeline stage
 *
 * Usage: demini-infer <split-dir> [--bkg bkg.json] [--reference ref-split-dir]
 *                     [--model model] [--mode paired|standalone] [-o output.json]
 *
 * Modes:
 *   paired:     Both target + reference modules available (E_difffocused prompt)
 *   standalone: Only target module (infer from code context alone)
 *
 * Uses ollama API (localhost:11434) for local LLM inference.
 * Produces rename pairs JSON compatible with demini-rename.
 */

import fs from "node:fs";
import path from "node:path";

const OLLAMA_URL = "http://localhost:11434/api/generate";

// --- Argument Parsing ---

const args = process.argv.slice(2);
const splitDir = args[0];

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const bkgPath = getArg("--bkg", null);
const refDir = getArg("--reference", null);
const model = getArg("--model", "qwen2.5-coder:7b");
const mode = getArg("--mode", refDir ? "paired" : "standalone");
const oIdx = args.indexOf("-o");
const outputPath = oIdx !== -1 && args[oIdx + 1] ? path.resolve(args[oIdx + 1]) : "infer_pairs.json";

if (!splitDir) {
  console.error("demini-infer: LLM-assisted identifier inference");
  console.error("");
  console.error("Usage: demini-infer <split-dir> [options]");
  console.error("");
  console.error("Options:");
  console.error("  --bkg <bkg.json>         BKG with match data (for paired mode)");
  console.error("  --reference <split-dir>  Reference split dir (semantic names)");
  console.error("  --model <name>           Ollama model (default: qwen2.5-coder:7b)");
  console.error("  --mode paired|standalone Mode (default: auto-detect from --reference)");
  console.error("  -o <output.json>         Output rename pairs (default: infer_pairs.json)");
  process.exit(1);
}

const resolvedSplit = path.resolve(splitDir);
const resolvedRef = refDir ? path.resolve(refDir) : null;

// --- Prompt Templates ---

const JS_KW = new Set(["do","if","in","of","for","let","new","try","var","case","else",
  "enum","null","this","true","void","with","await","break","catch","class","const","false",
  "super","throw","while","yield","delete","export","import","return","switch","typeof",
  "default","extends","finally","function","debugger","arguments","instanceof","undefined"]);

function pairedPrompt(tgtCode, refCode) {
  const tgtIds = new Set(tgtCode.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || []);
  const refIds = new Set(refCode.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || []);
  const shortOnly = [...tgtIds].filter(n => n.length <= 4 && !refIds.has(n) && !JS_KW.has(n));
  const longOnly = [...refIds].filter(n => n.length >= 5 && !tgtIds.has(n) && !JS_KW.has(n));

  return `Two versions of the same JavaScript module differ only in identifier names.

Short (minified) names unique to version A: ${shortOnly.slice(0, 50).join(", ")}
Long (semantic) names unique to version B: ${longOnly.slice(0, 50).join(", ")}

VERSION A (minified):
${tgtCode.slice(0, 3000)}

VERSION B (semantic):
${refCode.slice(0, 3000)}

Match each short name to its semantic equivalent. Output ONLY a JSON array of {"minified":"x","semantic":"longName"} objects:`;
}

function standalonePrompt(code) {
  const ids = new Set(code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || []);
  const shortIds = [...ids].filter(n => n.length <= 3 && !JS_KW.has(n));

  return `Read this JavaScript module and infer what the short variable names mean from context (property accesses, string literals, function calls, patterns).

Short names to identify: ${shortIds.slice(0, 30).join(", ")}

Code:
${code.slice(0, 3000)}

For each short name you can confidently identify, output a JSON array of {"minified":"x","semantic":"meaningfulName"}. Only include names you're confident about. Output ONLY the JSON array:`;
}

// --- Ollama API ---

async function ollamaGenerate(prompt) {
  const start = Date.now();
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 2048 },
    }),
  });
  const data = await resp.json();
  return { response: data.response || "", elapsed: (Date.now() - start) / 1000 };
}

function extractJSON(text) {
  for (const pat of [/\[[\s\S]*\]/, /```json\s*(\[[\s\S]*?\])\s*```/, /```\s*(\[[\s\S]*?\])\s*```/]) {
    const m = text.match(pat);
    if (m) {
      try { const arr = JSON.parse(m[1] || m[0]); if (Array.isArray(arr)) return arr; } catch (e) {}
    }
  }
  try { const arr = JSON.parse(text); if (Array.isArray(arr)) return arr; } catch (e) {}
  return null;
}

// --- File Discovery ---

function buildFileIndex(dir) {
  const idx = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith("mod_") || !f.endsWith(".js")) continue;
    const name = f.replace(".js", "").split("_").slice(2).join("_");
    idx[name] = path.join(dir, f);
  }
  return idx;
}

// --- Main ---

async function main() {
  console.error("=== demini-infer ===");
  console.error(`Split dir: ${resolvedSplit}`);
  console.error(`Mode: ${mode}`);
  console.error(`Model: ${model}`);
  if (resolvedRef) console.error(`Reference: ${resolvedRef}`);
  if (bkgPath) console.error(`BKG: ${bkgPath}`);
  console.error(`Output: ${outputPath}`);
  console.error("");

  const tgtFiles = buildFileIndex(resolvedSplit);
  const refFiles = resolvedRef ? buildFileIndex(resolvedRef) : {};

  // Determine which modules to process
  let moduleList = [];

  if (bkgPath && mode === "paired") {
    // Paired mode with BKG: process matched modules where reference exists
    const bkg = JSON.parse(fs.readFileSync(path.resolve(bkgPath), "utf8"));
    for (const mod of bkg.modules) {
      if (mod.semantic_name && tgtFiles[mod.minified_name] && refFiles[mod.semantic_name]) {
        moduleList.push({ tgt: mod.minified_name, ref: mod.semantic_name });
      }
    }
  } else if (mode === "standalone") {
    // Standalone: process all modules in split dir
    for (const name of Object.keys(tgtFiles)) {
      if (name === "RUNTIME") continue;
      moduleList.push({ tgt: name, ref: null });
    }
  } else {
    // Auto: if reference exists, pair by matching filenames
    for (const name of Object.keys(tgtFiles)) {
      if (name === "RUNTIME") continue;
      moduleList.push({ tgt: name, ref: refFiles[name] ? name : null });
    }
  }

  console.error(`Modules to process: ${moduleList.length}`);
  console.error("");

  const allPairs = [];
  let totalNames = 0, jsonFails = 0, totalTime = 0;

  for (let i = 0; i < moduleList.length; i++) {
    const { tgt, ref } = moduleList[i];
    const tgtCode = fs.readFileSync(tgtFiles[tgt], "utf8");

    let prompt;
    if (ref && refFiles[ref]) {
      const refCode = fs.readFileSync(refFiles[ref], "utf8");
      prompt = pairedPrompt(tgtCode, refCode);
    } else {
      prompt = standalonePrompt(tgtCode);
    }

    const { response, elapsed } = await ollamaGenerate(prompt);
    totalTime += elapsed;

    const mappings = extractJSON(response) || [];
    const validMappings = mappings.filter(m =>
      m.minified && m.semantic && m.minified !== m.semantic &&
      m.minified.length <= 4 && m.semantic.length >= 3
    );

    for (const m of validMappings) {
      allPairs.push({ module: tgt, minified: m.minified, semantic: m.semantic });
    }

    totalNames += validMappings.length;
    if (!mappings.length) jsonFails++;

    const status = validMappings.length > 0 ? `${validMappings.length} names` : "EMPTY";
    process.stderr.write(`  [${i + 1}/${moduleList.length}] ${tgt} — ${status} (${elapsed.toFixed(1)}s)\n`);

    // Save progress every 50 modules
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(outputPath, JSON.stringify(allPairs, null, 2));
      const remaining = moduleList.length - i - 1;
      const avg = totalTime / (i + 1);
      console.error(`  --- Progress: ${i + 1}/${moduleList.length} | ${totalNames} names | ETA: ${(remaining * avg / 60).toFixed(1)} min ---`);
    }
  }

  // Final save
  fs.writeFileSync(outputPath, JSON.stringify(allPairs, null, 2));

  console.error("");
  console.error("=== demini-infer complete ===");
  console.error(`Modules: ${moduleList.length}`);
  console.error(`Names inferred: ${totalNames}`);
  console.error(`JSON failures: ${jsonFails}`);
  console.error(`Time: ${(totalTime / 60).toFixed(1)} min (${(totalTime / moduleList.length).toFixed(1)}s/mod)`);
  console.error(`Output: ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
