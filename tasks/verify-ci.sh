#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml. Prints PASS/FAIL per step.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
run() {
  local label="$1"; shift
  if out=$("$@" 2>&1); then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    printf '%s\n' "$out" | tail -15
    fail=1
  fi
}

run "fmt --check"                    cargo fmt --check
run "clippy --locked -D warnings"    cargo clippy --all-targets --locked -- -D warnings
run "test --locked --all-targets"    cargo test --locked --all-targets
run "msrv 1.88.0 check --locked"     cargo +1.88.0 check --locked --all-targets
run "build --release --locked"       cargo build --release --locked
run "publish --dry-run (dirty tree)"  cargo publish --dry-run --locked --allow-dirty
RUSTDOCFLAGS="-D warnings" run "doc -D warnings" cargo doc --no-deps --locked

printf '\nresult: %s\n' "$([ $fail -eq 0 ] && echo ALL-PASS || echo FAILURES)"
exit "$fail"
