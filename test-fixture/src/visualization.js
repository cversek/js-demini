/**
 * Terminal Visualization — ASCII Dartboard and Histogram
 *
 * Uses chalk (3rd party) for colorized terminal output.
 * Tests: external npm dependency bundling via esbuild,
 * ESM import of node_modules package.
 *
 * Receives dart arrays from pi-monte-carlo.js — same data
 * flows through both calculation and visualization.
 */

import chalk from "chalk";

const BOARD_SIZE = 20;
const HISTOGRAM_WIDTH = 40;
const HISTOGRAM_BINS = 10;

/**
 * Render an ASCII quarter-circle dartboard from pre-thrown darts.
 * Green = inside circle, red = outside.
 * @param {Array<{ x: number, y: number, inside: boolean }>} darts
 */
export function renderDartboard(darts) {
  const grid = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(" ")
  );

  let inside = 0;
  let outside = 0;

  for (const dart of darts) {
    const col = Math.floor(dart.x * BOARD_SIZE);
    const row = Math.floor((1 - dart.y) * BOARD_SIZE); // flip y for display

    if (dart.inside) {
      inside++;
      if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
        grid[row][col] = chalk.green("●");
      }
    } else {
      outside++;
      if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
        grid[row][col] = chalk.red("○");
      }
    }
  }

  // Draw the quarter-circle boundary
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const x = col / BOARD_SIZE;
      const y = 1 - row / BOARD_SIZE;
      const dist = Math.sqrt(x * x + y * y);
      if (Math.abs(dist - 1.0) < 0.06 && grid[row][col] === " ") {
        grid[row][col] = chalk.blue("·");
      }
    }
  }

  console.log(chalk.bold("\n  Quarter-Circle Dartboard"));
  console.log("  " + "─".repeat(BOARD_SIZE * 2 + 2));
  for (const row of grid) {
    console.log("  │" + row.map((c) => c + " ").join("") + "│");
  }
  console.log("  " + "─".repeat(BOARD_SIZE * 2 + 2));
  console.log(
    `  ${chalk.green("●")} inside: ${inside}  ${chalk.red("○")} outside: ${outside}  π ≈ ${((4 * inside) / darts.length).toFixed(4)}`
  );
}

/**
 * Render a horizontal histogram of pi estimates from multiple trials.
 * @param {number[]} estimates - Array of pi estimates
 */
export function renderHistogram(estimates) {
  const min = Math.min(...estimates);
  const max = Math.max(...estimates);
  const range = max - min || 0.001;
  const bins = Array(HISTOGRAM_BINS).fill(0);

  for (const est of estimates) {
    const idx = Math.min(
      Math.floor(((est - min) / range) * HISTOGRAM_BINS),
      HISTOGRAM_BINS - 1
    );
    bins[idx]++;
  }

  const maxCount = Math.max(...bins);

  console.log(chalk.bold("\n  Distribution of Pi Estimates"));
  console.log();

  for (let i = 0; i < HISTOGRAM_BINS; i++) {
    const lo = (min + (range * i) / HISTOGRAM_BINS).toFixed(3);
    const barLength = Math.round((bins[i] / maxCount) * HISTOGRAM_WIDTH);
    const bar = "█".repeat(barLength);
    const piInBin =
      min + (range * i) / HISTOGRAM_BINS <= 3.14159 &&
      3.14159 <= min + (range * (i + 1)) / HISTOGRAM_BINS;
    const label = piInBin ? chalk.yellow(`${lo} π→`) : `${lo}   `;
    console.log(`  ${label} ${chalk.cyan(bar)} ${bins[i]}`);
  }
}

export { BOARD_SIZE, HISTOGRAM_WIDTH, HISTOGRAM_BINS };
