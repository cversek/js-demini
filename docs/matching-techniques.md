# Cross-Version Module Matching Techniques

## Overview

`demini-bkg match` identifies module correspondences between two Bundle Knowledge Graphs using a cascading pipeline of increasingly speculative techniques. Each technique builds on matches established by previous ones.

## Signal Hierarchy

**Identity > Structure > Position**

1. **String literals** (identity signal) — most reliable, least speculative
2. **Dependency graph** (structural signal) — propagates from known matches
3. **AST fingerprint** (structural signal) — shape-based similarity
4. **Source map alignment** (identity signal, requires reference) — most precise but needs artifacts

## Technique 1: String Seed Matching

**Signal**: Shared string literals between modules
**Coverage**: 50-60% on nearby versions, degrades with version distance
**Reliability**: High — string content is semantically meaningful

### Algorithm

1. For each target module with 2+ strings, build a string set
2. Compute Jaccard similarity against every reference module's string set
3. Accept if: `similarity >= 0.15` AND best match is `1.3x` better than second-best
4. Enforce 1:1 mapping — if two target modules want the same reference, best score wins

### Why It Works

String literals encode application semantics: error messages, API paths, config keys, log messages. These survive minification unchanged. Modules with highly overlapping string inventories are almost certainly the same logical unit across versions.

### Degradation

- **Near versions** (e.g., v2.1.42 ↔ v2.1.50): ~56% match rate — high string stability
- **Distant versions**: String content changes as features evolve — rate drops
- **Small modules**: Fewer strings → less discriminating signal → lower match rate

## Technique 2: Dependency Graph Propagation

**Signal**: Structural correspondence via matched neighbors
**Coverage**: 20-30% additional (cascading from seeds)
**Reliability**: Medium-high with uniqueness gate

### Algorithm

1. For each unmatched target module, examine its matched neighbors (deps_out, deps_in)
2. Through those matched neighbors, find candidate reference modules (the neighbor's other connections)
3. Score candidates by number of independent structural evidences
4. Accept if: `evidence >= 2` AND strictly more than second-best candidate
5. Optionally boost confidence with AST fingerprint similarity
6. Iterate until convergence (typically 5-10 rounds)

### Why It Works

If module A in the target matches module A' in the reference, and A depends on B, then B's match is likely among A's dependencies in the reference. With multiple matched neighbors pointing to the same candidate, confidence increases multiplicatively.

### The Uniqueness Gate

Prevents false positives from highly-connected modules. A candidate must have strictly more evidence than alternatives. This means hub modules (high fan-in) are harder to match via propagation alone — which is correct, since their structural position is ambiguous.

## Technique 3: AST Fingerprint Matching

**Signal**: Structural AST skeleton similarity
**Coverage**: 1-5% additional (for modules resistant to techniques 1-2)
**Reliability**: Medium — requires neighbor context to avoid false positives

### Algorithm

1. Only consider modules with at least one matched neighbor (prevents unanchored matches)
2. Only consider modules with 5+ AST tokens (avoids trivially short fingerprints)
3. Compute fingerprint similarity (set intersection weighted by length ratio)
4. Accept if: `similarity >= 0.7` AND `1.2x` better than second-best
5. Confidence capped at `0.8 * similarity` (lower than string/graph matches)

### Why It Works

Two implementations of the same logical unit tend to use similar control flow structures (if/for/try/return patterns) even when variable names and string literals change. The fingerprint captures this structural skeleton.

### Limitations

- Short modules produce generic fingerprints (e.g., just "AF:RET")
- Refactored modules may change structure while preserving semantics
- Requires neighborhood anchoring to prevent false positives

## Technique 4: Source Map DFS Alignment (Future)

**Signal**: Source file → bundle location mappings via VLQ-decoded source maps
**Coverage**: +25-30% additional (jumps total to ~88%)
**Reliability**: Very high — directly maps source structure

### Concept

When a source map is available for the reference bundle, VLQ-decode the mappings to establish source file → module correspondences. Then align target modules to reference modules via their shared source file origin.

### Status

Not yet implemented. Will be added as an optional `--sourcemap` flag.

## Combined Results (Empirical)

### Large esbuild bundle (two nearby versions, no source map)

| Technique | Matches | Cumulative | Coverage |
|-----------|---------|------------|----------|
| String seeds | 2594 | 2594 | 56.3% |
| Graph propagation | 1286 | 3880 | 84.2% |
| AST fingerprint | 62 | 3936 | 85.4% |

Total: 85.4% in 5 seconds — exceeds the 61% prediction from the roadmap.

## Tuning Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `JACCARD_THRESHOLD` | 0.15 | Minimum string similarity to consider |
| `UNIQUENESS_RATIO` | 1.3 | Best must be Nx better than 2nd best |
| `FP_THRESHOLD` | 0.7 | Minimum fingerprint similarity |
| Graph min evidence | 2 | Minimum structural evidences for propagation |
| Graph iterations | 20 max | Convergence limit for propagation |

## Design Decisions

**1:1 mapping enforcement**: Each target module matches at most one reference module and vice versa. This prevents many-to-one degeneracy that would reduce the information content of matches.

**Cascading architecture**: Each technique runs in order, and later techniques benefit from earlier matches. This is more effective than running all techniques independently because graph propagation leverages string seed anchors.

**Conservative over aggressive**: All techniques use uniqueness gates that prefer missing a valid match over accepting a false one. False negatives are recoverable (try more techniques); false positives corrupt the BKG.
