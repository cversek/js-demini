#!/usr/bin/env node
/**
 * validate-soft-targets.js
 *
 * Validates demini pipeline output against sourcemap ground truth for all soft targets.
 * Reads build.json configs, parses sourcemaps for module counts, compares with trace output.
 *
 * Usage:
 *   node validate-soft-targets.js                    # All targets
 *   node validate-soft-targets.js --target express   # Single target
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOFT_TARGETS_DIR = join(__dirname, 'soft-targets');

// Parse CLI args
const args = process.argv.slice(2);
const singleTarget = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;

function getSourcemapModuleCount(mapPath) {
  try {
    const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
    if (!map.sources) return { count: 0, sources: [] };
    return { count: map.sources.length, sources: map.sources };
  } catch (e) {
    return { count: -1, sources: [], error: e.message };
  }
}

function getLatestDeminiDir(distPath) {
  if (!existsSync(distPath)) return null;
  const deminiDirs = readdirSync(distPath)
    .filter(d => d.startsWith('DEMINI_'))
    .sort()
    .reverse();
  return deminiDirs.length > 0 ? join(distPath, deminiDirs[0]) : null;
}

function getTraceModuleCount(deminiDir) {
  if (!deminiDir) return { count: -1, error: 'No DEMINI_* directory' };

  // Find trace JSON in the latest DEMINI dir (may be nested in subdirs)
  const traceFiles = findFiles(deminiDir, /02_trace-.*\.json$/);
  if (traceFiles.length === 0) {
    // No trace output — check if classify ran at least
    const classifyFiles = findFiles(deminiDir, /01_stats-.*\.json$/);
    if (classifyFiles.length > 0) {
      return { count: -1, error: 'Classify ran but no trace output' };
    }
    // Check for classify output in parent DEMINI dirs (pipeline chains)
    return { count: -1, error: 'No pipeline output found' };
  }

  try {
    const trace = JSON.parse(readFileSync(traceFiles[0], 'utf-8'));

    // Actual trace JSON structure: { total_modules, modules[], wrapkind_modules{} }
    if (typeof trace.total_modules === 'number') {
      const wk = trace.wrapkind_modules || {};
      return {
        count: trace.total_modules,
        cjs: wk.CJS || 0,
        esm: wk.ESM || 0,
        none: wk.None || 0,
        runtime: wk.RUNTIME || 0,
        import: wk.IMPORT || 0,
      };
    }
    if (trace.modules && Array.isArray(trace.modules)) {
      return { count: trace.modules.length };
    }
    return { count: -1, error: 'Unexpected trace JSON structure' };
  } catch (e) {
    return { count: -1, error: e.message };
  }
}

function findFiles(dir, pattern) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, pattern));
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return results;
}

function validateTarget(targetName) {
  const targetDir = join(SOFT_TARGETS_DIR, targetName);
  const buildJsonPath = join(targetDir, 'build.json');

  if (!existsSync(buildJsonPath)) {
    return { name: targetName, status: 'SKIP', reason: 'No build.json' };
  }

  const config = JSON.parse(readFileSync(buildJsonPath, 'utf-8'));
  const outfile = config.outfile || 'dist/bundle.js';
  const bundlePath = join(targetDir, outfile);
  const mapPath = bundlePath + '.map';
  const distPath = join(targetDir, 'dist');
  const knownLimitation = config.known_limitation || null;

  // Check bundle exists
  if (!existsSync(bundlePath)) {
    return { name: targetName, status: 'NO_BUNDLE', reason: `${outfile} not found` };
  }

  // Sourcemap ground truth
  const sm = getSourcemapModuleCount(mapPath);
  if (sm.count < 0) {
    return { name: targetName, status: 'NO_MAP', reason: sm.error };
  }

  // Find latest pipeline output
  const latestDemini = getLatestDeminiDir(distPath);
  const trace = getTraceModuleCount(latestDemini);

  if (trace.count < 0) {
    return {
      name: targetName,
      status: 'NO_TRACE',
      sourcemap_modules: sm.count,
      reason: trace.error,
    };
  }

  // Compare: exclude RUNTIME and IMPORT modules (esbuild-generated overhead)
  // Countable = CJS + ESM + None (correspond to actual source files)
  const overhead = (trace.runtime || 0) + (trace.import || 0);
  const countable = trace.count - overhead;
  const diff = countable - sm.count;
  let status;
  if (knownLimitation) {
    status = 'KNOWN_LIMITATION';
  } else if (diff === 0) {
    status = 'EXACT';
  } else if (Math.abs(diff) === 1) {
    status = 'OFF_BY_ONE';
  } else {
    status = 'MISMATCH';
  }

  return {
    name: targetName,
    status,
    sourcemap_modules: sm.count,
    trace_total: trace.count,
    trace_countable: countable,
    overhead,
    diff,
    cjs: trace.cjs,
    esm: trace.esm,
    none: trace.none,
    runtime: trace.runtime,
    import: trace.import,
    known_limitation: knownLimitation,
  };
}

// Main
function main() {
  let targets;
  if (singleTarget) {
    targets = [singleTarget];
  } else {
    targets = readdirSync(SOFT_TARGETS_DIR)
      .filter(d => {
        const p = join(SOFT_TARGETS_DIR, d);
        return statSync(p).isDirectory() && existsSync(join(p, 'build.json'));
      })
      .sort();
  }

  console.log(`\n=== Soft-Target Validation Report ===`);
  console.log(`Targets: ${targets.length}\n`);

  const results = targets.map(validateTarget);

  // Summary table
  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);

  console.log(
    pad('Target', 22) +
    pad('Status', 18) +
    rpad('SrcMap', 7) +
    rpad('Count', 7) +
    rpad('Diff', 6) +
    rpad('Total', 7) +
    rpad('RT+IM', 6) +
    '  Notes'
  );
  console.log('-'.repeat(95));

  const counts = { EXACT: 0, OFF_BY_ONE: 0, MISMATCH: 0, KNOWN_LIMITATION: 0, other: 0 };

  for (const r of results) {
    const notes = r.reason || r.known_limitation || '';
    const smStr = r.sourcemap_modules != null ? String(r.sourcemap_modules) : '-';
    const trStr = r.trace_countable != null ? String(r.trace_countable) : (r.trace_total != null ? String(r.trace_total) : '-');
    const diffStr = r.diff != null ? (r.diff > 0 ? `+${r.diff}` : String(r.diff)) : '-';
    const totalStr = r.trace_total != null ? String(r.trace_total) : '-';
    const overheadStr = r.overhead != null ? String(r.overhead) : '-';

    const statusIcon = {
      EXACT: '\x1b[32mEXACT\x1b[0m',
      OFF_BY_ONE: '\x1b[33mOFF_BY_ONE\x1b[0m',
      MISMATCH: '\x1b[31mMISMATCH\x1b[0m',
      KNOWN_LIMITATION: '\x1b[36mKNOWN_LIM\x1b[0m',
    }[r.status] || r.status;

    console.log(
      pad(r.name, 22) +
      pad(statusIcon, 27) + // extra width for ANSI codes
      rpad(smStr, 7) +
      rpad(trStr, 7) +
      rpad(diffStr, 6) +
      rpad(totalStr, 7) +
      rpad(overheadStr, 6) +
      `  ${notes}`
    );

    if (counts[r.status] != null) counts[r.status]++;
    else counts.other++;
  }

  console.log('-'.repeat(90));
  console.log(
    `\nSummary: ${counts.EXACT} exact, ${counts.OFF_BY_ONE} off-by-one, ` +
    `${counts.MISMATCH} mismatch, ${counts.KNOWN_LIMITATION} known-limitation, ` +
    `${counts.other} other`
  );
  console.log(`Total targets: ${results.length}\n`);

  // Exit with error if any unexpected mismatches
  const failures = results.filter(r => r.status === 'MISMATCH');
  if (failures.length > 0) {
    console.log(`\x1b[31mFAILURES:\x1b[0m`);
    for (const f of failures) {
      console.log(`  ${f.name}: sourcemap=${f.sourcemap_modules} trace=${f.trace_modules} diff=${f.diff}`);
    }
    process.exit(1);
  }
}

main();
