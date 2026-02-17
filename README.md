# demini

A pipeline for taking apart JavaScript bundles, one careful cut at a time.

## What it does

Modern JS tools (esbuild, webpack, rollup) pack hundreds of source files into a single monolithic bundle. `demini` reverses that process — not by guessing at the original structure, but through a series of verified, behavioral-equivalent transformations where every intermediate file still runs.

Each stage asks a deeper question about the code and keeps it working the whole time.

## The pipeline

```
bundle.js                       the raw bundle, minified
  |  demini-beautify
00_beautified-bundle.js         readable, same behavior
  |  demini-classify
01_classified-bundle.js         boundary markers + structural profile
  |  demini-trace
02_trace-bundle.json            inter-module dependency graph
  |  demini-split
03_split-bundle/                separate files, reassemblable
  |  demini-annotate
04_annotated-bundle/            per-module semantic annotations
  |  demini-rename
05_renamed-bundle/              obfuscated names -> semantic names
```

Every stage produces files you can `node` directly. Nothing breaks along the way.

## Current tools

### `demini-beautify`

Wraps prettier with shebang preservation. Stage 00 — make it readable first.

```
node demini-beautify.js <input.js> [output-dir]
```

### `demini-classify`

Parses the AST and inserts machine-readable boundary comments before every top-level statement. The output is simultaneously executable code and an analysis document. Detects bundler type (esbuild, webpack, etc.) and produces a structural profile.

```
node demini-classify.js <input.js> [output-dir]
```

Produces a stats JSON sidecar alongside the classified source — a full structural profile of what's in the bundle:

```
MODULE_FACTORY_R      2283 stmts (53.7% of bytes)   lazy module factories
FUNCTION_DECL         7360 stmts (28.7% of bytes)   standalone functions
MODULE_FACTORY_V      2317 stmts (10.9% of bytes)   one-shot initializers
CLASS_DECL             170 stmts  (3.6% of bytes)   class definitions
VAR_DECL              2406 stmts  (2.7% of bytes)   variable declarations
IMPORT                 596 stmts  (0.2% of bytes)   import statements
```

Classification comment format (parseable by regex for downstream tools):
```javascript
/* === [0042] TYPE: FUNCTION_DECL | NAME: hIq | LINES: 120-132 | BYTES: 216 === */
function hIq(A, q) {
  // ... original code, untouched
}
```

### Future stages

- **demini-trace** — map inter-module dependencies via factory variable cross-references
- **demini-split** — use classification boundaries to carve the bundle into separate module files
- **demini-annotate** — add per-module semantic annotations (function boundaries, exports, string catalogs)
- **demini-rename** — apply semantic name mappings (from analysis, heuristics, or LLM-assisted naming) to replace obfuscated identifiers

## Design principles

**Behavioral equivalence at every stage.** If `node bundle.js --version` works, then `node 01_classified-bundle.js --version` works too. Always.

**Classify before cutting.** Structural profiling precedes splitting. Understand the structure before you change it.

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
