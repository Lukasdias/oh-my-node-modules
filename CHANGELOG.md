# Changelog

## 0.1.0 (2026-10-11)

Rust rewrite. The TypeScript/Bun implementation is replaced by a single Rust
crate (`oh-my-node-modules`) providing the `onm` binary. Versioning restarts at
`0.1.0`; previous npm releases are listed below.

### Added

- Parallel discovery of project-level `node_modules` using the `ignore` walker,
  pruning nested `node_modules` and skipping hidden directories by default.
- Per-directory size, recursive package-count, `package.json` metadata, and Git
  root resolution, fanned out in parallel with `rayon` across targets.
- Parallel deletion orchestration with `rayon`, a fast `remove_dir_all` path,
  and `--force` fallbacks (recursive permission fix, then rename-and-remove).
- Safety checks before deletion: normalized path must end in `node_modules`, the
  directory must exist, it must contain a subdirectory or its parent must hold
  `package.json`, and an in-use lockfile check (`--no-check` to skip).
- Prompt-based interactive CLI (`inquire`) with colored sizes and ages
  (`owo-colors`) and scan/deletion spinners (`indicatif`).
- Non-interactive modes: `--scan` colored table, `--json` output, and
  `--auto --min-size <size>` batch deletion with `--dry-run`/`--yes`.
- `.onmignore` exclude patterns and `.onmfavorites` favorites.
- CI matrix (Linux/macOS/Windows) and a tag-triggered release workflow building
  prebuilt binaries and publishing to crates.io.

### Changed

- Distribution moves from npm to crates.io and prebuilt GitHub Release binaries.

## 1.2.1 (2026-02-12)

### 🔧 Infrastructure

- **Security improvement:** Remove NODE_AUTH_TOKEN - use OIDC trusted publishers instead
  - Migrated from long-lived NPM tokens to OIDC-based authentication
  - Uses short-lived credentials generated during CI/CD workflows
  - Improved security posture for package publishing

## 1.2.0 (2026-02-12)

### ♻️ Refactoring

- **Major architectural change:** Replace Ink/React with @clack/prompts + commander
  - Migrated from React-based TUI to simpler CLI prompts
  - Simplified UI components using @clack/prompts for interactive elements
  - Added commander.js for CLI argument parsing

### 🔧 Chores

- Regenerate package-lock.json with compatible react-devtools-core
- Use Bun instead of Node.js in release workflow
- Remove package-lock (using Bun)

## 1.1.1

*Changes since v1.1.0*

### ✨ New Features

- export public API
  - Export all core types and interfaces
- add CLI entry point with argument parsing
  - Implement parseArgs for command-line options
- implement main App component with state management
  - Add React hooks for state management
- create Ink TUI components
  - Add Header component with statistics and progress
- add safe deletion operations
  - Implement deleteSelectedNodeModules with progress tracking
- implement scanner for discovering node_modules
  - Add recursive directory traversal with progress callbacks
- add utility functions for formatting and data manipulation
  - Implement formatBytes for human-readable sizes
- add core type definitions and interfaces
  - Define NodeModulesInfo interface with all metadata fields

### 📚 Documentation

- add README and AGENTS.md documentation
  - Add comprehensive README with usage examples

### ✅ Tests

- add comprehensive test suite
  - Add 33 tests for utility functions

### 🔧 Chores

- bump version to v1.1.1
- remove package-lock
- add initial changelog with new features and documentation
- bump version to v1.1.0
- update dependencies and add tests
- add package-lock.json
  - Lockfile for reproducible dependency installation
- initial project setup with TypeScript and build tooling
  - Add package.json with dependencies (ink, react, @clack/prompts)
