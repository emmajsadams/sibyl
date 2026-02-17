#!/usr/bin/env bash
set -euo pipefail

# Run tests with coverage and check that function coverage meets threshold
THRESHOLD=70

echo "→ Checking test coverage (threshold: ${THRESHOLD}% functions)..."

OUTPUT=$(~/.bun/bin/bun test --coverage 2>&1)

# Print test results
echo "$OUTPUT" | grep -E '(pass|fail|Ran)'

# Extract function coverage from "All files" line
FUNC_PCT=$(echo "$OUTPUT" | grep 'All files' | awk '{print $4}' | tr -d '%')

if [ -z "$FUNC_PCT" ]; then
  echo "  ❌ Could not parse function coverage"
  exit 1
fi

# Compare as integers (truncate decimals)
FUNC_INT=${FUNC_PCT%%.*}

if [ "$FUNC_INT" -lt "$THRESHOLD" ]; then
  echo "  ❌ Function coverage ${FUNC_PCT}% is below threshold ${THRESHOLD}%"
  exit 1
fi

echo "  ✅ Function coverage: ${FUNC_PCT}% (threshold: ${THRESHOLD}%)"
