/**
 * Named Constants — Ground Truth for Constant Extraction
 *
 * Every value here is meaningful and recoverable. After minification,
 * these become anonymous literals. A successful constant extraction
 * stage should identify their roles from context and usage patterns.
 */

export const MAX_ITERATIONS = 1_000_000;
export const DEFAULT_TRIALS = 10;
export const PI_DIGITS = 14;
export const GREETING = "Hello from demini test fixture";
export const VERSION = "1.0.0";
export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

// Physical / mathematical constants
export const SPEED_OF_LIGHT = 299_792_458; // m/s
export const GOLDEN_RATIO = 1.6180339887;
export const EULER_NUMBER = 2.7182818284;

// Enum-like object — tests object literal preservation
export const LogLevel = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
});

// Configuration-like constant — tests nested object
export const DEFAULT_CONFIG = Object.freeze({
  verbose: false,
  precision: PI_DIGITS,
  maxRetries: 3,
  greeting: GREETING,
});
