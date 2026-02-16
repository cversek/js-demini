/**
 * Monte Carlo Pi Estimation — The Dartboard Method
 *
 * Imagine a unit square [0,1] x [0,1] containing a quarter-circle of radius 1.
 * Throw darts uniformly at random. The ratio of darts landing inside the
 * quarter-circle to total darts approximates π/4. Multiply by 4 to get π.
 *
 * Each dart is independent. No single dart "knows" π.
 * The ensemble does. Truth emerges from aggregation.
 */

const TOTAL_DARTS = 100_000;
const PI_REFERENCE = 3.14159265358979;
const QUADRANT_RADIUS = 1.0;

/**
 * @typedef {{ x: number, y: number, inside: boolean }} Dart
 */

/**
 * Generate an array of random darts, each tagged with whether it
 * landed inside the quarter-circle.
 * @param {number} count - Number of darts to throw
 * @returns {Dart[]}
 */
export function throwDarts(count = TOTAL_DARTS) {
  const darts = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random();
    const y = Math.random();
    const inside =
      x * x + y * y <= QUADRANT_RADIUS * QUADRANT_RADIUS;
    darts.push({ x, y, inside });
  }
  return darts;
}

/**
 * Estimate π from a pre-thrown array of darts.
 * @param {Dart[]} darts
 * @returns {{ estimate: number, error: number, total: number, inside: number }}
 */
export function estimatePi(darts) {
  const inside = darts.filter((d) => d.inside).length;
  const estimate = (4 * inside) / darts.length;
  const error = Math.abs(estimate - PI_REFERENCE);
  return { estimate, error, total: darts.length, inside };
}

/**
 * Run multiple independent trials and return statistics.
 * @param {number} trials - Number of independent estimates
 * @param {number} dartsPerTrial - Darts per trial
 * @returns {{ mean: number, stddev: number, trials: number, estimates: number[] }}
 */
export function multiTrialEstimate(trials = 10, dartsPerTrial = TOTAL_DARTS) {
  const estimates = [];

  for (let t = 0; t < trials; t++) {
    const darts = throwDarts(dartsPerTrial);
    const { estimate } = estimatePi(darts);
    estimates.push(estimate);
  }

  const mean = estimates.reduce((sum, val) => sum + val, 0) / trials;
  const variance =
    estimates.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (trials - 1);
  const stddev = Math.sqrt(variance);

  return { mean, stddev, trials, estimates };
}

export { TOTAL_DARTS, PI_REFERENCE, QUADRANT_RADIUS };
