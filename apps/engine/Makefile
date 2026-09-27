# =============================================================================
# MoneyPrinterTurbo command shortcuts (npm-scripts style for Python).
#
# Usage:
#   make api      # start the MPT API server
#
# Modal (InfiniteTalk GPU):
#   make modalDeploy   # redeploy modal_app.py
#   make modalRun      # run 1 generation with live logs saved to a file
#   make modalDebug    # redeploy + run with logs saved to a file
#   make modalLogs     # tail the app logs (streaming, saves to a file)
#   make modalBenchmark # deploy/snapshot + 5 named tests
#   make modalBenchmark IMAGE=/path/input.png AUDIO=/path/input.wav
#                       # override the default inputs
#   make modalStop     # shows how to stop containers via the dashboard
# =============================================================================

PYTHON ?= uv
SHELL := /bin/bash

.PHONY: api test coverage mutation lint hooks modalDeploy modalRun modalDebug modalLogs modalBenchmark modalStop

MODAL_APP ?= moneyprint-infinitetalk
MODAL_LOG_DIR ?= logs
MODAL_LOG_FILE ?= $(MODAL_LOG_DIR)/modal_$(shell date +%Y%m%d_%H%M%S).log
BENCH_OUT ?= bench/infinitetalk/experiments
# Benchmark inputs have no defaults: pass IMAGE and AUDIO explicitly so no
# personal or unlicensed media ships with the repo.
IMAGE ?=
AUDIO ?=
FRAMES ?=

# Modal: redeploy using H100 as the first option and H200 as fallback.
modalDeploy:
	$(PYTHON) run modal deploy modal_app.py

# Modal: follow the logs in the terminal and save a copy to a file.
modalLogs:
	@mkdir -p "$(MODAL_LOG_DIR)"
	@echo "Saving logs to $(MODAL_LOG_FILE)"
	$(PYTHON) run modal app logs "$(MODAL_APP)" 2>&1 | tee "$(MODAL_LOG_FILE)"

# Modal: redeploy and then follow the live logs.
modalDebug:
	@$(MAKE) --no-print-directory modalDeploy
	@$(MAKE) --no-print-directory modalLogs

# Alias for following only the Modal logs.
modalRun:
	@$(MAKE) --no-print-directory modalLogs

# Modal: create/validate the deploy first, then run the five cases sequentially.
# IMAGE and AUDIO must be passed explicitly (no defaults).
modalBenchmark:
	@test -n "$(IMAGE)" || (echo "Usage: make modalBenchmark IMAGE=/path/input.png AUDIO=/path/input.wav"; exit 2)
	@test -f "$(IMAGE)" || (echo "Image not found: $(IMAGE)"; exit 2)
	@test -n "$(AUDIO)" || (echo "Audio not found: $(AUDIO)"; exit 2)
	@test -f "$(AUDIO)" || (echo "Audio not found: $(AUDIO)"; exit 2)
	@$(MAKE) --no-print-directory modalDeploy
	@set -eu; \
		mkdir -p "$(BENCH_OUT)"; \
		for experiment in \
			"480p_fast_steps8_tc04|8:0.4|infinitetalk-480" \
			"480p_balanced_steps10_tc04|10:0.4|infinitetalk-480" \
			"720p_baseline_steps12_tc03|12:0.3|infinitetalk-720" \
			"720p_fast_steps8_tc04|8:0.4|infinitetalk-720" \
			"720p_balanced_steps10_tc04|10:0.4|infinitetalk-720"; do \
			name=$${experiment%%|*}; rest=$${experiment#*|}; cases=$${rest%%|*}; size=$${rest#*|}; \
			dir="$(BENCH_OUT)/$$name"; mkdir -p "$$dir"; \
			echo "=== $$name ===" | tee "$$dir/benchmark.log"; \
			$(PYTHON) run python scripts/infinitetalk_bench.py \
				--image "$(IMAGE)" --audio "$(AUDIO)" $(if $(FRAMES),--frames "$(FRAMES)",) --out "$$dir" \
				--cases "$$cases" --size "$$size" 2>&1 | tee -a "$$dir/benchmark.log"; \
			status=$${PIPESTATUS[0]}; if [ "$$status" -ne 0 ]; then exit "$$status"; fi; \
		done

modalStop:
	@echo "Open the $(MODAL_APP) app in the Modal dashboard and use Stop on the container."

api:
	$(PYTHON) run python main.py

test:
	$(PYTHON) run pytest -q

coverage:
	$(PYTHON) run coverage run --source=app,cli -m pytest -q
	$(PYTHON) run coverage report -m

# Run mutation testing against the CPU deployment, storage, state, and cleanup paths.
mutation:
	$(PYTHON) run mutmut run
	$(PYTHON) run mutmut results

lint:
	$(PYTHON) run ruff check app cli.py scripts test

hooks:
	$(PYTHON) run pre-commit install
