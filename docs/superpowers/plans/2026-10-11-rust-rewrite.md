# Rust Rewrite of `oh-my-node-modules` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `onm` node_modules finder/cleaner as a single Rust crate with parallel traversal, parallel sizing, and parallel deletion, plus a colored, spinner-driven interactive CLI.

**Architecture:** One crate `oh-my-node-modules` with binary `onm`. All logic lives in the library (`src/lib.rs`) so it is unit-testable; `main.rs` only calls `cli::run`. Discovery uses the `ignore` crate's parallel walker and prunes `node_modules` subtrees; sizing and deletion fan out with `rayon`. UI is prompt-based (`inquire` + `indicatif` + `owo-colors`).

**Tech Stack:** Rust (edition 2024), `clap`, `ignore`, `rayon`, `indicatif`, `inquire`, `owo-colors`, `serde`/`serde_json`, `globset`, `humansize`, `thiserror`, `anyhow`. Dev: `assert_cmd`, `predicates`, `tempfile`.

**Spec:** `docs/superpowers/specs/2026-10-11-rust-rewrite-design.md`

## Global Constraints

- Crate name `oh-my-node-modules`, binary name `onm`, crate version `0.1.0`, edition `2024`, MSRV `1.85`.
- `#![forbid(unsafe_code)]` at crate root.
- No `unwrap()`/`expect()`/`panic!` on fallible runtime paths; use `Result` and the error modules. `unwrap` is acceptable only in `#[cfg(test)]` and for `Mutex::lock`.
- `cargo fmt` clean and `cargo clippy --all-targets -- -D warnings` clean before every commit.
- Never log secrets, credentials, or environment variable values.
- Size thresholds (bytes): small `<= 104857600`, medium `> 104857600`, large `> 524288000`, huge `> 1073741824`.
- Age thresholds (days): fresh `<= 7`, recent `<= 30`, old `<= 90`, stale `> 90`.
- Default exclude globs: `**/node_modules/**`, `**/.git/**`, `**/.*`.
- Lockfiles checked for in-use (mtime within 60 s): `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`.
- Binary path defaults to `.` when the positional argument is omitted.

## Review Focus

Input classes / failure modes the spec implies but which no single task's happy-path tests cover. Each line gets a test in the owning task:

1. **Symlinked directories, and a `node_modules` that is itself a symlink** — a reasonable person expects the scan not to loop infinitely and deletion not to follow the link. (Tasks 7, 10)
2. **Permission-denied directories mid-tree** — expect the scan to skip and continue, not abort. (Tasks 7, 8)
3. **Empty or fake `node_modules`** (no subdirs, no sibling `package.json`) — expect verification to refuse deletion. (Task 10)
4. **Invalid inputs**: nonexistent root path, `--min-size banana`, `--max-depth 0` — expect a clear message and non-zero exit, not a panic. (Tasks 8, 14)
5. **Paths with spaces and very deep nesting** — expect no panic and correct results. (Tasks 2, 7)

---
<!-- TASKS BELOW -->

### Task 1: Crate scaffold, CLI skeleton, and remove TypeScript

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `src/main.rs`, `src/lib.rs`, `src/cli.rs`
- Modify: `.gitignore`
- Delete: `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.json`, `src/types.ts`, `src/utils.ts`, `src/scanner.ts`, `src/size-worker.ts`, `src/deletion.ts`, `src/cli.ts`, `src/index.ts`, `tests/utils.test.ts`, `tests/scanner.test.ts`, `tests/deletion.test.ts`, `release.sh`, `.github/workflows/release.yml`
- Test: `tests/cli.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `cli::Cli` (clap `Parser`) with fields `path: Option<PathBuf>`, `scan: bool`, `auto: bool`, `json: bool`, `dry_run: bool`, `force: bool`, `yes: bool`, `min_size: Option<String>`, `sort: SortArg`, `max_depth: Option<usize>`, `hidden: bool`, `no_check: bool`; `cli::SortArg` enum (`Size`, `Date`, `Name`, `Packages`) with `--sort` values `size|date|name|packages` and `--asc` to flip order; `cli::run(cli: Cli) -> std::process::ExitCode`; `lib::VERSION: &str`.

- [ ] **Step 1: Scaffold the crate and remove the TypeScript project**

Write `Cargo.toml` with `[package] name = "oh-my-node-modules", version = "0.1.0", edition = "2024", rust-version = "1.85"`, `[[bin]] name = "onm", path = "src/main.rs"`, `[lib] name = "oh_my_node_modules", path = "src/lib.rs"`, the dependency set from the Tech Stack (first task needs only `clap` with feature `derive`, `anyhow`), `[dev-dependencies]` `assert_cmd`, `predicates`, `tempfile`. Write `rust-toolchain.toml` pinning `channel = "stable"`. Update `.gitignore` to add `/target`. `git rm` all TypeScript files listed above. Create `src/main.rs` (`fn main() -> ExitCode { cli::run(cli::Cli::parse()) }`), `src/lib.rs` (`#![forbid(unsafe_code)]` + `pub mod cli; pub const VERSION: &str = env!("CARGO_PKG_VERSION");`), and a minimal `src/cli.rs` with the `Cli`/`SortArg` structs and a `run` that returns `ExitCode::SUCCESS`.

