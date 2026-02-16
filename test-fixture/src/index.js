/**
 * demini Test Fixture — Entry Point
 *
 * Exercises all modules, producing deterministic-structure output
 * (with stochastic values from Monte Carlo). This output serves as
 * the behavioral equivalence check: source and bundle must match.
 */

import { throwDarts, estimatePi, multiTrialEstimate, PI_REFERENCE } from "./pi-monte-carlo.js";
import { renderDartboard, renderHistogram } from "./visualization.js";
import { titleCase, wordFrequency, formatSummary, isValidEmail } from "./string-utils.js";
import { simulateFetch, fetchAll, fibonacci } from "./async-patterns.js";
import { Circle, Rectangle, createShapeReport, Shape } from "./class-hierarchy.js";
import { leaderboard, groupBy, safeExtract, computeStats, mergeConfigs } from "./data-transforms.js";
import { GREETING, VERSION, LogLevel, DEFAULT_CONFIG, GOLDEN_RATIO } from "./constants.js";

async function main() {
  console.log(`${GREETING} v${VERSION}\n`);

  // --- Monte Carlo Pi ---
  console.log("=== Monte Carlo Pi Estimation ===");
  const darts = throwDarts(500);
  const piResult = estimatePi(darts);
  console.log(`  Single trial (${piResult.total} darts): π ≈ ${piResult.estimate.toFixed(6)} (error: ${piResult.error.toFixed(6)})`);

  // Visualize the same darts used for calculation
  renderDartboard(darts);

  // Multi-trial with histogram
  const trials = multiTrialEstimate(20, 10_000);
  console.log(`\n  Multi-trial (${trials.trials} x 10k): mean π ≈ ${trials.mean.toFixed(6)} (σ = ${trials.stddev.toFixed(6)})`);
  renderHistogram(trials.estimates);

  // --- String Utils ---
  console.log("\n=== String Utilities ===");
  const title = titleCase("the quick brown fox jumps over the lazy dog");
  console.log(`  Title case: "${title}"`);

  const freq = wordFrequency("to be or not to be that is the question");
  console.log(`  Word frequencies: ${JSON.stringify(Object.fromEntries(freq))}`);

  console.log(`  Email valid: ${isValidEmail("user@example.com")}`);
  console.log(`  Email invalid: ${isValidEmail("not-an-email")}`);
  console.log(`  ${formatSummary("pi", piResult.estimate.toFixed(4), "radians")}`);

  // --- Async Patterns ---
  console.log("\n=== Async Patterns ===");
  const response = await simulateFetch("https://api.example.com/data");
  console.log(`  Fetch: ${response.data} (status ${response.status})`);

  const allData = await fetchAll(["https://a.test", "https://b.test"]);
  console.log(`  Parallel fetch: ${allData.length} responses`);

  const fibs = [...fibonacci(10)];
  console.log(`  Fibonacci(10): [${fibs.join(", ")}]`);

  // --- Class Hierarchy ---
  console.log("\n=== Class Hierarchy ===");
  const circle = new Circle(5, "blue");
  const rect = new Rectangle(4, 6, "red");
  const square = new Rectangle(3, 3, "green");

  console.log(`  ${circle.describe()}`);
  console.log(`  ${rect.describe()} (square: ${rect.isSquare()})`);
  console.log(`  ${square.describe()} (square: ${square.isSquare()})`);
  console.log(`  Shape.isShape(circle): ${Shape.isShape(circle)}`);

  const report = createShapeReport([circle, rect, square]);
  console.log(`  Report: ${report.count} shapes, total area ${report.totalArea.toFixed(4)}`);

  // --- Data Transforms ---
  console.log("\n=== Data Transforms ===");
  const scores = [
    { name: "Alice", score: 95 },
    { name: "Bob", score: 87 },
    { name: "Charlie", score: 92 },
    { name: "Diana", score: 98 },
  ];
  const ranked = leaderboard(scores);
  console.log(`  Leaderboard: ${ranked.map((r) => `#${r.rank} ${r.name}`).join(", ")}`);

  const grouped = groupBy(scores, (s) => (s.score >= 90 ? "A" : "B"));
  console.log(`  Groups: A=${grouped.A?.length ?? 0}, B=${grouped.B?.length ?? 0}`);

  const deep = { data: { nested: { value: "found it" } } };
  console.log(`  Safe extract: "${safeExtract(deep)}", missing: "${safeExtract({})}"`);

  const stats = computeStats([1, 2, 3, 4, 5]);
  console.log(`  Stats: mean=${stats.mean}, min=${stats.min}, max=${stats.max}`);

  const config = mergeConfigs(DEFAULT_CONFIG, { verbose: true });
  console.log(`  Merged config verbose: ${config.verbose}, precision: ${config.precision}`);

  // --- Constants ---
  console.log("\n=== Constants ===");
  console.log(`  LogLevel.WARN = ${LogLevel.WARN}`);
  console.log(`  Golden ratio: ${GOLDEN_RATIO}`);
  console.log(`  Pi reference: ${PI_REFERENCE}`);

  console.log("\nDone.");
}

main().catch(console.error);
