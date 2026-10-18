#!/usr/bin/env bash
# Prints a long, noisy, failing build log with two real errors buried in it.
# Ask Claude to run it: with Chroni on, Claude sees ~20 lines instead of ~900,
# and both errors are still there. Without Chroni, it sees all of it.
echo "> my-app@1.0.0 build"
echo "> vite build && tsc --noEmit"
for i in $(seq 1 380); do echo "transforming src/components/Widget$i.tsx ($((i * 3))ms)"; done
echo "src/api/user.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'."
for i in $(seq 1 420); do echo "rendering chunk vendor-$i.js  $((i * 7)).$((i % 10)) kB │ gzip: $((i * 2)).1 kB"; done
echo "ERROR in src/pages/Home.tsx: Cannot find module 'lodash' or its corresponding type declarations."
for i in $(seq 1 90); do echo "  dist/assets/img-$i.png  $((i * 13)) kB"; done
echo "Build failed with 2 errors."
exit 1
