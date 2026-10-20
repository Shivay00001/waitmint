#!/usr/bin/env bash
# WaitMint platform test suite: unit (money math) + e2e (real HTTP flow).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== unit tests ==="
node tests/unit-pricing.js

echo
echo "=== e2e tests ==="
node tests/e2e.js

echo
echo "ALL TESTS PASSED"