- [ ] **Step 2: Write the failing integration test**

`tests/cli.rs`:

```rust
use assert_cmd::Command;
use predicates::str::contains;

#[test]
fn version_flag_prints_name_and_version() {
    Command::cargo_bin("onm").unwrap()
        .arg("--version")
        .assert().success()
        .stdout(contains("0.1.0"));
}

#[test]
fn help_lists_scan_and_auto_modes() {
    Command::cargo_bin("onm").unwrap()
        .arg("--help")
        .assert().success()
        .stdout(contains("--scan").and(contains("--auto")));
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --test cli`
Expected: FAIL (help output lacks `--scan`/`--auto`).

- [ ] **Step 4: Add clap attributes so the assertions pass**

Add `#[command(name = "onm", version, about = "Find and clean up node_modules directories")]` and `#[arg(long)]` doc comments to `Cli` for every field; make `--scan` and `--auto` visible in help.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --test cli`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify lint and format**

Run: `cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold rust crate, remove typescript implementation"
```

---

### Task 2: `util` formatting and parsing functions

**Files:**
- Create: `src/util.rs`
- Modify: `src/lib.rs` (add `pub mod util;`)
- Test: inline `#[cfg(test)] mod tests` in `src/util.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `util::format_bytes(bytes: u64) -> String`; `util::parse_size(s: &str) -> Result<u64, util::ParseSizeError>` (accepts `b|kb|mb|gb|tb`, case-insensitive, optional space, decimal); `util::format_relative_time(modified: SystemTime, now: SystemTime) -> String`; `util::truncate(s: &str, max: usize) -> String`; `util::ParseSizeError` implementing `std::error::Error`.

- [ ] **Step 1: Write the failing tests**

Add to `src/util.rs`:

```rust
#[test]
fn format_bytes_boundaries() {
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(1024), "1 KB");
    assert_eq!(format_bytes(1024 * 1024), "1.0 MB");
    assert_eq!(format_bytes(1024 * 1024 * 1024), "1.0 GB");
}

#[test]
fn parse_size_roundtrips_units() {
    assert_eq!(parse_size("1gb").unwrap(), 1_073_741_824);
    assert_eq!(parse_size("500MB").unwrap(), 524_288_000);
    assert_eq!(parse_size("1024").unwrap(), 1024);
    assert!(parse_size("banana").is_err());
    assert!(parse_size("-5mb").is_err());
}

#[test]
fn relative_time_buckets() {
    let now = SystemTime::now();
    assert_eq!(format_relative_time(now, now), "just now");
    assert_eq!(format_relative_time(now - Duration::from_secs(3600 * 5), now), "5h ago");
    assert_eq!(format_relative_time(now - Duration::from_secs(86400 * 3), now), "3d ago");
}

#[test]
fn truncate_handles_paths_with_spaces() {
    assert_eq!(truncate("a very long path with spaces", 10), "a very ...");
    assert_eq!(truncate("short", 10), "short");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test util::`
Expected: FAIL to compile (`format_bytes` not defined).

- [ ] **Step 3: Implement the four functions**

Base units on 1024; one decimal for MB and above, none below. `parse_size` uses a single regex-free scan (split trailing alpha suffix) and rejects empty/negative input. `format_relative_time` mirrors `just now` / `Nm ago` / `Nh ago` / `Nd ago` / `<N>mo ago` / `<N>y ago`. `truncate` appends `...` when `max > 3`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test util::`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/util.rs src/lib.rs
git commit -m "feat: add byte/time formatting and size parsing"
```

---

### Task 3: `model` data types and categories

**Files:**
- Create: `src/model.rs`
- Modify: `src/lib.rs` (add `pub mod model;`)

