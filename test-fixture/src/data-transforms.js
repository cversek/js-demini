/**
 * Data Transforms — Array Methods, Destructuring, Spread, Modern Syntax
 *
 * Tests: map/filter/reduce, destructuring, spread operator,
 * optional chaining (?.), nullish coalescing (??), computed properties.
 */

/**
 * Transform an array of {name, score} objects into a ranked leaderboard.
 * @param {Array<{ name: string, score: number }>} entries
 * @returns {Array<{ rank: number, name: string, score: number }>}
 */
export function leaderboard(entries) {
  return [...entries]
    .sort((a, b) => b.score - a.score)
    .map(({ name, score }, idx) => ({ rank: idx + 1, name, score }));
}

/**
 * Group array items by a key function.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {Record<string, T[]>}
 */
export function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    return { ...groups, [key]: [...(groups[key] ?? []), item] };
  }, {});
}

/**
 * Safely extract nested values with optional chaining.
 * @param {object} obj
 * @param {string} fallback
 * @returns {string}
 */
export function safeExtract(obj, fallback = "unknown") {
  return obj?.data?.nested?.value ?? fallback;
}

/**
 * Merge multiple config objects with spread — later values win.
 * @param  {...object} configs
 * @returns {object}
 */
export function mergeConfigs(...configs) {
  return configs.reduce((merged, cfg) => ({ ...merged, ...cfg }), {});
}

/**
 * Compute statistics from an array of numbers.
 * Tests: destructuring in parameters, reduce with object accumulator.
 * @param {number[]} numbers
 * @returns {{ min: number, max: number, mean: number, sum: number, count: number }}
 */
export function computeStats(numbers) {
  if (numbers.length === 0) {
    return { min: 0, max: 0, mean: 0, sum: 0, count: 0 };
  }

  const { min, max, sum } = numbers.reduce(
    (acc, n) => ({
      min: Math.min(acc.min, n),
      max: Math.max(acc.max, n),
      sum: acc.sum + n,
    }),
    { min: Infinity, max: -Infinity, sum: 0 }
  );

  return { min, max, mean: sum / numbers.length, sum, count: numbers.length };
}

/**
 * Create an object with computed property names.
 * Tests: [expression]: value syntax.
 * @param {string} prefix
 * @param {string[]} keys
 * @returns {object}
 */
export function computedProperties(prefix, keys) {
  return Object.fromEntries(
    keys.map((key, i) => [`${prefix}_${key}`, i + 1])
  );
}
