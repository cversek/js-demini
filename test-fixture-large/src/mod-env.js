import { env } from "node:process";
import { resolve } from "node:path";
import dotenv from "dotenv";
import ini from "ini";
import { readFileSync, existsSync } from "node:fs";

dotenv.config({ path: ".env", override: false });

export function getEnv(key, fallback) {
  return env[key] || fallback;
}

export function loadIniConfig(filepath) {
  if (!existsSync(filepath)) return {};
  return ini.parse(readFileSync(filepath, "utf8"));
}

export function resolveEnvPath(key) {
  const val = env[key];
  return val ? resolve(val) : null;
}

export function requireEnv(key) {
  const val = env[key];
  if (!val) throw new Error(`Missing required env: ${key}`);
  return val;
}