**Interfaces:**
- Consumes: `util` (not required at compile time).
- Produces: `model::SizeCategory`, `model::AgeCategory` (both `Copy`, `Serialize`); `model::NodeModulesInfo` deriving `Serialize`, fields exactly `path: PathBuf`, `project_path: PathBuf`, `project_name: String`, `project_version: Option<String>`, `repo_path: PathBuf`, `size_bytes: u64`, `package_count: u64`, `total_package_count: u64`, `last_modified: SystemTime` (serialized via `model::serde_unix_ms` as `last_modified_ms`), `selected: bool`, `is_favorite: bool`, `size_category: SizeCategory`, `age_category: AgeCategory`, `is_pending: bool`; constants `SIZE_SMALL_MAX`, `SIZE_MEDIUM_MAX`, `SIZE_LARGE_MAX`, `AGE_FRESH_DAYS`, `AGE_RECENT_DAYS`, `AGE_OLD_DAYS`; functions `model::size_category(bytes: u64) -> SizeCategory`, `model::age_category(modified: SystemTime, now: SystemTime) -> AgeCategory`, `model::age_in_days(modified: SystemTime, now: SystemTime) -> u64`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn size_category_at_thresholds() {
    assert_eq!(size_category(104_857_600), SizeCategory::Small);
    assert_eq!(size_category(104_857_601), SizeCategory::Medium);
    assert_eq!(size_category(107_374_182_400), SizeCategory::Huge);
}

#[test]
fn age_category_at_thresholds() {
    let now = SystemTime::now();
    let days = |d| now - Duration::from_secs(86_400 * d);
    assert_eq!(age_category(days(7), now), AgeCategory::Fresh);
    assert_eq!(age_category(days(8), now), AgeCategory::Recent);
    assert_eq!(age_category(days(91), now), AgeCategory::Stale);
}

#[test]
fn node_modules_info_serializes_timestamp_as_ms() {
    // build a minimal NodeModulesInfo, serde_json::to_value, assert key "last_modified_ms" is a number
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test model::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement types, constants, and functions**

Set the threshold constants to the Global Constraints values. Implement `serde_unix_ms` as a `serialize_with` module using `SystemTime::duration_since(UNIX_EPOCH)` in milliseconds (0 on error).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test model::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model.rs src/lib.rs
git commit -m "feat: add domain model and size/age categories"
```

---

### Task 4: `config` ignore and favorites loading

**Files:**
- Create: `src/config.rs`
- Modify: `src/lib.rs` (add `pub mod config;`)

**Interfaces:**
- Consumes: nothing.
- Produces: `config::Config { exclude: globset::GlobSet, favorites: HashSet<PathBuf> }`; `config::load(cwd: &Path, home: Option<&Path>) -> Config` (reads `.onmignore` from cwd then home, appending to defaults; reads `.onmfavorites` from home, one path per line, ignoring blanks and `#` comments); `config::default_excludes() -> &'static [&'static str]`; `config::is_excluded(&Config, path: &Path) -> bool`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn default_excludes_cover_node_modules_and_git() {
    let cfg = load(Path::new("/nonexistent-cwd"), None);
    assert!(is_excluded(&cfg, Path::new("/x/node_modules")));
    assert!(is_excluded(&cfg, Path::new("/x/.git/config")));
    assert!(!is_excluded(&cfg, Path::new("/x/src/index.ts")));
}

#[test]
fn onmignore_adds_patterns() {
    // write tmp/.onmignore containing "**/dist/**"; load(tmp, None); assert is_excluded(tmp/dist/bundle.js)
}

