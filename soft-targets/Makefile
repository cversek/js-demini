# Soft-target build, pipeline, and validation automation
# Usage:
#   make clean              # Remove all DEMINI_* outputs
#   make build              # npm install + esbuild all targets
#   make pipeline           # Run demini-classify + demini-trace on all
#   make validate           # Clean + build + pipeline + validate vs sourcemap
#   make report             # Just run validation report (no rebuild)
#   make clean-target TARGET=express   # Clean single target
#   make build-target TARGET=express   # Build single target
#   make pipeline-target TARGET=express # Pipeline single target
#   make all-target TARGET=express     # Full cycle for single target

SHELL := /bin/bash
DEMINI_ROOT := $(shell dirname $(CURDIR))
ESBUILD := esbuild
DEMINI := node $(DEMINI_ROOT)/demini.js
VALIDATE := node $(DEMINI_ROOT)/validate-soft-targets.js

# Auto-discover targets with build.json
TARGETS := $(shell for d in */build.json; do dirname "$$d"; done 2>/dev/null)

.PHONY: clean build pipeline validate report clean-target build-target pipeline-target all-target list

list:
	@echo "Available targets ($(words $(TARGETS))):"
	@for t in $(TARGETS); do echo "  $$t"; done

clean:
	@echo "=== Cleaning all DEMINI_* outputs ==="
	@for t in $(TARGETS); do \
		rm -rf $$t/dist/DEMINI_*; \
	done
	@echo "Done. Cleaned $(words $(TARGETS)) targets."

clean-target:
	@test -n "$(TARGET)" || (echo "Usage: make clean-target TARGET=<name>" && exit 1)
	@echo "Cleaning $(TARGET)/dist/DEMINI_*"
	@rm -rf $(TARGET)/dist/DEMINI_*

build:
	@echo "=== Building all targets ==="
	@ok=0; fail=0; skip=0; \
	for t in $(TARGETS); do \
		if [ ! -f "$$t/build.json" ]; then continue; fi; \
		entry=$$(node -e "const b=require('./$$t/build.json'); console.log(b.entry || 'entry.js')"); \
		outfile=$$(node -e "const b=require('./$$t/build.json'); console.log(b.outfile || 'dist/bundle.js')"); \
		args=$$(node -e "const b=require('./$$t/build.json'); console.log((b.esbuild_args||[]).join(' '))"); \
		if [ ! -d "$$t/node_modules" ]; then \
			echo "  [npm] $$t: installing..."; \
			(cd $$t && npm install --silent 2>/dev/null) || { echo "  [FAIL] $$t: npm install failed"; fail=$$((fail+1)); continue; }; \
		fi; \
		mkdir -p $$(dirname "$$t/$$outfile"); \
		echo "  [esbuild] $$t: $$args -> $$outfile"; \
		(cd $$t && $(ESBUILD) $$entry $$args --outfile=$$outfile 2>/dev/null) && ok=$$((ok+1)) || { echo "  [FAIL] $$t: esbuild failed"; fail=$$((fail+1)); }; \
	done; \
	echo "Build complete: $$ok ok, $$fail failed"

build-target:
	@test -n "$(TARGET)" || (echo "Usage: make build-target TARGET=<name>" && exit 1)
	@test -f "$(TARGET)/build.json" || (echo "No build.json for $(TARGET)" && exit 1)
	@entry=$$(node -e "const b=require('./$(TARGET)/build.json'); console.log(b.entry || 'entry.js')"); \
	outfile=$$(node -e "const b=require('./$(TARGET)/build.json'); console.log(b.outfile || 'dist/bundle.js')"); \
	args=$$(node -e "const b=require('./$(TARGET)/build.json'); console.log((b.esbuild_args||[]).join(' '))"); \
	if [ ! -d "$(TARGET)/node_modules" ]; then \
		echo "[npm] $(TARGET): installing..."; \
		(cd $(TARGET) && npm install --silent 2>/dev/null); \
	fi; \
	mkdir -p $$(dirname "$(TARGET)/$$outfile"); \
	echo "[esbuild] $(TARGET): $$args -> $$outfile"; \
	(cd $(TARGET) && $(ESBUILD) $$entry $$args --outfile=$$outfile)

pipeline:
	@echo "=== Running demini pipeline on all targets ==="
	@ok=0; fail=0; \
	for t in $(TARGETS); do \
		outfile=$$(node -e "const b=require('./$$t/build.json'); console.log(b.outfile || 'dist/bundle.js')"); \
		bundle="$$t/$$outfile"; \
		if [ ! -f "$$bundle" ]; then echo "  [SKIP] $$t: no bundle at $$outfile"; continue; fi; \
		echo "  [demini] $$t"; \
		$(DEMINI) "$$bundle" 2>/dev/null && ok=$$((ok+1)) || { echo "  [FAIL] $$t: pipeline failed"; fail=$$((fail+1)); }; \
	done; \
	echo "Pipeline complete: $$ok ok, $$fail failed"

pipeline-target:
	@test -n "$(TARGET)" || (echo "Usage: make pipeline-target TARGET=<name>" && exit 1)
	@outfile=$$(node -e "const b=require('./$(TARGET)/build.json'); console.log(b.outfile || 'dist/bundle.js')"); \
	bundle="$(TARGET)/$$outfile"; \
	echo "[demini] $(TARGET): $$bundle"; \
	$(DEMINI) "$$bundle"

validate: clean build pipeline report

report:
	@$(VALIDATE)

all-target: clean-target build-target pipeline-target
	@$(VALIDATE) --target $(TARGET)
