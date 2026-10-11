# Design: Rewrite `oh-my-node-modules` in Rust

Date: 2026-10-11
Status: Approved (design), pending spec review

## Problem

The current tool is a TypeScript/Bun package (`onm`) that scans a directory tree
for `node_modules` directories, reports their size and age, and lets the user
delete selected ones. Traversal uses `fdir` and size calculation uses Node
worker threads; deletion uses `p-limit` with `fs.rm`.

Goals for the rewrite:

- **Traverse faster.** Parallelize discovery, not just size calculation.
- **Delete faster.** Parallelize deletion across targets.
- **Better UI.** Keep the interactive CLI, with colors and spinners.

Outcome: given a root directory `X`, find every project-level `node_modules`
under `X` (to any depth), and let the user pick exactly which ones to delete,
seeing which directory and where it lives.

## Decisions

| Decision | Choice |
|---|---|
| Language | Rust |
| Distribution | Pure crate. `cargo install` / prebuilt release binaries. **Drop npm publishing and the TypeScript source.** |
| Interface | Prompt-based interactive CLI (not a full-screen ratatui TUI) |
| Feature scope | Full parity with current TS tool |
| Scan target | Project-level `node_modules` only; hidden dirs skipped by default |

Open item deferred to implementation: confirm the crates.io name
(`onm` vs `oh-my-node-modules`). Binary name is `onm`.

## Architecture

Single crate `oh-my-node-modules`, binary `onm`. All logic lives in the library
(`lib.rs`) so it is unit-testable; `main.rs` only parses args and dispatches.

```
src/
  main.rs          clap parse -> dispatch
  lib.rs           public API, re-exports
  model.rs         NodeModulesInfo, SizeCategory, AgeCategory, thresholds
  cli.rs           clap derive args + mode selection
  config.rs        .onmignore (globset) + .onmfavorites loading
  util.rs          format_bytes, relative_time, parse_size (pure, tested)
  scan/
    discovery.rs   ignore::WalkBuilder parallel walk; prune node_modules + hidden
    size.rs        parallel size + package counts (atomics)
    project.rs     package.json, .git repo root, categories
    mod.rs         orchestrate scan -> Vec<NodeModulesInfo>
  ui/
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

Boundaries: `discovery` yields paths; `size` and `project` enrich them;
`ui` consumes `Vec<NodeModulesInfo>`; `delete` consumes selected items.
Siblings communicate only through `model` and `lib`.

### Dependencies

| Crate | Purpose |
|---|---|
| `clap` (derive) | CLI parsing |
| `ignore` | Parallel directory walk with pruning (ripgrep's walker) |
| `rayon` | Data parallelism for size calc and deletion |
| `indicatif` | Spinners and progress bars |
| `owo-colors` | Colored terminal output |
| `inquire` | Multiselect + confirm prompts with built-in filtering |
| `serde`, `serde_json` | JSON output; `package.json` parsing |
| `globset` | `.onmignore` pattern matching |
| `humansize` | Byte formatting |
| `thiserror` / `anyhow` | Error types and propagation |

## Data model

`NodeModulesInfo` (serde-serializable), mirroring the current TS type:

| Field | Type |
|---|---|
| `path` | `PathBuf` |
| `project_path` | `PathBuf` |
| `project_name` | `String` |
| `project_version` | `Option<String>` |
| `repo_path` | `PathBuf` |
| `size_bytes` | `u64` |
| `package_count` | `u64` (top-level) |
| `total_package_count` | `u64` (recursive) |
| `last_modified` | `SystemTime` |
| `selected` | `bool` |
| `is_favorite` | `bool` |
| `size_category` | `SizeCategory` |
| `age_category` | `AgeCategory` |
| `is_pending` | `bool` |

Categories and thresholds match the current tool:

- Size: `small` <=100 MB, `medium` >100 MB, `large` >500 MB, `huge` >1 GB
- Age: `fresh` <=7 d, `recent` <=30 d, `old` <=90 d, `stale` >90 d

## Scan semantics

- Root = positional path; defaults to `.` when omitted.
- The `ignore` walker **descends** into directories but **prunes** any
  `node_modules` subtree, so only project-level `node_modules` are reported
  (nested dependency trees are skipped).
- Hidden directories (name starting with `.`) are skipped unless `--hidden`.
- `--max-depth N` limits descent when provided.
- Exclusions from `.onmignore` (cwd + home) are applied via `globset`.
  Defaults: `**/node_modules/**`, `**/.git/**`, `**/.*`.
- For each discovered `node_modules`:
  - Compute recursive `size_bytes` and `total_package_count`; count
    non-hidden, non-`.bin` direct children as `package_count`.
  - Read `package.json` for `project_name`/`project_version` (fallback: dir name).
  - Walk parents for `.git` to find `repo_path` (fallback: project path).
  - Derive categories from size and `last_modified`.
- Favorites from `.onmfavorites` (home) set `is_favorite`; these are
  pre-deselected in the picker.

## Interface

Modes selected by flags:

| Invocation | Mode |
|---|---|
| `onm [path]` | Interactive: scan -> sort -> multiselect -> confirm -> delete |
| `onm --scan [path]` | Report only (colored table, top 20 + total) |
| `onm --scan --json [path]` | JSON array to stdout |
| `onm --auto --min-size <size> [--dry-run] [--force] [--yes] [path]` | Non-interactive batch |

Interactive sequence:

1. Spinner: "Scanning... found N" (live discovery count).
2. Spinner: "Calculating sizes... X/Y" (rayon progress).
3. Re-sort by size descending; print summary (total size, project count, stale count).
4. `inquire` MultiSelect, ordered by `--sort`
   (`size`/`date`/`name`/`packages`, asc/desc; default size desc). Each row:
   `[size]  projectName  [age]  repoPath`, with size color-coded.
5. Filter within the picker by name or path (built-in `inquire` filter).
6. `inquire` Confirm: "Delete N directories (X GB)?" -> rayon delete with
   spinner -> per-item success/failure lines -> total freed.

Shared flags: `--sort`, `--max-depth`, `--hidden`, `--dry-run`, `--force`,
`--yes`, `--json`, `--no-check` (skip in-use check).

## Deletion and safety

Before any removal (`delete/safety.rs`):

1. Normalized path ends with `node_modules`.
2. Directory exists.
3. Verify: contains at least one subdirectory, **or** parent has `package.json`.
4. In-use check (unless `--no-check`): any lockfile
   (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) in the project has mtime
   within 60 s -> warn / mark as in use.

Removal chain (`delete/remove.rs`), fast path first:

1. `remove_dir_all` (crate).
2. On failure: recursively `chmod 0o777`, then retry.
3. On failure: rename to `<path>.old.<timestamp>`, then remove.

Targets are deleted concurrently with `rayon` (parallel deletion is the goal).
Each target's failure is recorded per item; the batch never aborts early.
`--force` enables steps 2-3; without it only step 1 runs.

Result mirrors the current `DeletionResult`: `total_attempted`, `successful`,
`failed`, `bytes_freed`, `formatted_bytes_freed`, `details` (per item:
`path`, `project_name`, `size_bytes`, `success`, `error`, `duration_ms`).
`--json` serializes this.

## Errors

- Per-target errors are captured, not fatal (a scan continues past an
  unreadable directory; a delete continues past one failing target).
- Fatal errors (bad args, unreadable root) exit non-zero with a colored message.
- Never log secrets; error messages are actionable.

## Testing

Unit tests (`#[cfg(test)]`):

