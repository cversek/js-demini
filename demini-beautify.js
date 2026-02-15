#!/usr/bin/env node
/**
 * demini-beautify - Stage 00 of the demini pipeline
 *
 * Part of the demini toolset for JavaScript bundle reverse engineering.
 *
 * Beautifies minified JavaScript using prettier, preserving shebangs
 * and behavioral equivalence. This is the first step: make code
 * human-readable before annotation and splitting.
 *
 * Usage:
 *   node demini-beautify.js <input.js> [output-dir]
 *
 * Arguments:
 *   input.js    - JavaScript file to beautify (required)
 *   output-dir  - Directory for output file (default: same dir as input)
 *
 * Output:
 *   00_DEMINI_beautified-{input_basename}.js
 *
 * For already-beautified inputs, the output will be functionally identical
 * (prettier is idempotent).
 */

import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';

// --- Argument Parsing ---

const inputPath = process.argv[2];
if (!inputPath) {
    console.error('demini-beautify: Stage 00 — prettier-based JavaScript beautification');
    console.error('');
    console.error('Usage: node demini-beautify.js <input.js> [output-dir]');
    console.error('');
    console.error('Arguments:');
    console.error('  input.js    JavaScript file to beautify (required)');
    console.error('  output-dir  Directory for output file (default: same dir as input)');
    process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
    console.error(`demini-beautify: file not found: ${resolvedInput}`);
    process.exit(1);
}

const outputDir = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.dirname(resolvedInput);

fs.mkdirSync(outputDir, { recursive: true });

const inputBasename = path.basename(resolvedInput);
const outputFilename = `00_DEMINI_beautified-${inputBasename}`;
const outputPath = path.join(outputDir, outputFilename);

console.log('=== demini-beautify (Stage 00) ===');
console.log(`Input:  ${resolvedInput}`);
console.log(`Output: ${outputPath}`);
console.log('');

// --- Main (async for prettier) ---

async function main() {
    // Read source
    let code = fs.readFileSync(resolvedInput, 'utf8');
    const originalSize = code.length;

    // Strip shebang if present (prettier chokes on shebangs)
    let shebang = '';
    if (code.startsWith('#!')) {
        const firstNewline = code.indexOf('\n');
        shebang = code.slice(0, firstNewline + 1);
        code = code.slice(firstNewline + 1);
        console.log(`Shebang: ${shebang.trim()} (preserved)`);
    }

    // Beautify with prettier
    console.log('Beautifying with prettier...');
    const startTime = Date.now();

    const formatted = await prettier.format(code, {
        parser: 'babel',
        printWidth: 100,
        tabWidth: 2,
        semi: true,
        singleQuote: false,
        trailingComma: 'all',
    });

    const elapsed = Date.now() - startTime;
    console.log(`Prettier time: ${elapsed}ms`);

    // Reassemble with shebang
    const output = shebang + formatted;

    // Write output
    fs.writeFileSync(outputPath, output);

    // Summary
    console.log('');
    console.log('=== Summary ===');
    console.log(`Original:    ${originalSize.toLocaleString()} bytes`);
    console.log(`Beautified:  ${output.length.toLocaleString()} bytes`);
    console.log(`Ratio:       ${(output.length / originalSize).toFixed(2)}x`);
    console.log(`Shebang:     ${shebang ? 'preserved' : 'none'}`);
    console.log('');
    console.log(`Wrote: ${outputPath}`);
    console.log('');
    console.log('✅ demini-beautify complete!');
    console.log(`\nVerify: node "${outputPath}" --version`);
}

main().catch(err => {
    console.error(`demini-beautify: ${err.message}`);
    process.exit(1);
});
