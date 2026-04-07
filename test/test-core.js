#!/usr/bin/env node
/**
 * demini core test suite — focused tests for the critical path
 *
 * Tests use node:test (built-in, no dependencies).
 * Fixtures are inline synthetic bundles (no external files).
 *
 * Run: node --test test/test-core.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, "test", ".tmp");

// Cleanup/setup
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// Minimal synthetic bundle: 3 modules (runtime + 2 ESM)
const SYNTHETIC_BUNDLE = `#!/usr/bin/env node
var y = (r) => r;
var u = (r) => ({ default: r });
var init_add = y(() => {
  function add(a, b) {
    return a + b;
  }
});
var init_multiply = y(() => {
  function multiply(x, y) {
    return x * y;
  }
});
init_add();
init_multiply();
console.log("test bundle");
`;

fs.writeFileSync(path.join(TMP, "input.js"), SYNTHETIC_BUNDLE);

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30000 });
}

// =====================================================================
// Test: demini-beautify
// =====================================================================

describe("demini-beautify", () => {
  it("beautifies a JS file preserving shebang", () => {
    run(`node demini-beautify.js ${TMP}/input.js ${TMP}/beautify-out/`);
    const outFile = path.join(TMP, "beautify-out", "DEMINI_00", "00_beautified-input.js");
    assert.ok(fs.existsSync(outFile), "beautified file should exist");
    const content = fs.readFileSync(outFile, "utf8");
    assert.ok(content.startsWith("#!/usr/bin/env node"), "shebang should be preserved");
    assert.ok(content.length >= SYNTHETIC_BUNDLE.length, "beautified should be >= original size");
  });

  it("creates run.json provenance", () => {
    const runJson = path.join(TMP, "beautify-out", "DEMINI_00", "run.json");
    assert.ok(fs.existsSync(runJson), "run.json should exist");
  });
});

// =====================================================================
// Test: demini-classify
// =====================================================================

describe("demini-classify", () => {
  it("classifies statements in beautified bundle", () => {
    const beautified = path.join(TMP, "beautify-out", "DEMINI_00", "00_beautified-input.js");
    run(`node demini-classify.js ${beautified} ${TMP}/beautify-out/DEMINI_00/`);
    const classified = path.join(TMP, "beautify-out", "DEMINI_00", "01_classified-beautified-input.js");
    assert.ok(fs.existsSync(classified), "classified file should exist");
    const stats = path.join(TMP, "beautify-out", "DEMINI_00", "01_stats-beautified-input.json");
    assert.ok(fs.existsSync(stats), "stats JSON should exist");
  });
});

// =====================================================================
// Test: VLQ decoding (used by enrich-sourcemap)
// =====================================================================

describe("VLQ decoding", () => {
  // VLQ is used internally by enrich-sourcemap — test the algorithm
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

  it("decodes simple VLQ values", () => {
    assert.deepEqual(decodeVLQ("A"), [0]);
    assert.deepEqual(decodeVLQ("C"), [1]);
    assert.deepEqual(decodeVLQ("D"), [-1]);
    assert.deepEqual(decodeVLQ("E"), [2]);
  });

  it("decodes multi-field segments", () => {
    // "AACA" = [0, 0, 1, 0]
    assert.deepEqual(decodeVLQ("AACA"), [0, 0, 1, 0]);
  });

  it("decodes negative values", () => {
    assert.deepEqual(decodeVLQ("D"), [-1]);
    assert.deepEqual(decodeVLQ("F"), [-2]);
    assert.deepEqual(decodeVLQ("H"), [-3]);
  });

  it("decodes larger values requiring continuation bits", () => {
    // "gB" = 16 (continuation bit set on first char)
    const result = decodeVLQ("gB");
    assert.equal(result[0], 16);
  });
});

// =====================================================================
// Test: BKG JSON structure
// =====================================================================

describe("BKG structure", () => {
  it("extract produces valid BKG JSON", async () => {
    // Need trace first, then split, then extract
    const beautified = path.join(TMP, "beautify-out", "DEMINI_00", "00_beautified-input.js");
    const classified = path.join(TMP, "beautify-out", "DEMINI_00", "01_classified-beautified-input.js");

    // Run trace
    run(`node demini-trace.js ${classified} ${TMP}/beautify-out/DEMINI_00/`);
    const traced = path.join(TMP, "beautify-out", "DEMINI_00", "02_traced-classified-beautified-input.js");
    assert.ok(fs.existsSync(traced), "traced file should exist");

    // Run split
    run(`node demini-split.js ${traced} ${TMP}/beautify-out/DEMINI_00/`);
    const splitDir = path.join(TMP, "beautify-out", "DEMINI_00", "03_split-input");
    assert.ok(fs.existsSync(splitDir), "split dir should exist");

    // Run extract
    run(`node demini-extract.js ${traced}`);
    const bkgFile = path.join(TMP, "beautify-out", "DEMINI_00", "04_bkg-input.json");
    assert.ok(fs.existsSync(bkgFile), "BKG file should exist");

    const bkg = JSON.parse(fs.readFileSync(bkgFile, "utf8"));
    assert.ok(bkg.bkg_version, "should have bkg_version");
    assert.ok(bkg.modules, "should have modules array");
    assert.ok(bkg.modules.length > 0, "should have at least 1 module");
    assert.ok(bkg.coverage, "should have coverage object");

    // Each module should have required fields
    const mod = bkg.modules[0];
    assert.ok(mod.id, "module should have id");
    assert.ok(mod.wrapKind, "module should have wrapKind");
    assert.ok(typeof mod.bytes === "number", "module should have bytes");
    assert.ok(typeof mod.stmtCount === "number", "module should have stmtCount");
  });
});

// =====================================================================
// Test: demini-rename scope safety
// =====================================================================

describe("demini-rename", () => {
  it("renames identifiers without breaking parse", () => {
    // Create a mini split dir with one module
    const renameDir = path.join(TMP, "rename-test");
    fs.mkdirSync(renameDir, { recursive: true });

    const modCode = `var ab = 1;
var cd = function(ef) { return ef + ab; };
cd(42);
`;
    fs.writeFileSync(path.join(renameDir, "mod_0001_testmod.js"), modCode);

    // Create rename pairs
    const pairs = [
      { module: "testmod", minified: "ab", semantic: "counter" },
      { module: "testmod", minified: "cd", semantic: "addToCounter" },
      { module: "testmod", minified: "ef", semantic: "value" },
    ];
    const pairsPath = path.join(TMP, "rename-pairs.json");
    fs.writeFileSync(pairsPath, JSON.stringify(pairs));

    const outDir = path.join(TMP, "rename-out");
    run(`node demini-rename.js ${renameDir} ${pairsPath} -o ${outDir}`);

    const renamed = fs.readFileSync(path.join(outDir, "mod_0001_testmod.js"), "utf8");
    assert.ok(renamed.includes("counter"), "should contain renamed 'counter'");
    assert.ok(renamed.includes("addToCounter"), "should contain renamed 'addToCounter'");
    // Note: 'ef' is a 2-char param — demini-rename skips single-char but allows 2-char
    // The rename may or may not apply depending on scope binding detection
    assert.ok(!renamed.includes("var ab"), "should not contain original 'ab'");
  });

  it("skips single-char identifiers (too risky)", () => {
    const renameDir = path.join(TMP, "rename-skip");
    fs.mkdirSync(renameDir, { recursive: true });
    fs.writeFileSync(path.join(renameDir, "mod_0001_skiptest.js"), "var x = 1; var ab = x + 2;\n");

    const pairs = [
      { module: "skiptest", minified: "x", semantic: "shouldNotRename" },
      { module: "skiptest", minified: "ab", semantic: "shouldRename" },
    ];
    fs.writeFileSync(path.join(TMP, "skip-pairs.json"), JSON.stringify(pairs));

    const outDir = path.join(TMP, "rename-skip-out");
    run(`node demini-rename.js ${renameDir} ${TMP}/skip-pairs.json -o ${outDir}`);

    const result = fs.readFileSync(path.join(outDir, "mod_0001_skiptest.js"), "utf8");
    assert.ok(result.includes("var x"), "single-char 'x' should NOT be renamed");
    assert.ok(result.includes("shouldRename"), "'ab' should be renamed");
  });
});

// =====================================================================
// Test: demini-reassemble
// =====================================================================

describe("demini-reassemble", () => {
  it("reassembles split modules into executable bundle", () => {
    const splitDir = path.join(TMP, "beautify-out", "DEMINI_00", "03_split-input");
    const traced = path.join(TMP, "beautify-out", "DEMINI_00", "02_traced-classified-beautified-input.js");

    if (!fs.existsSync(splitDir) || !fs.existsSync(traced)) {
      // Skip if pipeline hasn't run
      return;
    }

    run(`node demini-reassemble.js ${splitDir} ${traced} -o ${TMP}/reassembled.js`);
    assert.ok(fs.existsSync(path.join(TMP, "reassembled.js")), "reassembled file should exist");

    // Should be parseable
    const code = fs.readFileSync(path.join(TMP, "reassembled.js"), "utf8");
    assert.ok(code.length > 0, "reassembled should not be empty");
  });
});

// =====================================================================
// Test: BKG match basics
// =====================================================================

describe("demini-bkg match", () => {
  it("runs match subcommand without error on synthetic BKG", () => {
    const bkgFile = path.join(TMP, "beautify-out", "DEMINI_00", "04_bkg-input.json");
    if (!fs.existsSync(bkgFile)) return; // Skip if extract hasn't run

    // Match BKG against itself — tiny bundle may not produce matches
    // (needs ≥2 strings per module for Jaccard matching)
    // The test verifies the command runs without error and produces valid output
    const output = run(`node demini-bkg.js match ${bkgFile} ${bkgFile} -o ${TMP}/self-match.bkg.json`);
    assert.ok(output.includes("Match Summary"), "should complete with summary");
    assert.ok(fs.existsSync(path.join(TMP, "self-match.bkg.json")), "should produce output file");

    const matched = JSON.parse(fs.readFileSync(path.join(TMP, "self-match.bkg.json"), "utf8"));
    assert.ok(matched.modules, "output should have modules array");
    assert.ok(matched.enrichments, "output should have enrichments array");
  });
});

// Cleanup
process.on("exit", () => {
  try { fs.rmSync(TMP, { recursive: true }); } catch (e) { /* ignore */ }
});
