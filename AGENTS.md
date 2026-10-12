# AGENTS.md - oh-my-node-modules

Guidelines for AI assistants working on this codebase.

Single Rust crate `oh-my-node-modules` producing the `onm` binary.

## Build & Development Commands

```bash
cargo fmt                                   # Format
cargo fmt --check                           # Verify formatting
cargo clippy --all-targets -- -D warnings   # Lint, warnings are errors
cargo test                                  # Run all tests
cargo test <name>                           # Run a single test by name
cargo build --release                       # Release build
cargo run -- --scan .                       # Run the binary
```

## Code Style Constraints

- **Edition 2024**, **MSRV 1.88** (`rust-version` in `Cargo.toml`), stable
  toolchain (`rust-toolchain.toml`). CI pins 1.88.0 to enforce the MSRV; the
  dependency tree requires 1.88 (`ignore` uses let-chains).
- Every crate root carries `#![forbid(unsafe_code)]` (see `src/lib.rs`).
- No `unwrap()`, `expect()`, or `panic!` on runtime paths. Use `Option`/`Result`
  and `unwrap_or`/`unwrap_or_else`/`unwrap_or_default`, or propagate with `?`.
  `expect` inside `#[cfg(test)]` bodies is fine.
- Explicit return types on exported functions.
- Errors carry context: per-target failures are captured, not fatal; a scan
  continues past an unreadable directory and a delete continues past a failing
  target. Fatal errors exit non-zero with a colored message.
- Never log secrets, credentials, or environment variable values.
- Unit tests live in `#[cfg(test)]` modules next to the code; integration tests
  live in `tests/` and use tempdir fixtures.
- Keep `cargo fmt` and `cargo clippy --all-targets -- -D warnings` clean.

## Naming Conventions

- **Files**: snake_case modules (`size.rs`, `discovery.rs`).
- **Functions**: snake_case (`calculate_size`, `format_bytes`).
- **Types/Interfaces**: PascalCase (`NodeModulesInfo`, `ScanOptions`).
- **Constants**: `UPPER_SNAKE_CASE` for true constants (`SIZE_THRESHOLDS`).
- **Boolean fields**: read as a predicate (`is_pending`, `is_favorite`).

## Project Structure

```
src/
  main.rs          clap parse -> dispatch
  lib.rs           public API, re-exports
  model.rs         NodeModulesInfo, SizeCategory, AgeCategory, thresholds
  cli.rs           clap derive args + mode selection
  cli/
    interactive.rs interactive scan -> pick -> confirm -> delete flow
  config.rs        .onmignore (globset) + .onmfavorites loading
  util.rs          format_bytes, relative_time, parse_size (pure, tested)
  scan/
    discovery.rs   ignore parallel walk; prune node_modules + hidden
    size.rs        recursive size + package counts for one directory
    project.rs     package.json, .git repo root, categories
    mod.rs         orchestrate scan -> Vec<NodeModulesInfo> (rayon fan-out)
  ui/
    mod.rs         ui module root and re-exports
    theme.rs       owo-colors semantic palette
    progress.rs    indicatif spinners/progress
    picker.rs      inquire multiselect (sorted + filterable)
    report.rs      colored table + --json output
  delete/
    safety.rs      verify real node_modules, in-use lockfile check
    remove.rs      fast recursive removal + force fallback chain
    mod.rs         rayon parallel delete orchestration
tests/             integration tests (tempdir fixtures)
```

Boundaries: `discovery` yields paths; `size` and `project` enrich them; `ui`
consumes `Vec<NodeModulesInfo>`; `delete` consumes selected items. Siblings
communicate only through `model` and `lib`.

## Testing Guidelines

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_boundary_sizes() {
        assert_eq!(format_bytes(0), "0 B");
    }
}
```

- Test pure functions in `util.rs`, `model.rs`, and `config.rs` directly.
- Use `tempfile::tempdir()` for filesystem tests and keep fixtures local.
- Integration tests in `tests/cli.rs` drive the binary with `assert_cmd` and
  `predicates`.
- Prefer asserting on values over rendered output unless output is the contract.

## Common Tasks

### Adding a New Feature

1. Add types to `model.rs` if the data model changes.
2. Implement logic in the owning module (`scan`/`ui`/`delete`/`util`).
3. Add unit tests in a `#[cfg(test)]` module or `tests/cli.rs`.
4. Wire user-facing flags through `cli.rs` (and `cli/interactive.rs`).
5. Run `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`.

### Error Messages

Include context for debugging, and never include secret values:

```rust
// Good
format!("Error analyzing {}: {message}", path.display())

// Bad
String::from("Analysis failed")
```

## Constraints

- **No `unsafe`**: forbidden at every crate root.
- **No panics on runtime paths**: no `unwrap`/`expect`/`panic!`.
- **Cross-platform**: paths must work on Windows (`\`) and Unix (`/`); no shell
  commands for directory work.
- **Scan semantics**: only project-level `node_modules` are reported (nested
  ones are pruned); hidden directories are opt-in via `--hidden`.

## Continuous Integration

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual
dispatch. Jobs: `lint` (fmt, clippy), `test` (Linux/macOS/Windows),
`msrv` (1.88.0), `package` (release build + packaged-crate build), `docs`
(rustdoc with `-D warnings`). CI only verifies; it never publishes.

Publishing to crates.io is manual and local — see the Releasing section in
`README.md`. Do not add a deploy or publish job to CI.

## Documentation

The README flow diagram is rendered from `docs/onm-flow.mmd` into
`docs/onm-flow.svg`. Edit the `.mmd` and re-render both files together; the
README embeds the SVG, and crates.io rewrites that relative path to the repo's
default branch.

## Before Submitting

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked --all-targets
cargo +1.88.0 check --locked --all-targets
cargo build --release --locked
RUSTDOCFLAGS="-D warnings" cargo doc --no-deps --locked
```
