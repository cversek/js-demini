/**
 * File processor — mixes CJS (fs-extra, semver, dotenv) with ESM (globby, chalk).
 * Provides file discovery, filtering, and versioned output management.
 */
import chalk from "chalk";                    // ESM → WrapNone (shared with config-loader)
import { globby } from "globby";             // ESM → WrapNone
import fs from "fs-extra";                   // CJS → WrapCJS
import semver from "semver";                 // CJS → WrapCJS
import dotenv from "dotenv";                 // CJS → WrapCJS
import { join, extname as nodeExtname, resolve as nodeResolve } from "node:path";  // BMI: path
import { statSync } from "node:fs";                                                // BMI: fs

// Load environment variables if .env exists
dotenv.config({ path: ".env", override: false });
const OUTPUT_BASE = process.env.GT_OUTPUT_DIR || "./output";

export async function discoverFiles(patterns, options = {}) {
  const defaults = { ignore: ["**/node_modules/**", "**/dist/**"], gitignore: true };
  const merged = { ...defaults, ...options };
  console.log(chalk.cyan(`[file-proc] Discovering files: ${patterns.join(", ")}`));
  const files = await globby(patterns, merged);
  console.log(chalk.dim(`[file-proc] Found ${files.length} files`));
  return files;
}

export async function filterByExtension(files, extensions) {
  const extSet = new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)));
  const filtered = files.filter((f) => {
    const ext = f.slice(f.lastIndexOf("."));
    return extSet.has(ext);
  });
  console.log(chalk.dim(`[file-proc] Filtered ${files.length} → ${filtered.length} (ext: ${extensions.join(",")})`));
  return filtered;
}

export async function readAndParse(filepath) {
  const ext = filepath.slice(filepath.lastIndexOf("."));
  console.log(chalk.dim(`[file-proc] Reading ${filepath}`));
  if (ext === ".json") {
    return fs.readJson(filepath);
  }
  const content = await fs.readFile(filepath, "utf8");
  if (ext === ".env") {
    return dotenv.parse(content);
  }
  return { raw: content, lines: content.split("\n").length, bytes: Buffer.byteLength(content) };
}

export function createVersionedOutput(name, version) {
  const clean = semver.valid(semver.coerce(version));
  if (!clean) {
    console.log(chalk.red(`[file-proc] Invalid version: ${version}`));
    return null;
  }
  const dir = `${OUTPUT_BASE}/${name}-v${clean}`;
  console.log(chalk.green(`[file-proc] Output dir: ${dir}`));
  return {
    dir,
    version: clean,
    major: semver.major(clean),
    minor: semver.minor(clean),
    patch: semver.patch(clean),
    prerelease: semver.prerelease(clean),
  };
}

export async function writeResults(outputDir, results) {
  await fs.ensureDir(outputDir);
  const manifest = {
    generatedAt: new Date().toISOString(),
    fileCount: results.length,
    totalBytes: results.reduce((sum, r) => sum + (r.bytes || 0), 0),
  };
  await fs.writeJson(`${outputDir}/manifest.json`, manifest, { spaces: 2 });
  for (const result of results) {
    const outPath = `${outputDir}/${result.name || "unnamed"}.json`;
    await fs.writeJson(outPath, result, { spaces: 2 });
  }
  console.log(chalk.green(`[file-proc] Wrote ${results.length} results to ${outputDir}`));
  return manifest;
}

export function compareVersions(a, b) {
  const diff = semver.diff(a, b);
  const gt = semver.gt(a, b);
  console.log(chalk.dim(`[file-proc] ${a} vs ${b}: diff=${diff}, a>b=${gt}`));
  return { diff, gt, lt: semver.lt(a, b), eq: semver.eq(a, b) };
}

// --- BMI exercising functions (path, fs) ---

export function resolveFilePath(base, relative) {
  const full = nodeResolve(base, relative);
  const ext = nodeExtname(full);
  return { full, ext, joined: join(base, relative) };
}

export function getFileStats(filepath) {
  try {
    const stats = statSync(filepath);
    return { size: stats.size, isFile: stats.isFile(), mtime: stats.mtimeMs };
  } catch {
    return null;
  }
}
