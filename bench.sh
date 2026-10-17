#!/usr/bin/env bash
# Load test the Evaluation Engine. Usage: ./bench.sh [seconds=30] [ticks_per_sec=2000]
# Runs evaluator + simulator, prints the evaluator's per-second stats, then the Kafka consumer lag
# (messages produced but not yet evaluated). Growing lag = the engine cannot keep up.
set -euo pipefail
cd "$(dirname "$0")"
DURATION=${1:-30}
TPS=${2:-2000}
LOG=$(mktemp -d)

stop() { pkill -INT -f 'src/simulator.ts' || true; pkill -INT -f 'src/evaluator.ts' || true; }
trap stop EXIT

(cd engine && npm run evaluator >"$LOG/eval.log" 2>&1) &
until grep -q 'joined the group' "$LOG/eval.log"; do sleep 0.5; done

(cd engine && TICKS_PER_SEC=$TPS npm run simulator >"$LOG/sim.log" 2>&1) &
sleep "$DURATION"

echo "--- evaluator, ${TPS} ticks/s target, ${DURATION}s"
grep 'ticks/s' "$LOG/eval.log"
echo "--- Kafka consumer lag at the end: $(docker compose exec -T redpanda rpk group describe evaluator | awk '/^TOTAL-LAG/{print $2}') messages behind"
