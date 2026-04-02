# Bundle Knowledge Graph (BKG) Format Specification

Version 1.0

## Overview

The BKG is a property graph representation of semantic intelligence extracted from JavaScript bundles. It serves as the universal intermediate representation for the demini pipeline — every analysis technique either produces or enriches a BKG.

### Design Principles

1. **Property graph model** — nodes (modules, identifiers) + edges (deps, scopes)
2. **Provenance per claim** — every semantic assertion has source + confidence
3. **Incrementally buildable** — start green, enrich over time
4. **Mergeable** — two BKGs combine via highest-confidence-wins
5. **Diffable** — version-chain delta analysis

## Lifecycle

```
Green BKG (structural only)     ← demini-extract
  → Enriched BKG                ← demini-bkg match / annotate / propagate
    → Applied BKG               ← demini-bkg apply (renames written to source)
      → Merged BKG              ← demini-bkg merge (version chain accumulation)
```

A **green BKG** contains only structural intelligence: module boundaries, dependency graph, string inventories, and AST fingerprints. No reference source needed.

An **enriched BKG** adds semantic names, source file mappings, and identifier-level knowledge from cross-version matching, source maps, LLM inference, or manual annotation.

## Top-Level Structure

```json
{
  "bkg_version": "1.0",
  "bundle": { ... },      // Target bundle metadata
  "reference": null,       // Optional reference source info
  "modules": [ ... ],      // Module nodes
  "identifiers": [ ... ],  // Identifier nodes (variable-level)
  "annotations": [ ... ],  // First-class annotation entries
  "enrichments": [ ... ],  // Log of enrichment operations
  "coverage": { ... }      // Current knowledge statistics
}
```

## Module Nodes

Each module represents a logical unit in the bundle (CJS factory, ESM initializer, runtime helper, or top-level code).

```json
{
  "id": "mod:HO",
  "minified_name": "HO",
  "semantic_name": null,
  "semantic_confidence": null,
  "semantic_source": null,
  "source_file": null,
  "wrapKind": "ESM",
  "range": { "startLine": 5000, "endLine": 5200, "charStart": 120000, "charEnd": 125000 },
  "bytes": 4200,
  "stmtCount": 12,
  "strings": ["debug", "info", "warn", "error"],
  "ast_fingerprint": "AF:IF:RET:AF:NEW:RET",
  "exports": [],
  "deps_out": ["mod:init_errors", "mod:init_chalk"],
  "deps_in": ["mod:init_cliMain"]
}
```

### Module ID Convention

- Format: `mod:{name}` where `name` is the first defined variable
- Fallback: `mod:{numericId}` for modules with no named definitions
- IDs are stable within a single BKG but may differ across bundle versions

### Dependency Edges

- `deps_out`: modules this module depends on (calls/imports)
- `deps_in`: modules that depend on this module

All dependency references use string module IDs, making the graph directly traversable.

### String Inventory

Up to 50 unique string literals per module (length 2-200 chars). Strings enable:
- Purpose-hinting (e.g., "error", "logger" suggest error handling/logging)
- Cross-version matching (shared strings indicate same module)
- Library identification (package names, URLs)

### AST Fingerprint

A colon-separated sequence of structural AST node types:
- `FD` FunctionDeclaration, `FE` FunctionExpression, `AF` ArrowFunction
- `CD` ClassDeclaration, `CE` ClassExpression
- `IF` IfStatement, `FOR/FIN/FOF` loops, `WH` WhileStatement
- `SW` SwitchStatement, `TRY` TryStatement
- `RET` ReturnStatement, `THR` ThrowStatement
- `YLD` YieldExpression, `AWT` AwaitExpression, `NEW` NewExpression

Fingerprints enable structural matching between bundle versions even when names differ.

## Identifier Nodes

Variable-level knowledge (populated by enrichment, empty in green BKG).

```json
{
  "id": "var:HO:q",
  "module": "mod:HO",
  "minified": "q",
  "semantic": "logger",
  "state": "semantic",
  "confidence": 0.977,
  "source": "ast_walk",
  "role": "variable"
}
```

### Identifier States

- `raw` — minified name only, no analysis applied
- `placeholder` — `_dvph_{hash}_` placeholder assigned (unknown but cataloged)
- `semantic` — human-readable name assigned with confidence score

## Annotations

First-class annotations attached to modules.

```json
{
  "type": "source",
  "module": "mod:HO",
  "line": 5042,
  "text": "Logger implementation from utils/logging.ts",
  "origin": { "file": "utils/logging.ts", "lines": "1-3" }
}
```

Types: `source` (from reference), `manual` (human-added), `inferred` (heuristic/LLM).

## Enrichments Log

Append-only log of operations that modified this BKG.

```json
{
  "timestamp": "2026-04-02T16:30:00Z",
  "technique": "cross_version_match",
  "reference_version": "2.1.88",
  "modules_enriched": 2248,
  "identifiers_enriched": 13200,
  "provenance": "EXP #016 Phase 3+5"
}
```

## Coverage Statistics

Current state of knowledge about the bundle.

```json
{
  "modules_named": 2248,
  "modules_total": 4608,
  "identifiers_semantic": 84333,
  "identifiers_placeholder": 46289,
  "identifiers_raw": 0,
  "identifier_coverage_semantic": 0.646,
  "identifier_coverage_touched": 1.0
}
```

## Graph Traversal Examples

### Find most-connected modules (hub detection)

```javascript
const bkg = JSON.parse(fs.readFileSync("04_bkg.json"));
const hubs = bkg.modules
  .map(m => ({ id: m.id, fanIn: m.deps_in.length }))
  .sort((a, b) => b.fanIn - a.fanIn)
  .slice(0, 10);
```

### Find modules by string content

```javascript
const logModules = bkg.modules.filter(m =>
  m.strings.some(s => /log|debug|trace/i.test(s))
);
```

### Walk dependency chain

```javascript
const modMap = new Map(bkg.modules.map(m => [m.id, m]));
function walkDeps(modId, visited = new Set()) {
  if (visited.has(modId)) return;
  visited.add(modId);
  const mod = modMap.get(modId);
  if (!mod) return;
  for (const dep of mod.deps_out) walkDeps(dep, visited);
  return visited;
}
```

## Schema

Formal JSON Schema: `schemas/bkg.schema.json`

Validate with any JSON Schema validator:
```bash
npx ajv validate -s schemas/bkg.schema.json -d 04_bkg-bundle.json
```
