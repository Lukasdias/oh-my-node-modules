# Changelog

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
