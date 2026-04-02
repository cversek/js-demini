# Version Chain Workflow

## Overview

A version chain links multiple versions of the same bundle through sequential BKG matching. Knowledge accumulates as each version is matched against its neighbor — names discovered in one version propagate forward and backward through the chain.

## Chain Architecture

```
v1.0 → v1.1 → v1.2 → v1.3
  ↓      ↓      ↓      ↓
BKG₁ → BKG₂ → BKG₃ → BKG₄
       match  match  match
```

Each arrow represents a `demini-bkg match` + `propagate` operation. The enriched BKG from v1.1 becomes the reference for matching v1.2, carrying forward accumulated names.

## Manifest Format

```json
{
  "versions": [
    { "version": "1.0.0", "bundle": "/path/to/v1.0/bundle.js" },
    { "version": "1.1.0", "bundle": "/path/to/v1.1/bundle.js" },
    { "version": "1.2.0", "bundle": "/path/to/v1.2/bundle.js" }
  ],
  "anchor": "1.0.0"
}
```

Versions should be ordered chronologically. The optional `anchor` identifies a version with known semantic names (e.g., from source map recovery or manual annotation).

## Pipeline Per Version

For each version, `demini-chain` runs:

1. `demini-beautify` — readable formatting
2. `demini-classify` — structural profiling
3. `demini-trace` — dependency graph + module boundaries
4. `demini-split` — individual module files
5. `demini-extract` — green BKG

Then for each adjacent pair:

6. `demini-bkg match` — find module correspondences
7. `demini-bkg propagate` — spread names to unmatched neighbors

## Resume Support

If a version already has a BKG (from a previous run), the pipeline stages are skipped. This enables incremental chain building — add new versions without reprocessing old ones.

## Merge Semantics

`demini-bkg merge` combines two BKGs using highest-confidence-wins:

- **Union of modules**: modules present in either BKG appear in the result
- **Conflict resolution**: when both BKGs name the same module differently, the higher-confidence name wins
- **String union**: string inventories are merged (capped at 50 per module)
- **Source file**: taken from whichever BKG has it

Conflicts are logged in the enrichments array for audit.

## Diff Format

`demini-bkg diff` compares two BKGs by module ID:

- **Added**: modules in BKG2 not in BKG1
- **Removed**: modules in BKG1 not in BKG2
- **Shared**: modules in both (with modification detection)
- **Modifications**: name changes, dependency changes, size changes (>10%)
- **Coverage delta**: named module count change

Note: green BKGs use minified names as IDs, so module "turnover" between versions appears high. After matching and enrichment, IDs stabilize to semantic names, making diffs more meaningful.

## Empirical Results

### 3-Version Chain Test

| Link | Modules | Matched | Rate | Time |
|------|---------|---------|------|------|
| v1 → v2 | 4554 | 3934 | 86.4% | ~5s |
| v2 → v3 | 4409 | 3789 | 85.9% | ~5s |

Total chain time: 148s (including full pipeline on 3 versions).

### Key Observations

- Match rate stays consistent across chain links (~85%)
- Close versions match better than distant ones (string stability)
- Propagation adds 10-25% more named modules per link
- Resume support makes adding versions incremental
