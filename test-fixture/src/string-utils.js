/**
 * String Utilities — Template Literals, Regex, Tagged Templates
 *
 * Tests: template literal preservation, regex patterns,
 * tagged template functions, string method chains.
 */

const WORD_SEPARATOR = /[\s,;:!?.]+/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Tagged template that highlights interpolated values with brackets.
 */
export function highlight(strings, ...values) {
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
export function titleCase(input) {
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
export function wordFrequency(text) {
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
export function isValidEmail(email) {
  return EMAIL_PATTERN.test(email);
}

/**
 * Format a result summary using template literals.
 */
export function formatSummary(name, value, unit) {
  return highlight`Result: ${name} = ${value} ${unit}`;
}

export { WORD_SEPARATOR, EMAIL_PATTERN };
