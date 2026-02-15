# demini

A pipeline for taking apart JavaScript bundles, one careful cut at a time.

## What it does

Modern JS tools (esbuild, webpack, rollup) pack hundreds of source files into a single monolithic bundle. `demini` reverses that process — not by guessing at the original structure, but through a series of verified, behavioral-equivalent transformations where every intermediate file still runs.

Each stage marks the code up a little more, understands it a little better, and keeps it working the whole time.

## The pipeline

```
cli.js                          the raw bundle, minified
  ↓ demini-beautify
00_DEMINI_beautified-cli.js     readable, same behavior
  ↓ demini-annotate
01_DEMINI_annotated-cli.js      boundary markers, same behavior
  ↓ demini-split
02_DEMINI_split-cli/            separate files, reassemblable
  ↓ demini-constants
03_DEMINI_constants-cli/        magic numbers → named constants
  ↓ demini-rename
04_DEMINI_renamed-cli/          obfuscated names → semantic names
```

Every stage produces files you can `node` directly. Nothing breaks along the way.

## Current tools

### `demini-beautify`

Wraps prettier with shebang preservation. Stage 00 — make it readable first.

```
node demini-beautify.js <input.js> [output-dir]
```

### `demini-annotate`

Parses the AST and inserts machine-readable boundary comments before every top-level statement. The output is simultaneously executable code and an analysis document.

```
node demini-annotate.js <input.js> [output-dir]
```

Produces `DEMINI_stats.json` alongside the annotated source — a full classification of what's in the bundle:

```
MODULE_FACTORY_R      2283 stmts (53.7% of bytes)   lazy module factories
FUNCTION_DECL         7360 stmts (28.7% of bytes)   standalone functions
MODULE_FACTORY_V      2317 stmts (10.9% of bytes)   one-shot initializers
CLASS_DECL             170 stmts  (3.6% of bytes)   class definitions
VAR_DECL              2406 stmts  (2.7% of bytes)   variable declarations
IMPORT                 596 stmts  (0.2% of bytes)   import statements
```

Annotation format (parseable by regex for downstream tools):
```javascript
/* === [0042] TYPE: FUNCTION_DECL | NAME: hIq | LINES: 120-132 | BYTES: 216 === */
function hIq(A, q) {
  // ... original code, untouched
}
```

### Future stages

- **demini-split** — use annotation boundaries to carve the bundle into separate module files
- **demini-constants** — extract repeated magic numbers and long strings into named constants
- **demini-rename** — apply semantic name mappings (from manual analysis or heuristics) to replace obfuscated identifiers

## Design principles

**Behavioral equivalence at every stage.** If `node bundle.js --version` works, then `node 01_DEMINI_annotated-bundle.js --version` works too. Always.

**Mark the cuts before cutting.** Annotation precedes splitting. Understand the structure before you change it.

**Generic over specific.** Tools accept any JS file as input. They happen to understand esbuild's `R()` factory pattern, but they work on webpack, rollup, or hand-written bundles too.

**Stats, not just transforms.** Every stage emits a JSON sidecar with classification data. The transform is the deliverable; the stats are the insight.

## Install

```bash
git clone <repo-url>
cd js-demini
npm install
```

Requires Node.js 18+.

## License

MIT