- `util`: byte formatting at boundaries; `parse_size` for `1gb`/`500mb`/plain bytes.
- `model`: category assignment at each threshold.
- `config`: `.onmignore` glob parsing and matching.
- `safety`: verification accepts a real `node_modules` and rejects impostors.

Integration tests (`tests/`, tempdir fixtures):

- Discovery finds project-level `node_modules` at multiple depths.
- Nested `node_modules` (inside another) is pruned.
- Hidden directories skipped by default; included with `--hidden`.
- `--max-depth` bounds results.
- Deletion on fixtures; `--dry-run` deletes nothing; `--force` removes a
  read-only file.

Verification before completion: `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings`, `cargo test`,
`cargo build --release`.

## Build and release

- Remove `package.json`, `bun.lock`, `package-lock.json`, `tsconfig.json`,
  `src/*.ts`, `tests/*.test.ts`, `release.sh`, and the npm release workflow.
- Add `Cargo.toml`, `rust-toolchain.toml` (stable), and rewrite `README.md`
  and `AGENTS.md` for the Rust project.
- CI (GitHub Actions) matrix on linux/macos/windows: fmt, clippy, test, build.
- Tag-triggered release: build prebuilt binaries for each target, attach to a
  GitHub Release, and `cargo publish` to crates.io.

## Out of scope

- Full-screen ratatui TUI.
- npm/`onm` npm-bin distribution.
- Following symlinks.
- GitHub/GitLab API integration.

## Migration note

This replaces the TypeScript implementation entirely. Git history preserves the
old code. Versioning restarts at `0.1.0` for the Rust crate.
