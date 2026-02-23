import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import crossSpawn from "cross-spawn";
import whichMod from "which";
import { exec, onExit } from "./require-bridge.cjs";

export function spawnProcess(cmd, args, opts = {}) {
  return crossSpawn(cmd, args, { stdio: "pipe", ...opts });
}

export async function findBinary(name) {
  const w = whichMod.sync || whichMod;
  try { return w(name); } catch { return null; }
}

export async function runCommand(cmd, args) {
  return exec(cmd, args);
}

export function isWindows() {
  return platform() === "win32";
}

export function shellCommand(script) {
  const shell = isWindows() ? "cmd" : "/bin/sh";
  const flag = isWindows() ? "/c" : "-c";
  return spawn(shell, [flag, script], { stdio: "inherit" });
}

export function registerCleanup(fn) {
  return onExit(fn);
}

export function resolveScript(dir, name) {
  return resolve(dir, "scripts", name);
}
