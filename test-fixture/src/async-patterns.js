/**
 * Async Patterns — Promises, async/await, Generators
 *
 * Tests: async function transformation, Promise chains,
 * generator functions, try/catch in async context.
 */

const SIMULATED_DELAY_MS = 10;
const MAX_RETRIES = 3;

/**
 * Simulate an async fetch with configurable delay.
 * @param {string} url
 * @param {number} delayMs
 * @returns {Promise<{ url: string, status: number, data: string }>}
 */
export async function simulateFetch(url, delayMs = SIMULATED_DELAY_MS) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { url, status: 200, data: `Response from ${url}` };
}

/**
 * Fetch with retry logic — exponential backoff.
 * @param {string} url
 * @param {number} retries
 * @returns {Promise<string>}
 */
export async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await simulateFetch(url, SIMULATED_DELAY_MS * attempt);
      return result.data;
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Failed after ${retries} attempts: ${err.message}`);
      }
    }
  }
  throw new Error("Unreachable");
}

/**
 * Promise.all pattern — parallel async operations.
 * @param {string[]} urls
 * @returns {Promise<string[]>}
 */
export async function fetchAll(urls) {
  const results = await Promise.all(urls.map((u) => simulateFetch(u)));
  return results.map((r) => r.data);
}

/**
 * Generator that yields Fibonacci numbers.
 * Tests: function* syntax, yield, iterator protocol.
 * @param {number} limit
 */
export function* fibonacci(limit = 10) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < limit; i++) {
    yield a;
    [a, b] = [b, a + b];
  }
}

/**
 * Async generator — yields results with delays.
 * Tests: async function* syntax, for-await-of consumption.
 * @param {string[]} items
 */
export async function* delayedStream(items) {
  for (const item of items) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    yield { item, timestamp: Date.now() };
  }
}

export { SIMULATED_DELAY_MS, MAX_RETRIES };
