#!/usr/bin/env bash
# Load test the Evaluation Engine. Usage: ./bench.sh [seconds=30] [ticks_per_sec=2000]
# Runs evaluator + simulator, streams the evaluator's per-second stats live, then prints the Kafka consumer lag
# (messages produced but not yet evaluated). Growing lag = the engine cannot keep up.
set -euo pipefail
cd "$(dirname "$0")"
DURATION=${1:-30}
TPS=${2:-2000}
LOG=$(mktemp -d)
if [ -t 1 ]; then export FORCE_COLOR=1; fi # keep colors when printing to a terminal

TAIL_PID=
stop() {
  pkill -INT -f 'src/simulator.ts' || true
  pkill -INT -f 'src/evaluator.ts' || true
  if [ -n "$TAIL_PID" ]; then kill "$TAIL_PID" 2>/dev/null || true; fi
}
trap stop EXIT

# Start every run at the end of the topic: otherwise the evaluator first chews through ticks
# left over from earlier runs (hours old) and the numbers measure that backlog, not this run.
docker compose exec -T redpanda rpk group seek evaluator --to end >/dev/null

(cd engine && npm run evaluator >"$LOG/eval.log" 2>&1) &
EVAL_PID=$!
until grep -q 'joined the group' "$LOG/eval.log"; do
  # Fail fast instead of waiting forever when the evaluator crashes on startup.
  if ! kill -0 "$EVAL_PID" 2>/dev/null; then
    echo "evaluator exited before joining the group:" >&2
    tail -20 "$LOG/eval.log" >&2
    exit 1
  fi
  sleep 0.5
done

echo "--- evaluator, ${TPS} ticks/s target, ${DURATION}s (live; Ctrl+C stops early)"
# Stream the evaluator's log as it is written (minus npm's banner). $! is grep, the pipe's last command:
# killing it makes tail exit on its next write.
tail -n +1 -f "$LOG/eval.log" | grep --line-buffered -vE '^> |^$' &
TAIL_PID=$!

(cd engine && TICKS_PER_SEC=$TPS npm run simulator >"$LOG/sim.log" 2>&1) &
sleep "$DURATION"
kill "$TAIL_PID" 2>/dev/null || true
TAIL_PID=
echo "--- Kafka consumer lag at the end: $(docker compose exec -T redpanda rpk group describe evaluator | awk '/^TOTAL-LAG/{print $2}') messages behind"
