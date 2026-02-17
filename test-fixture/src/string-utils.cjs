/**
 * String Utilities — Template Literals, Regex, Tagged Templates (CJS)
 *
 * CommonJS version: uses require/module.exports pattern.
 * esbuild wraps this with __commonJS (minified to R()) when bundling to ESM.
 */

const WORD_SEPARATOR = /[\s,;:!?.]+/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Tagged template that highlights interpolated values with brackets.
 */
function highlight(strings, ...values) {
  return strings.reduce((result, str, i) => {
    const val = i < values.length ? `[${values[i]}]` : "";
    return result + str + val;
  }, "");
}

/**
 * Convert a string to title case.
 * @param {string} input
 * @returns {string}
 */
function titleCase(input) {
  return input
    .split(WORD_SEPARATOR)
    .filter((w) => w.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Count word frequencies in a string.
 * @param {string} text
 * @returns {Map<string, number>}
 */
function wordFrequency(text) {
  const words = text.toLowerCase().split(WORD_SEPARATOR).filter(Boolean);
  const freq = new Map();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
}

/**
 * Validate an email address.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return EMAIL_PATTERN.test(email);
}

/**
 * Format a result summary using template literals.
 */
function formatSummary(name, value, unit) {
  return highlight`Result: ${name} = ${value} ${unit}`;
}

module.exports = {
  highlight,
  titleCase,
  wordFrequency,
  isValidEmail,
  formatSummary,
  WORD_SEPARATOR,
  EMAIL_PATTERN,
};
