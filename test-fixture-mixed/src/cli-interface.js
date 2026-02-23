/**
 * CLI interface — mixes CJS (lodash, dotenv) with ESM (ora, meow, chalk).
 * Provides argument parsing, progress display, and environment configuration.
 */
import chalk from "chalk";                    // ESM → WrapNone (shared)
import ora from "ora";                        // ESM → WrapNone
import meow from "meow";                     // ESM → WrapNone
import _ from "lodash";                       // CJS → WrapCJS
import dotenv from "dotenv";                  // CJS → WrapCJS
import { fileURLToPath } from "node:url";                              // BMI: url
import { homedir, platform, cpus } from "node:os";                    // BMI: os
import { resolve as cliResolve, basename as cliBasename } from "node:path";  // BMI: path

export function parseArgs() {
  const cli = meow(`
    ${chalk.bold("mixed-wrapkind")} — dual WrapKind test bundle

    ${chalk.dim("Usage")}
      $ mixed-wrapkind [options] <command>

    ${chalk.dim("Commands")}
      run         Run the full pipeline
      config      Show resolved configuration
      version     Show version info
      health      Check system health

    ${chalk.dim("Options")}
      --verbose   Enable verbose output
      --format    Output format (json|text)
      --output    Output directory
      --dry-run   Show what would happen without executing

    ${chalk.dim("Examples")}
      $ mixed-wrapkind run --verbose
      $ mixed-wrapkind config --format json
  `, {
    importMeta: import.meta,
    flags: {
      verbose: { type: "boolean", shortFlag: "v", default: false },
      format: { type: "string", shortFlag: "f", default: "text" },
      output: { type: "string", shortFlag: "o", default: "./output" },
      dryRun: { type: "boolean", default: false },
    },
  });

  const command = cli.input[0] || "run";
  console.log(chalk.dim(`[cli] Command: ${command}, flags: ${JSON.stringify(cli.flags)}`));
  return { command, flags: cli.flags, cli };
}

export async function withSpinner(label, fn) {
  const spinner = ora({ text: label, color: "cyan" }).start();
  try {
    const result = await fn((text) => { spinner.text = text; });
    spinner.succeed(chalk.green(label));
    return result;
  } catch (err) {
    spinner.fail(chalk.red(`${label}: ${err.message}`));
    throw err;
  }
}

export function loadEnvironment(envFile = ".env") {
  const result = dotenv.config({ path: envFile });
  if (result.error) {
    console.log(chalk.yellow(`[cli] No ${envFile} found — using process env`));
    return {};
  }
  const keys = Object.keys(result.parsed || {});
  console.log(chalk.dim(`[cli] Loaded ${keys.length} env vars from ${envFile}`));
  return result.parsed;
}

export function formatOutput(data, format = "text") {
  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  // Lodash for deep object traversal in text mode
  const lines = [];
  _.forOwn(data, (value, key) => {
    if (_.isPlainObject(value)) {
      lines.push(chalk.bold(`${key}:`));
      _.forOwn(value, (v, k) => {
        lines.push(`  ${chalk.dim(k)}: ${formatValue(v)}`);
      });
    } else if (_.isArray(value)) {
      lines.push(chalk.bold(`${key}: [${value.length} items]`));
      _.take(value, 5).forEach((item, i) => {
        lines.push(`  ${chalk.dim(`[${i}]`)} ${formatValue(item)}`);
      });
      if (value.length > 5) {
        lines.push(chalk.dim(`  ... and ${value.length - 5} more`));
      }
    } else {
      lines.push(`${chalk.bold(key)}: ${formatValue(value)}`);
    }
  });
  return lines.join("\n");
}

function formatValue(v) {
  if (_.isString(v)) return chalk.green(`"${_.truncate(v, { length: 60 })}"`);
  if (_.isNumber(v)) return chalk.cyan(String(v));
  if (_.isBoolean(v)) return chalk.yellow(String(v));
  if (_.isNull(v) || _.isUndefined(v)) return chalk.dim("null");
  return String(v);
}

export function summarizeArgs(flags) {
  const active = _.pickBy(flags, (v, k) => {
    if (_.isBoolean(v)) return v;
    if (_.isString(v)) return v !== "";
    return v != null;
  });
  return _.mapValues(active, (v) => (_.isString(v) ? _.truncate(v, { length: 40 }) : v));
}

// --- BMI exercising functions (url, os, path) ---

export function getSystemContext() {
  const home = homedir();
  const plat = platform();
  const cores = cpus().length;
  return { home, platform: plat, cores, scriptPath: cliResolve(cliBasename(import.meta.url)) };
}

export function resolveImportPath(metaUrl) {
  return fileURLToPath(metaUrl);
}
