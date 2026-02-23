import { spin, parseCliArgs, colorize } from "./require-bridge.cjs";
import minimist from "minimist";
import { basename } from "node:path";

export function parseFlags(argv) {
  return minimist(argv.slice(2));
}

export function showSpinner(msg) {
  return spin(msg);
}

export function printHeader(name, version) {
  console.log(colorize(`${name} v${version}`, "bold"));
}

export function scriptName() {
  return basename(process.argv[1] || "cli");
}
