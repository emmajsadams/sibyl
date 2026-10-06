#!/bin/sh
# Offline verification; never source credentials or write legacy training data in the checkout.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
verify_dir=$(mktemp -d "${TMPDIR:-/tmp}/sibyl-jev-verify.XXXXXX")
trap 'rm -rf "$verify_dir"' EXIT HUP INT TERM
cp -R "$repo/src" "$repo/scripts" "$verify_dir/"
cp "$repo/package.json" "$repo/tsconfig.json" "$verify_dir/"
ln -s "$repo/node_modules" "$verify_dir/node_modules"
mkdir -p "$verify_dir/training"
unset TYPESAFE_API_KEY OPENAI_API_KEY OPENAI_ACCESS_TOKEN
cd "$repo"
bunx --no-install oxfmt --check src/balance src/logger.ts src/logger.test.ts src/engine/game.ts src/types/index.ts package.json
bunx --no-install oxlint src/balance src/logger.ts src/logger.test.ts src/engine/game.ts src/types/index.ts
bunx --no-install tsc --noEmit
cd "$verify_dir"
bun test src
