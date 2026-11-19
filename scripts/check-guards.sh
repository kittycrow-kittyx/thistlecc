#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/thistlecc-guards.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/source"
# Keep imported upstream sources outside the analysis root; preserve their
# types for the local compatibility test.
tar -C "$root" --exclude='./thistle-asm' --exclude='./.git' --exclude='./node_modules' --exclude='./dist' --exclude='./build' -cf - . | tar -C "$work/source" -xf -
ln -s "$root/node_modules" "$work/source/node_modules"
ln -s "$root/thistle-asm" "$work/thistle-asm"
sed -i 's|from "../thistle-asm/|from "../../thistle-asm/|' "$work/source/test/thistleasm-compat.ts"
bun "$root/node_modules/@kitty-crow/code-guards/src/cli.ts" all --strict --include-tests --project "$work/source/tsconfig.json"
