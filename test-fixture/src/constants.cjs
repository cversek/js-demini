/**
 * Named Constants — Ground Truth for Constant Extraction (CJS)
 *
 * CommonJS version: uses require/module.exports pattern.
 * esbuild wraps this with __commonJS (minified to R()) when bundling to ESM.
 */

const ms = require("ms");

const MAX_ITERATIONS = 1_000_000;
const DEFAULT_TRIALS = 10;
const PI_DIGITS = 14;
const GREETING = "Hello from demini test fixture";
const VERSION = "1.0.0";
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

// Physical / mathematical constants
const SPEED_OF_LIGHT = 299_792_458; // m/s
const GOLDEN_RATIO = 1.6180339887;
const EULER_NUMBER = 2.7182818284;

// CJS dependency: ms converts time strings to milliseconds
const DEFAULT_TIMEOUT = ms("5s"); // 5000

// Enum-like object — tests object literal preservation
const LogLevel = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
});

// Configuration-like constant — tests nested object
const DEFAULT_CONFIG = Object.freeze({
  verbose: false,
  precision: PI_DIGITS,
  maxRetries: 3,
  greeting: GREETING,
  timeout: DEFAULT_TIMEOUT,
});

module.exports = {
  MAX_ITERATIONS,
  DEFAULT_TRIALS,
  PI_DIGITS,
  GREETING,
  VERSION,
  EXIT_SUCCESS,
  EXIT_FAILURE,
  SPEED_OF_LIGHT,
  GOLDEN_RATIO,
  EULER_NUMBER,
  DEFAULT_TIMEOUT,
  LogLevel,
  DEFAULT_CONFIG,
};