#[test]
fn favorites_reads_one_path_per_line() {
    // write tmp-home/.onmfavorites with "# comment", blank line, and "/a/b"; assert favorites contains "/a/b" only
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test config::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `config`**

Use `globset::GlobSetBuilder`; add each default exclude via `Glob::new`. Missing files are not errors.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test config::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.rs src/lib.rs
git commit -m "feat: load .onmignore excludes and favorites"
```

---

### Task 5: `scan::size` parallel size and package counts

**Files:**
- Create: `src/scan/mod.rs` (module declarations only), `src/scan/size.rs`
- Modify: `src/lib.rs` (add `pub mod scan;`)

**Interfaces:**
- Consumes: nothing.
- Produces: `scan::size::DirStats { total_size: u64, package_count: u64, total_package_count: u64 }`; `scan::size::dir_stats(dir: &Path) -> io::Result<DirStats>`.

- [ ] **Step 1: Write the failing test**

In `src/scan/size.rs`, build a `tempfile::tempdir()` tree: `node_modules/a/index.js` (10 bytes), `node_modules/b/package.json` (5 bytes), `node_modules/.cache/x` (3 bytes), `node_modules/.bin/y` (2 bytes). Assert `dir_stats` returns `total_size == 20`, `package_count == 2` (a, b), `total_package_count == 2` (hidden and `.bin` excluded). Add a permission-denied case: on Unix, `chmod 0o000` a subdir and assert the call still returns `Ok` with the readable entries counted.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test scan::size::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `dir_stats`**

Walk with `ignore::WalkBuilder` (no hidden filter for counting, but skip entries whose file name starts with `.` or equals `.bin` when counting packages). Accumulate `total_size` from file sizes; `package_count` counts direct children of `dir`; `total_package_count` counts every descendant directory except `dir` itself. Skip and continue on per-entry errors (do not abort).

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test scan::size::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scan/mod.rs src/scan/size.rs src/lib.rs
git commit -m "feat: parallel directory size and package counting"
```

---

### Task 6: `scan::project` metadata enrichment

**Files:**
- Create: `src/scan/project.rs`
- Modify: `src/scan/mod.rs`, `src/lib.rs`

**Interfaces:**
- Consumes: `model::{NodeModulesInfo, size_category, age_category}`, `util::format_relative_time`, `config::Config`.
- Produces: `scan::project::read_package_json(project: &Path) -> Option<(Option<String>, Option<String>)>` returning `(name, version)`; `scan::project::find_repo_root(start: &Path) -> PathBuf`; `scan::project::enrich(nm_path: &Path, cfg: &Config, now: SystemTime) -> io::Result<NodeModulesInfo>`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn enrich_reads_name_version_and_categories() {
    // tempdir with package.json {"name":"demo","version":"2.1.0"} and node_modules/ with one file
    // let info = enrich(&tmp/node_modules, &cfg, SystemTime::now())?;
    // assert info.project_name == "demo", project_version == Some("2.1.0"),
    //        project_path == tmp, size_category == SizeCategory::Small, is_pending == false
}

#[test]
fn enrich_falls_back_to_directory_name_without_package_json() {
    // tempdir named "myproj" with node_modules/, no package.json
    // assert project_name == "myproj", project_version.is_none()
}

#[test]
fn find_repo_root_walks_up_to_dot_git() {
    // tmp/.git dir, tmp/a/b/node_modules -> find_repo_root(&tmp/a/b) == tmp
    // no .git anywhere -> returns start
}

#[test]
fn enrich_marks_favorites() {
    // favorites set contains nm_path -> info.is_favorite == true
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test scan::project::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `read_package_json`, `find_repo_root`, `enrich`**

`read_package_json` parses only `name`/`version` with `serde_json::Value`; invalid or missing file -> `None`. `find_repo_root` ascends to the filesystem root looking for a `.git` entry, returning `start` if none. `enrich` calls `scan::size::dir_stats`, sets `size_category`/`age_category`, and sets `is_favorite` from `cfg.favorites`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test scan::project::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scan/project.rs src/scan/mod.rs src/lib.rs
git commit -m "feat: enrich node_modules with project metadata"
```

---

### Task 7: `scan::discovery` parallel walker with pruning

**Files:**
- Create: `src/scan/discovery.rs`
- Modify: `src/scan/mod.rs`, `src/lib.rs`
- Test: inline `#[cfg(test)]` in `src/scan/discovery.rs`

**Interfaces:**
- Consumes: `config::{Config, is_excluded}`.
- Produces: `scan::discovery::ScanOptions { root: PathBuf, include_hidden: bool, max_depth: Option<usize>, follow_symlinks: bool, exclude: globset::GlobSet }`; `scan::discovery::discover(opts: &ScanOptions, on_found: &(dyn Fn(usize) + Sync + Send)) -> Vec<PathBuf>` returning project-level `node_modules` paths.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn finds_project_level_node_modules_at_depth() {
    // tree: root/a/node_modules, root/a/b/c/node_modules ; both found
}

#[test]
fn prunes_nested_node_modules() {
    // tree: root/app/node_modules/pkg/node_modules -> only root/app/node_modules returned
}

#[test]
fn skips_hidden_dirs_by_default() {
    // root/.hidden/node_modules -> excluded; with include_hidden=true -> included
}

#[test]
fn respects_max_depth() {
    // root/a/b/c/node_modules ; max_depth=Some(2) -> not found ; max_depth=None -> found
}

#[test]
fn does_not_follow_symlinked_dirs() {
    // create target dir with node_modules, symlink root/link -> target
    // assert root/link/node_modules NOT returned (no loops)
}

#[test]
fn continues_past_permission_denied_dir() {
    // unix: chmod 0o000 root/locked, then root/ok/node_modules still returned
}

#[test]
fn handles_deeply_nested_paths() {
    // build 60-level deep path with node_modules at the leaf; assert found, no panic
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test scan::discovery::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `discover`**

Use `ignore::WalkBuilder::new(root)` with `.hidden(!include_hidden)`, `.follow_links(follow_symlinks)`, `.max_depth(max_depth)`, and a `filter_entry` closure that returns `false` for any entry named `node_modules` **and** for any entry matching `is_excluded` — returning `false` from `filter_entry` prunes the whole subtree. Collect directories whose file name is exactly `node_modules`; call `on_found(count)` after each push. Use `.build().into_iter()` and ignore per-entry errors (continue); `follow_symlinks` defaults to `false`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test scan::discovery::`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scan/discovery.rs src/scan/mod.rs src/lib.rs
git commit -m "feat: parallel node_modules discovery with pruning"
```

---

### Task 8: `scan` orchestration

**Files:**
- Modify: `src/scan/mod.rs`, `src/lib.rs`

**Interfaces:**
- Consumes: `scan::discovery`, `scan::project::enrich`, `config::Config`, `model::NodeModulesInfo`.
- Produces: `scan::Phase` (`Discovering`, `Sizing`, `Done`); `scan::ScanProgress { phase: Phase, done: usize, total: usize }`; `scan::ScanOutcome { node_modules: Vec<NodeModulesInfo>, errors: Vec<String> }`; `scan::scan(opts: &discovery::ScanOptions, cfg: &Config, now: SystemTime, on_progress: &(dyn Fn(ScanProgress) + Sync + Send)) -> ScanOutcome`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn scan_enriches_every_target_via_rayon() {
    // fixture with 3 project node_modules of differing sizes
    // assert node_modules.len() == 3, sorted-independent; each size_bytes > 0
}

#[test]
fn scan_reports_errors_without_aborting() {
    // fixture where one project dir is chmod 0o000; assert the other targets are still returned
}

#[test]
fn scan_missing_root_reports_error() {
    // opts.root = "/definitely/not/here" -> outcome.node_modules empty and outcome.errors non-empty
}

#[test]
fn progress_reaches_the_done_phase() {
    // collect ScanProgress into a Mutex<Vec<_>>; assert the last entry has phase == Done
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test scan::scan`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `scan`**

Emit `Discovering` at the start and from `discover`'s callback, `Sizing` with `done/total` as each `rayon` `par_iter` task completes (use an `AtomicUsize`), then `Done`. On a nonexistent root, push a message into `errors` and return. Per-target `enrich` errors are pushed to `errors`, not fatal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test scan::scan`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scan/mod.rs src/lib.rs
git commit -m "feat: orchestrate scan with parallel enrichment and progress"
```

---

### Task 9: `ui::theme` and `ui::report`

**Files:**
- Create: `src/ui/mod.rs`, `src/ui/theme.rs`, `src/ui/report.rs`
- Modify: `src/lib.rs` (add `pub mod ui;`)

**Interfaces:**
- Consumes: `model::{NodeModulesInfo, SizeCategory, AgeCategory}`, `util::format_bytes`, `util::format_relative_time`.
- Produces: `ui::theme::size_color(SizeCategory) -> &'static str` (ansi name), `ui::theme::age_color(AgeCategory) -> &'static str`; `ui::report::print_table(items: &[NodeModulesInfo], limit: usize, now: SystemTime, cwd: &Path)`; `ui::report::to_json(items: &[NodeModulesInfo]) -> Result<String, serde_json::Error>`; `ui::report::summary_line(outcome: &crate::scan::ScanOutcome, now: SystemTime) -> String`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn theme_maps_huge_to_red_and_fresh_to_green() {
    assert_eq!(theme::size_color(SizeCategory::Huge), "red");
    assert_eq!(theme::age_color(AgeCategory::Fresh), "green");
}

#[test]
fn to_json_serializes_an_array_with_path_and_size() {
    // one item -> serde_json::from_str::<serde_json::Value>
    // assert value.is_array(), value[0]["path"] is a string, value[0]["size_bytes"] is a number
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test ui::theme:: ui::report::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement theme and report**

`print_table` prints at most `limit` rows as `[size]  project_name  [age]  repo_path` with `owo_colors` styling from the theme; when `items.len() > limit`, print a `... and N more` line. `summary_line` returns a one-line totals string. `to_json` uses `serde_json::to_string_pretty`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test ui::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/mod.rs src/ui/theme.rs src/ui/report.rs src/lib.rs
git commit -m "feat: add themed reporting and JSON output"
```

---

### Task 10: `delete::safety`

**Files:**
- Create: `src/delete/mod.rs` (module declarations only), `src/delete/safety.rs`
- Modify: `src/lib.rs` (add `pub mod delete;`)

**Interfaces:**
- Consumes: `util`, `config`.
- Produces: `delete::safety::SafetyCheck` enum (`Ok`, `NotNodeModules`, `Missing`, `NotValid`, `InUse`); `delete::safety::verify_nm(path: &Path) -> bool`; `delete::safety::is_in_use(project: &Path, now: SystemTime) -> bool`; `delete::safety::check(path: &Path, check_in_use: bool, now: SystemTime) -> SafetyCheck`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn verify_accepts_real_node_modules_with_subdir() { /* tmp/node_modules/react/ -> true */ }

#[test]
fn verify_accepts_empty_node_modules_when_parent_has_package_json() {
    // tmp/package.json exists, tmp/node_modules empty -> verify_nm == true
}

#[test]
fn verify_rejects_fake_directory() {
    // tmp/not_node_modules/ empty, tmp has no package.json -> false
}

#[test]
fn check_flags_wrong_name() {
    // check(tmp/foo) == SafetyCheck::NotNodeModules
}

#[test]
fn check_flags_missing_path() { /* check(tmp/node_modules) when absent -> Missing */ }

#[test]
fn check_flags_in_use_from_recent_lockfile() {
    // tmp/package-lock.json mtime = now -> is_in_use true, check(..., true, now) == InUse
}

#[test]
fn check_rejects_node_modules_that_is_a_symlink() {
    // root/node_modules -> symlink to elsewhere; assert check(..., false, now) != Ok
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test delete::safety::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `safety`**

`verify_nm`: `path.file_name() == "node_modules"`, path exists and is a real directory (not a symlink: use `symlink_metadata().is_dir()`), and (has >=1 child directory **or** parent has `package.json`). `is_in_use`: any of the three lockfiles in `project` with mtime within 60 s of `now`. `check` runs name -> existence -> in-use (when requested) -> `verify_nm` in that order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test delete::safety::`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/delete/mod.rs src/delete/safety.rs src/lib.rs
git commit -m "feat: add deletion safety verification and in-use checks"
```

---

### Task 11: `delete::remove` removal with force fallbacks

**Files:**
- Create: `src/delete/remove.rs`
- Modify: `src/delete/mod.rs`, `src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `delete::remove::remove_fast(path: &Path) -> io::Result<()>`; `delete::remove::remove_forced(path: &Path) -> io::Result<()>`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn remove_fast_deletes_a_tree() { /* tmp/node_modules with nested files -> gone, Ok */ }

#[test]
fn remove_forced_deletes_readonly_file() {
    // tmp/nm/readonly.txt chmod 0o444 (unix); remove_forced -> gone
}

#[test]
fn remove_forced_falls_back_to_rename() {
    // simulate a directory that refuses removal, assert remove_forced returns Ok OR the path no longer exists
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test delete::remove::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `remove_fast` and `remove_forced`**

`remove_fast` wraps `std::fs::remove_dir_all`. `remove_forced`: try `remove_fast`; on error, recursively `set_permissions(0o777)` (Unix) then retry; on error, rename to `<path>.old.<unix_ms>` then `remove_dir_all` the renamed path. Add the `remove_dir_all` crate if `std::fs::remove_dir_all` proves unreliable on Windows CI; otherwise use std.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test delete::remove::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/delete/remove.rs src/delete/mod.rs src/lib.rs
git commit -m "feat: fast and forced directory removal"
```

---

### Task 12: `delete` parallel orchestration

**Files:**
- Modify: `src/delete/mod.rs`, `src/lib.rs`

**Interfaces:**
- Consumes: `delete::safety`, `delete::remove`, `model::NodeModulesInfo`, `util::format_bytes`.
- Produces: `delete::DeleteOptions { dry_run: bool, force: bool, check_in_use: bool }`; `delete::DeletionDetail { path: PathBuf, project_name: String, size_bytes: u64, success: bool, error: Option<String>, duration_ms: u64 }` (derive `Serialize`); `delete::DeletionResult { total_attempted: usize, successful: usize, failed: usize, bytes_freed: u64, details: Vec<DeletionDetail> }` (derive `Serialize`) with method `formatted_bytes_freed(&self) -> String`; `delete::delete_selected(items: &[&NodeModulesInfo], opts: &DeleteOptions, now: SystemTime, on_progress: &(dyn Fn(usize, usize) + Sync + Send)) -> DeletionResult`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn dry_run_deletes_nothing_and_reports_sizes() {
    // 2 real targets; opts.dry_run = true -> both success, bytes_freed == sum, dirs still exist
}

#[test]
fn deletes_multiple_targets_and_tallies_bytes() {
    // 2 real targets -> successful == 2, dirs gone
}

#[test]
fn failing_target_does_not_abort_batch() {
    // 1 valid + 1 fake (wrong name) -> successful == 1, failed == 1, error set on the fake
}

#[test]
fn progress_callback_is_called_once_per_target() { /* counter == items.len() */ }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test delete::delete_selected`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `delete_selected`**

Run `check` per target; map failures to `DeletionDetail { success: false, error: Some(...) }`. On `Ok`, if `dry_run` succeed without touching the filesystem; else call `remove_fast` or `remove_forced` (when `opts.force`). Execute targets with `rayon` `par_iter`, aggregate counts and `bytes_freed` (only for successes), and call `on_progress(done, total)` after each. Record `duration_ms` per target.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test delete::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/delete/mod.rs src/lib.rs
git commit -m "feat: parallel deletion orchestration with per-target results"
```

---

### Task 13: `ui::progress`, `ui::picker`, and interactive mode

**Files:**
- Create: `src/ui/progress.rs`, `src/ui/picker.rs`
- Modify: `src/ui/mod.rs`, `src/lib.rs`, `src/cli.rs`

**Interfaces:**
- Consumes: `scan`, `delete`, `ui::report`, `ui::theme`, `model`.
- Produces: `ui::progress::ScanSpinner` with `new() -> Self`, `update(&self, ScanProgress)`, `finish(&self, &str)`; `ui::picker::sort_items(items: &mut Vec<NodeModulesInfo>, sort: SortArg, ascending: bool)`; `ui::picker::pick(items: &[NodeModulesInfo]) -> Option<Vec<usize>>`; `ui::picker::confirm(message: &str) -> bool`; `cli::SortArg` gains `sort_items` support and `cli::run` implements the interactive flow.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn sort_items_by_size_respects_direction() {
    // 3 items, sizes 1,2,3 -> sort Size descending => [3,2,1]; ascending => [1,2,3]
}

#[test]
fn sort_items_by_name_is_case_insensitive() {
    // names "beta","Alpha","gamma" -> name ascending => Alpha,beta,gamma
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test ui::picker::`
Expected: FAIL to compile.

- [ ] **Step 3: Implement progress, picker, and wire interactive mode**

`ScanSpinner` wraps `indicatif::ProgressBar` with a spinner style. `sort_items` switches on `SortArg` and `ascending` and sorts in place. `pick` builds `inquire::MultiSelect` options formatted by `ui::theme`/`util` (pre-deselecting favorites), returns chosen indices or `None` on cancel. `confirm` wraps `inquire::Confirm`. In `cli::run`, when neither `--scan` nor `--auto` is set, run: scan with `ScanSpinner`, sort by size desc, print `summary_line`, `pick`, then `confirm("Delete N directories (X)?" )`, then `delete_selected` with a delete spinner, then print per-item failures and total freed. Add these steps only to the non-`--json`, non-interactive-free path.

- [ ] **Step 4: Run tests to verify they pass and manually smoke-test**

Run: `cargo test ui::picker::`
Expected: PASS.
Run: `cargo run -- .` in a directory containing a `node_modules` and confirm the spinner, picker, and confirm prompts render and cancellation exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/ui/progress.rs src/ui/picker.rs src/ui/mod.rs src/lib.rs src/cli.rs
git commit -m "feat: interactive picker, spinners, and delete flow"
```

---

### Task 14: Non-interactive modes (`--scan`, `--json`, `--auto`)

**Files:**
- Modify: `src/cli.rs`
- Test: `tests/cli.rs`

**Interfaces:**
- Consumes: everything above.
- Produces: `cli::run` behavior for `--scan`, `--scan --json`, and `--auto`; exit codes (0 success, 1 error).

- [ ] **Step 1: Write the failing integration tests**

Add to `tests/cli.rs` a fixture helper `fn fixture() -> TempDir` that builds `root/pkgA/node_modules/a/f.js`, `root/pkgB/node_modules/b/g.js`, and `root/empty-parent/node_modules` (empty).

```rust
#[test]
fn scan_json_emits_an_array_of_projects() { /* onm --scan --json <fixture>; parse stdout as JSON array; assert len >= 2 */ }

#[test]
fn scan_table_prints_totals() { /* onm --scan <fixture>; stdout contains "Total" */ }

#[test]
fn auto_dry_run_deletes_nothing() {
    // onm --auto --dry-run --yes <fixture>; assert exit success and both node_modules still on disk
}

#[test]
fn auto_with_min_size_skips_small_targets() {
    // onm --auto --min-size 1gb --dry-run --yes <fixture>; stdout says nothing matched
}

#[test]
fn invalid_min_size_exits_nonzero() {
    // onm --auto --min-size banana <fixture>; assert failure and stderr mentions the value
}

#[test]
fn nonexistent_root_exits_nonzero() {
    // onm --scan /definitely/not/here; assert failure
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test cli`
Expected: FAIL (modes not implemented).

- [ ] **Step 3: Implement the three modes in `cli::run`**

`--scan` prints the table then a `Total` line; with `--json` prints `ui::report::to_json`. `--auto` applies `util::parse_size` to `--min-size` (invalid -> print an error and return `ExitCode::FAILURE`), selects matching items, prints a `[DRY RUN]` header plus the list, and — unless `--dry-run` — requires `--yes` or a `confirm` before deleting, then prints the JSON or human result. Nonexistent root exits `FAILURE` with a colored error.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --test cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.rs tests/cli.rs
git commit -m "feat: non-interactive scan, json, and auto-delete modes"
```

---

### Task 15: CI, release workflow, and documentation migration

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `README.md`, `AGENTS.md`, `CHANGELOG.md`, `.gitignore`
- Delete: `.github/workflows/release.yml` (the old npm one) — replaced by the new Rust one

**Interfaces:**
- Consumes: the whole crate.
- Produces: reproducible CI and a tag-triggered release; docs describing the Rust tool.

- [ ] **Step 1: Add the CI workflow**

`.github/workflows/ci.yml`: `on: [push, pull_request]`, matrix `os: [ubuntu-latest, macos-latest, windows-latest]`, steps checkout -> `dtolnay/rust-toolchain@stable` with `components: rustfmt, clippy` -> `cargo fmt --check` -> `cargo clippy --all-targets -- -D warnings` -> `cargo test` -> `cargo build --release`.

- [ ] **Step 2: Add the release workflow**

`.github/workflows/release.yml`: `on: push: tags: ["v*"]`. A build job per target (linux x86_64 gnu, macos x86_64 + aarch64, windows x86_64) producing `onm` archives, uploaded to a GitHub Release via `softprops/action-gh-release@v2`. A publish job running `cargo publish` with `CARGO_REGISTRY_TOKEN` from secrets, gated on the tag matching `Cargo.toml` version.

- [ ] **Step 3: Rewrite README and AGENTS for Rust**

README: installation via `cargo install --path .` / prebuilt binaries, usage for all four modes, the shared flags, and a short "how it works" (parallel discovery/size/delete). AGENTS: build/test/lint commands (`cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo build --release`), the module map from Section 1 of the spec, and the Code Style constraints from Global Constraints. Append a `0.1.0` entry to `CHANGELOG.md` noting the Rust rewrite. Keep the tone factual; no marketing language.

- [ ] **Step 4: Verify the full project**

Run: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo build --release`
Expected: all clean/pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: add rust ci and release workflows; document the rewrite"
```

---

## Self-Review

- **Spec coverage:** distribution (Task 1 removes npm, Task 15 cargo publish) — yes; interface modes (Tasks 13-14) — yes; data model + thresholds (Task 3) — yes; scan semantics incl. pruning/hidden/max-depth/excludes/favorites (Tasks 4, 7) — yes; size + package counts (Task 5) — yes; package.json/repo root/categories (Task 6) — yes; deletion + safety + fallbacks + parallel (Tasks 10-12) — yes; colors/spinners/picker (Tasks 2, 9, 13) — yes; enable filtering in picker (`inquire` built-in, Task 13) — yes; in-use detection (Task 10) — yes; JSON (Tasks 9, 14) — yes; tests/CI/build (15) — yes.
- **Placeholder scan:** no TBD/TODO; the one deferral (crates.io name) is resolved to `oh-my-node-modules` in Global Constraints.
- **Type consistency:** `NodeModulesInfo` field names, `ScanOptions`, `ScanProgress`, `DeletionResult`, and `SortArg` are used with the same names across Tasks 3-14.
- **Review Focus:** item 1 -> Tasks 7 + 10 tests; item 2 -> Tasks 7 + 8 tests; item 3 -> Task 10 tests; item 4 -> Tasks 8 + 14 tests; item 5 -> Tasks 2 + 7 tests.
- **Proportion:** test bodies and exact values are given; implementation bodies are left to signatures.
