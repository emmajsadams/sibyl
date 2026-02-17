#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")

echo "=== Publishing SIBYL v${VERSION} ==="

# 1. Lint
echo "→ Linting..."
npx oxlint --fix src/
echo "  ✅ Lint clean"

# 2. Type check
echo "→ Type checking..."
npx tsc --noEmit
echo "  ✅ Types clean"

# 3. Tests + coverage check
echo "→ Running tests with coverage check..."
bash scripts/check-coverage.sh

# 4. Check for uncommitted changes
if [ -z "$(git status --porcelain)" ]; then
  echo "  ⚠ Nothing to commit — working tree clean"
else
  echo "→ Committing..."
  git add -A
  SUMMARY="${1:-release}"
  git commit -m "v${VERSION}: ${SUMMARY}"
  echo "  ✅ Committed"
fi

# 5. Tag (delete existing local tag if re-publishing same version)
if git rev-parse "v${VERSION}" >/dev/null 2>&1; then
  echo "  ⚠ Tag v${VERSION} already exists locally — replacing"
  git tag -d "v${VERSION}"
fi
git tag -a "v${VERSION}" -m "v${VERSION}: ${1:-release}"
echo "  ✅ Tagged v${VERSION}"

# 6. Push
echo "→ Pushing..."
git push
git push --tags --force
echo "  ✅ Pushed"

echo ""
echo "=== Published SIBYL v${VERSION} ==="
