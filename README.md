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
02_traced-bundle.js             dependency graph + boundary comments
  |  demini-split
03_split-bundle/                individual module files
  |  demini-extract
04_bkg-bundle.json              green Bundle Knowledge Graph
  |  demini-bkg match           (+ a second bundle's BKG)
04_bkg-bundle.matched.json      enriched BKG with cross-version matches
  |  demini-bkg apply
05_applied-bundle/              modules annotated with BKG knowledge
```

Stages 00-03 produce files you can `node` directly. Nothing breaks along the way. Stages 04+ operate on the BKG (JSON knowledge graph) rather than source code.

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

### `demini-trace`

Walks the AST to build a bidirectional dependency graph, identifies module boundaries using progressive wrapper elimination (CJS/ESM/IIFE detection), and inserts boundary comments into the source. Produces a trace JSON with per-module metadata and an HTML bundle visualization.

```
node demini-trace.js <input.js> [output-dir]
```

Output includes:
- `02_traced-*.js` — source with boundary comments
- `02_trace-*.json` — dependency graph + module boundaries
- `02_bundle-map-*.html` — visual module map

### `demini-split`

Reads a traced bundle + its trace JSON, splits the monolithic bundle into individual module files using AST-precise character ranges. Each extracted module is verified to parse independently with acorn.

```
node demini-split.js <input.js> [output-dir]
```

Output:
- `03_split-*/mod_NNNN_name.js` — per-module files
- `03_split-*/manifest.json` — module index with metadata
- `03_stats-*.json` — split statistics and coverage

Module naming uses the first defined variable name (e.g., `mod_0001_J.js` for `var J = __commonJS(...)`). RUNTIME helpers and TOPLEVEL code get descriptive names. The manifest maps every module ID to its file, wrapKind, dependencies, line range, and byte size.

Tested on bundles with 4600+ modules — 100% parse success rate, 95%+ source coverage, under 4 seconds.

### `demini-extract`

Synthesizes all pipeline artifacts into a green Bundle Knowledge Graph (BKG) — a property graph of modules, identifiers, dependencies, string inventories, and AST fingerprints. No reference source needed.

```
node demini-extract.js <input.js> [output-dir]
```

Output:
- `04_bkg-*.json` — Green BKG with structural intelligence

The BKG is the universal intermediate representation for the demini pipeline. Every enrichment technique (cross-version matching, source maps, LLM inference, manual annotation) operates on and produces BKGs. Two BKGs can be merged. See `docs/bkg-format.md` for the full specification.

Green BKG contents per module: dependency graph (navigable via string IDs), string inventory (up to 50 unique literals), AST structural fingerprint, byte size, line range, and wrapKind.

Tested on 4600+ module bundles — 84K strings extracted, 99.96% AST fingerprint success, under 5 seconds.

### `demini-bkg`

BKG operations toolkit with multiple subcommands:

```
node demini-bkg.js match <target.bkg> <ref.bkg>     — cross-version module matching
node demini-bkg.js propagate <bkg>                    — spread names via dependency graph
node demini-bkg.js apply <bkg> <split-dir>            — annotate modules with BKG knowledge
node demini-bkg.js merge <bkg1> <bkg2>                — combine BKGs (highest confidence wins)
node demini-bkg.js diff <bkg1> <bkg2>                 — compare BKG versions (literal id)
node demini-bkg.js evolve <m1.bkg> ... <mN.bkg>       — cross-pair evolution report (filters matcher noise)
node demini-bkg.js stats <bkg>                        — coverage report
```

**match** uses three cascading techniques: string literal seed matching (Jaccard similarity), dependency graph propagation, and AST fingerprint matching. Tested at 85-91% match rate on 280-4600 module bundles.

**propagate** spreads semantic names from matched modules to their unmatched neighbors. Typically adds 10-25% more named modules.

**apply** injects BKG metadata as header comments into split module files — match status, confidence, dependencies, key strings.

**evolve** consumes a sequence of matched BKGs (typically `match` outputs between adjacent version pairs) and reports per-pair real-new modules. Naive per-pair unmatched sets mix true new features with matcher noise — stable modules whose minified names shifted enough to evade fingerprinting. evolve content-hashes each unmatched module and filters out hashes that recur in `--noise-threshold` of N pairs (default: 5/6). Output is both a human-readable summary and an optional JSON report via `-o`.

See `docs/matching-techniques.md` for algorithm details.

### `demini-chain`

Version chain orchestrator. Runs the full pipeline across multiple bundle versions, chain-matching adjacent versions to accumulate knowledge.

```
node demini-chain.js <manifest.json> [-o output-dir]
```

Manifest specifies version/bundle pairs. The tool pipelines each version, then matches v1→v2→v3 sequentially. Resume support skips versions with existing BKGs.

See `docs/bkg-format.md` and `docs/version-chain.md` for format and workflow details.

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
