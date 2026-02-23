import { extname } from "node:path";
import { statSync } from "node:fs";
import { findFiles } from "./require-bridge.cjs";
import debug from "debug";

const log = debug("proxy:glob");

export async function scanFiles(patterns, opts = {}) {
  const files = await findFiles(patterns);
  log("found %d files", files.length);
  return files;
}

export async function scanByExt(dir, ext) {
  const files = await findFiles([`${dir}/**/*${ext}`]);
  return files.filter(f => extname(f) === ext);
}

export function getSize(filepath) {
  try { return statSync(filepath).size; } catch { return 0; }
}
