import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config({ path: ".env", override: false });

export function readSafe(filepath) {
  if (!existsSync(filepath)) return null;
  return readFileSync(filepath, "utf8");
}

export function writeSafe(filepath, content) {
  const dir = join(filepath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filepath, content);
}

export async function copyTree(src, dest) {
  await fs.copy(src, dest, { overwrite: true });
}

export function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(f => {
    const full = join(dir, f);
    const s = statSync(full);
    return { name: f, size: s.size, isDir: s.isDirectory() };
  });
}

export async function ensureDir(dir) {
  await fs.ensureDir(dir);
}
