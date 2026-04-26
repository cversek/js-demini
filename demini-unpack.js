#!/usr/bin/env node
/**
 * demini-unpack — Extract embedded JS bundles from compiled standalone binaries
 *
 * Pre-pipeline preprocessing stage. Locates `// @bun`-marked JS payloads
 * inside Bun-compiled native executables and extracts them as standalone
 * `.js` files that downstream demini stages (beautify, classify, etc.)
 * can consume.
 *
 * Algorithm:
 *   1. Scan binary for `// @bun` markers (entry points of embedded bundles)
 *   2. For each marker, walk forward to find bundle end via text-density
 *      analysis with tolerance for short embedded gaps
 *   3. Score bundles by size + structural signal (IIFE wrapper, tengu/sentinel
 *      strings, function density)
 *   4. Extract the highest-scoring bundle (or all bundles with --all)
 *
 * Usage:
 *   demini-unpack <input.binary> [output-dir]
 *   demini-unpack --all <input.binary> [output-dir]
 *   demini-unpack --bundle-index <N> <input.binary> [output-dir]
 *   demini-unpack --info <input.binary>           # report only, no extraction
 *
 * Output:
 *   <output-dir>/unpacked-<basename>.js           # main bundle (default)
 *   <output-dir>/unpacked-<basename>.<N>.js       # additional bundles (--all)
 *   <output-dir>/unpacked-<basename>.json         # provenance + stats sidecar
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// --- Argument parsing ---

const args = process.argv.slice(2);
let mode = "main";       // "main" | "all" | "info" | "index"
let bundleIndex = null;
let positional = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--all") mode = "all";
  else if (a === "--info") mode = "info";
  else if (a === "--bundle-index") {
    mode = "index";
    bundleIndex = parseInt(args[++i], 10);
  } else if (a === "-h" || a === "--help") {
    printHelp();
    process.exit(0);
  } else {
    positional.push(a);
  }
}

function printHelp() {
  console.error("demini-unpack: extract embedded JS bundles from compiled standalone binaries");
  console.error("");
  console.error("Usage:");
  console.error("  demini-unpack <input.binary> [output-dir]");
  console.error("  demini-unpack --all <input.binary> [output-dir]");
  console.error("  demini-unpack --bundle-index <N> <input.binary> [output-dir]");
  console.error("  demini-unpack --info <input.binary>");
  console.error("");
  console.error("Modes:");
  console.error("  default        Extract the highest-scoring bundle (largest + most signals)");
  console.error("  --all          Extract every detected bundle");
  console.error("  --bundle-index Extract a specific bundle by 0-based index (sorted by offset)");
  console.error("  --info         Report findings without writing files");
}

const inputPath = positional[0];
if (!inputPath) {
  printHelp();
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  console.error(`demini-unpack: file not found: ${resolvedInput}`);
  process.exit(1);
}

const outputDir = positional[1]
  ? path.resolve(positional[1])
  : path.dirname(resolvedInput);

// --- Read binary ---

console.log("=== demini-unpack ===");
console.log(`Input:  ${resolvedInput}`);
const binaryBuf = fs.readFileSync(resolvedInput);
console.log(`Size:   ${binaryBuf.length.toLocaleString()} bytes (${(binaryBuf.length / 1024 / 1024).toFixed(2)} MB)`);
const inputHash = createHash("sha256").update(binaryBuf).digest("hex");
console.log(`SHA256: ${inputHash.slice(0, 16)}…`);
console.log("");

const startTime = Date.now();

// --- Locate @bun markers ---
//
// Bun-compiled standalone binaries embed JS payloads marked with `// @bun`
// optionally followed by flags like `@bytecode @bun-cjs`.

const BUN_MARKER = Buffer.from("// @bun");

function findAllOccurrences(haystack, needle) {
  const offsets = [];
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    offsets.push(idx);
    from = idx + 1;
  }
  return offsets;
}

const markerOffsets = findAllOccurrences(binaryBuf, BUN_MARKER);
console.log(`Found ${markerOffsets.length} @bun marker(s)`);

if (markerOffsets.length === 0) {
  console.error("demini-unpack: no @bun markers found — not a Bun standalone binary?");
  process.exit(2);
}

// --- Determine bundle end ---
//
// Bun standalone binaries separate embedded modules with a precise pattern:
//
//   })\n\x00/$bunfs/<virtual_path>\x00// @bun ...
//
// The closing `})\n` ends the IIFE wrapper, then a null byte, virtual filesystem
// path naming the NEXT module, another null, then the next `// @bun` marker.
//
// We search for the nearest separator after `start`. Falls back to a tolerant
// text-density walk if no separator is found (handles non-Bun binaries or
// last-bundle-before-EOF cases).

const SEPARATOR_RX = /\x00\/\$bunfs\//g;
const NEXT_MARKER = Buffer.from("// @bun");

function findBundleEnd(buf, start, allMarkerOffsets) {
  // Bundle terminator detection (in priority order):
  //
  //   1. `\x00/$bunfs/`  — Bun virtual filesystem separator (next module path)
  //   2. `\x00// @bun`   — direct next-module marker
  //   3. Run of >=8 consecutive null bytes — section padding
  //   4. Density fallback — for non-Bun binaries
  //
  // For all cases, backtrack to the last \n before the terminator so the
  // returned end is a clean syntactic cut.

  const nextMarker = allMarkerOffsets.find(o => o > start);
  const searchEnd = nextMarker ?? buf.length;

  // Hard terminators
  const region = buf.subarray(start, searchEnd);
  const candidates = [];
  for (const sep of [Buffer.from("\x00/$bunfs/"), Buffer.from("\x00// @bun")]) {
    const idx = region.indexOf(sep);
    if (idx !== -1) candidates.push(start + idx);
  }

  // Null run scan
  const NULL_RUN_LEN = 8;
  for (let i = start + 100; i < searchEnd - NULL_RUN_LEN; i++) {
    if (buf[i] !== 0) continue;
    let run = 0;
    while (i + run < searchEnd && buf[i + run] === 0 && run < NULL_RUN_LEN + 1) run++;
    if (run >= NULL_RUN_LEN) {
      candidates.push(i);
      break;
    }
    i += Math.max(0, run - 1);
  }

  if (candidates.length > 0) {
    // Take earliest terminator
    let terminator = Math.min(...candidates);
    let end = terminator;
    while (end > start && buf[end - 1] !== 0x0a) end--;
    if (end > start) return end;
  }

  // Fallback: text-density walk
  return findBundleEndByDensity(buf, start);
}

const CHUNK = 8192;
const TOLERATE_GAPS = 4;
const TEXT_DENSITY_MIN = 0.92;

function isPrintable(byte) {
  return (byte >= 32 && byte < 127) || byte === 9 || byte === 10 || byte === 13;
}

function chunkDensity(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let printable = 0;
  for (let i = start; i < end; i++) {
    if (isPrintable(buf[i])) printable++;
  }
  return printable / Math.max(1, end - start);
}

function findBundleEndByDensity(buf, start) {
  let pos = start;
  let lowRun = 0;
  let lastHighEnd = start;
  while (pos < buf.length) {
    const density = chunkDensity(buf, pos, CHUNK);
    if (density >= TEXT_DENSITY_MIN) {
      lastHighEnd = Math.min(buf.length, pos + CHUNK);
      lowRun = 0;
    } else {
      lowRun++;
      if (lowRun > TOLERATE_GAPS) break;
    }
    pos += CHUNK;
  }
  let end = lastHighEnd;
  while (end > start && buf[end - 1] !== 0x0a) end--;
  if (end <= start) end = lastHighEnd;
  return end;
}

// --- Score bundles ---
//
// Higher = more likely to be the main payload of interest.

function scoreBundle(buf, start, end) {
  const size = end - start;
  if (size < 1024) return { score: 0, size, signals: {} };
  const head = buf.slice(start, Math.min(end, start + 4096)).toString("utf8");
  const sample = buf.slice(start, Math.min(end, start + 200_000)).toString("utf8");
  const signals = {
    size,
    iife_wrapper: /\(function\s*\(exports\s*,\s*require\s*,\s*module/.test(head),
    bytecode_flag: /@bytecode|@bun-cjs/.test(head.slice(0, 200)),
    function_density: (sample.match(/\bfunction\s/g) || []).length,
    var_density: (sample.match(/\bvar\s/g) || []).length,
    require_calls: (sample.match(/\brequire\(/g) || []).length,
  };
  // Score: weighted sum
  const score =
    Math.log10(size) * 100 +
    (signals.iife_wrapper ? 500 : 0) +
    (signals.bytecode_flag ? 200 : 0) +
    Math.min(signals.function_density, 1000) * 0.5 +
    Math.min(signals.var_density, 1000) * 0.3 +
    Math.min(signals.require_calls, 500) * 0.4;
  return { score, ...signals };
}

const bundles = [];
for (const offset of markerOffsets) {
  const end = findBundleEnd(binaryBuf, offset, markerOffsets);
  const meta = scoreBundle(binaryBuf, offset, end);
  bundles.push({ offset, end, ...meta });
}

// --- Report ---

console.log("");
console.log("Detected bundles:");
console.log("  idx  offset       size         score   signals");
bundles.forEach((b, i) => {
  const sizeStr = `${(b.size / 1024 / 1024).toFixed(2)}MB`.padStart(10);
  const offStr = b.offset.toString().padStart(10);
  const scoreStr = b.score.toFixed(0).padStart(7);
  const flags = [
    b.iife_wrapper ? "IIFE" : "    ",
    b.bytecode_flag ? "BYTECODE" : "        ",
    `fn=${b.function_density}`,
  ].join(" ");
  console.log(`  ${i.toString().padStart(3)}  ${offStr}   ${sizeStr}   ${scoreStr}   ${flags}`);
});
console.log("");

if (mode === "info") {
  console.log("(--info mode: no files written)");
  process.exit(0);
}

// --- Determine which bundles to extract ---

let toExtract;
if (mode === "all") {
  toExtract = bundles.map((_, i) => i);
} else if (mode === "index") {
  if (bundleIndex < 0 || bundleIndex >= bundles.length) {
    console.error(`demini-unpack: --bundle-index ${bundleIndex} out of range [0, ${bundles.length - 1}]`);
    process.exit(3);
  }
  toExtract = [bundleIndex];
} else {
  // "main" — pick highest score
  let bestIdx = 0;
  for (let i = 1; i < bundles.length; i++) {
    if (bundles[i].score > bundles[bestIdx].score) bestIdx = i;
  }
  toExtract = [bestIdx];
}

// --- Write outputs ---

fs.mkdirSync(outputDir, { recursive: true });

const inputBasename = path.basename(resolvedInput).replace(/\.[^.]+$/, "");
const outputs = [];

for (const idx of toExtract) {
  const b = bundles[idx];
  const slice = binaryBuf.subarray(b.offset, b.end);
  const suffix = toExtract.length > 1 ? `.${idx}` : "";
  const outName = `unpacked-${inputBasename}${suffix}.js`;
  const outPath = path.join(outputDir, outName);
  fs.writeFileSync(outPath, slice);
  outputs.push({ idx, path: outPath, size: slice.length, ...b });
  console.log(`Wrote: ${outPath} (${(slice.length / 1024 / 1024).toFixed(2)}MB, idx=${idx})`);
}

// --- Sidecar provenance ---

const sidecar = {
  tool: "demini-unpack",
  version: "0.1.0",
  timestamp: new Date().toISOString(),
  input: {
    path: resolvedInput,
    size_bytes: binaryBuf.length,
    sha256: inputHash,
  },
  detection: {
    marker: "// @bun",
    bundles_found: bundles.length,
    chunk_size: CHUNK,
    tolerate_gaps: TOLERATE_GAPS,
    text_density_min: TEXT_DENSITY_MIN,
  },
  bundles: bundles.map((b, i) => ({
    index: i,
    offset: b.offset,
    end: b.end,
    size_bytes: b.size,
    score: Math.round(b.score),
    iife_wrapper: b.iife_wrapper,
    bytecode_flag: b.bytecode_flag,
    function_density: b.function_density,
    var_density: b.var_density,
    require_calls: b.require_calls,
  })),
  extracted: outputs.map(o => ({
    index: o.idx,
    path: o.path,
    size_bytes: o.size,
  })),
  elapsed_ms: Date.now() - startTime,
};

const sidecarPath = path.join(outputDir, `unpacked-${inputBasename}.json`);
fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
console.log(`Wrote: ${sidecarPath}`);
console.log("");
console.log(`Done in ${sidecar.elapsed_ms}ms`);
