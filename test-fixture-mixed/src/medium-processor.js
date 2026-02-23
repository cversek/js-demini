/**
 * Medium-sized processor — uses fs and path, moderate external references.
 * ~30 lines of real logic with 2 builtin imports.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync as _readdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";

export function processDirectory(inputDir, outputDir) {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const manifest = { files: [], totalSize: 0, timestamp: Date.now() };

  const entries = readdirSync(inputDir);
  for (const entry of entries) {
    const fullPath = join(inputDir, entry);
    const ext = extname(entry);
    if (ext === ".json") {
      const content = readFileSync(fullPath, "utf8");
      const parsed = JSON.parse(content);
      const outName = basename(entry, ext) + ".processed.json";
      const outPath = join(outputDir, outName);
      const transformed = transformData(parsed);
      writeFileSync(outPath, JSON.stringify(transformed, null, 2));
      manifest.files.push({ name: outName, size: content.length });
      manifest.totalSize += content.length;
    }
  }

  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

function readdirSync(dir) {
  return _readdirSync(dir);
}

function transformData(data) {
  if (Array.isArray(data)) {
    return data.map((item, i) => ({ ...item, _index: i, _processed: true }));
  }
  return { ...data, _processed: true, _timestamp: Date.now() };
}

export function summarize(manifest) {
  return `Processed ${manifest.files.length} files, ${manifest.totalSize} bytes`;
}
