#!/bin/bash
# test-pipeline.sh — End-to-end pipeline validation on test fixture
#
# Runs all demini stages on the test-fixture bundle and validates outputs.
# Usage: ./test-pipeline.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE="$SCRIPT_DIR/test-fixture/DEMINI_00"
WORK_DIR=$(mktemp -d)

echo "=== demini pipeline validation ==="
echo "Fixture: $FIXTURE"
echo "Work dir: $WORK_DIR"
echo ""

PASS=0
FAIL=0

check() {
  local desc="$1" cond="$2"
  if eval "$cond"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

# Verify fixture stages exist (pre-built by prior pipeline runs)
echo "--- Stages 00-02: verify fixture ---"
check "beautified exists" "[ -f '$FIXTURE/00_beautified-bundle.js' ]"
check "classified exists" "[ -f '$FIXTURE/01_classified-beautified-bundle.js' ]"
check "stats JSON exists" "[ -f '$FIXTURE/01_stats-beautified-bundle.json' ]"
check "traced exists" "[ -f '$FIXTURE/02_traced-classified-beautified-bundle.js' ]"
check "trace JSON exists" "[ -f '$FIXTURE/02_trace-classified-beautified-bundle.json' ]"

# Stage 03: split (run fresh into work dir)
echo "--- Stage 03: split ---"
cp -r "$FIXTURE" "$WORK_DIR/DEMINI_00"
DEMINI="$WORK_DIR/DEMINI_00"
node "$SCRIPT_DIR/demini-split.js" "$DEMINI/02_traced-classified-beautified-bundle.js" > /dev/null 2>&1
SPLIT_DIR=$(ls -d "$DEMINI"/03_split-* 2>/dev/null | head -1)
check "split directory exists" "[ -d '$SPLIT_DIR' ]"
check "manifest.json exists" "[ -f '$SPLIT_DIR/manifest.json' ]"
MOD_COUNT=$(ls "$SPLIT_DIR"/mod_*.js 2>/dev/null | wc -l | tr -d ' ')
check "modules extracted ($MOD_COUNT)" "[ '$MOD_COUNT' -gt 0 ]"

# Stage 04: extract
echo "--- Stage 04: extract ---"
node "$SCRIPT_DIR/demini-extract.js" "$DEMINI/02_traced-classified-beautified-bundle.js" > /dev/null 2>&1
BKG=$(ls "$DEMINI"/04_bkg-*.json 2>/dev/null | head -1)
check "BKG JSON exists" "[ -f '$BKG' ]"
BKG_MODS=$(python3 -c "import json; print(len(json.load(open('$BKG'))['modules']))")
check "BKG has modules ($BKG_MODS)" "[ '$BKG_MODS' -gt 0 ]"

# BKG operations: stats
echo "--- BKG: stats ---"
STATS_OUT=$(node "$SCRIPT_DIR/demini-bkg.js" stats "$BKG" 2>&1)
check "stats runs without error" "echo '$STATS_OUT' | grep -q 'Modules:'"

# BKG operations: self-match
echo "--- BKG: self-match ---"
MATCH_OUT=$(node "$SCRIPT_DIR/demini-bkg.js" match "$BKG" "$BKG" -o "$WORK_DIR/matched.json" 2>&1)
check "match runs without error" "[ -f '$WORK_DIR/matched.json' ]"
check "self-match produces output" "echo '$MATCH_OUT' | grep -q 'Total matched:'"

# BKG operations: propagate
echo "--- BKG: propagate ---"
node "$SCRIPT_DIR/demini-bkg.js" propagate "$WORK_DIR/matched.json" -o "$WORK_DIR/propagated.json" > /dev/null 2>&1
check "propagate output exists" "[ -f '$WORK_DIR/propagated.json' ]"

# BKG operations: apply
echo "--- BKG: apply ---"
node "$SCRIPT_DIR/demini-bkg.js" apply "$WORK_DIR/propagated.json" "$SPLIT_DIR" -o "$WORK_DIR/applied" > /dev/null 2>&1
check "applied directory exists" "[ -d '$WORK_DIR/applied' ]"
APPLIED_COUNT=$(ls "$WORK_DIR/applied"/mod_*.js 2>/dev/null | wc -l | tr -d ' ')
check "applied modules ($APPLIED_COUNT)" "[ '$APPLIED_COUNT' -eq '$MOD_COUNT' ]"

# Verify annotations present
FIRST_MOD=$(ls "$WORK_DIR/applied"/mod_*.js 2>/dev/null | head -1)
check "annotations in applied modules" "head -3 '$FIRST_MOD' | grep -q 'demini-bkg'"

# Cleanup
rm -rf "$WORK_DIR"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
