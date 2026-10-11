# oh-my-node-modules

Find and delete `node_modules` directories to reclaim disk space.

Crate: `oh-my-node-modules`. Binary: `onm`.

## Installation

Requires a Rust toolchain (1.85 or newer).

```bash
cargo install --path .
```

Prebuilt `onm` binaries are attached to each tagged release on the
[releases page](https://github.com/Lukasdias/oh-my-node-modules/releases):

- `onm-x86_64-unknown-linux-gnu.tar.gz`
- `onm-x86_64-apple-darwin.tar.gz`
- `onm-aarch64-apple-darwin.tar.gz`
- `onm-x86_64-pc-windows-msvc.zip`

## Usage

`onm [path]` scans `path` (default: the current directory) for project-level
`node_modules` directories. Nested `node_modules` inside another `node_modules`
are pruned, so only top-level dependency trees are reported. Hidden directories
are skipped unless `--hidden` is given.

### Interactive mode (default)

```bash
onm .            # Scan the current directory and pick interactively
onm ~/projects   # Scan a specific directory
```

The scan and size passes run behind spinners. A summary line reports the total
size, project count, and stale count. An `inquire` multi-select then lists one
row per directory as `[size]  project  [age]  repo_path`, with size and age
color-coded. Toggle entries with space, confirm with enter, and filter the list
by typing. Entries in `.onmfavorites` start deselected. After selection, a
confirm prompt reports how many directories and how many bytes will be deleted.

### Report mode

```bash
onm --scan .           # Colored table (top 20) plus a total
onm --scan --json .    # JSON array of projects on stdout
onm --json .           # Same as `--scan --json`
```

`--json` writes a single JSON document to stdout; human-readable headers and
previews move to stderr so the output stays parseable.

### Auto mode

```bash
onm --auto --min-size 500mb .            # Delete every matching directory
onm --auto --min-size 1gb --dry-run .    # Preview only
onm --auto --min-size 500mb --yes .      # Skip the confirmation prompt
```

`--auto` selects every scanned directory at or above `--min-size` and deletes
them without the picker. Without `--yes` it asks for confirmation first;
`--dry-run` reports what would be deleted and frees nothing.

### Shared flags

| Flag | Effect |
|---|---|
| `--sort size\|date\|name\|packages` | Sort key (default `size`) |
| `--asc` | Ascending order (default: descending) |
| `--max-depth N` | Limit directory descent depth |
| `--hidden` | Include hidden directories |
| `--dry-run` | Report without deleting |
| `--force` | Enable the removal fallbacks described below |
| `--yes` | Skip the confirmation prompt |
| `--no-check` | Skip the in-use lockfile check |

## Configuration

- `.onmignore` in the current directory and in the home directory adds glob
  patterns to skip during discovery. Blank lines and `#` comments are ignored.
  Defaults (`**/node_modules/**`, `**/.git/**`) are always applied. An
  `.onmignore` pattern cannot exclude a `node_modules` directory by name
  directly; exclude its parent directory instead (e.g. `**/legacy/**`).
- `.onmfavorites` in the home directory lists one absolute path per line. Those
  entries are marked as favorites and start deselected in the picker.

## Safety checks

Before removing a directory, `onm` checks that the normalized path ends in
`node_modules`, that the directory exists, and that it contains at least one
subdirectory or that its parent holds a `package.json`. Unless `--no-check` is
given, it also flags a target as in use when a lockfile (`package-lock.json`,
`yarn.lock`, or `pnpm-lock.yaml`) in the project was modified within the last
60 seconds.

Removal uses `remove_dir_all` first. With `--force`, a failure triggers a
recursive permission fix and a retry, then a rename to `<path>.old.<timestamp>`
followed by removal.

## How it works

- Discovery uses the `ignore` walker in parallel; `node_modules` subtrees are
  pruned and `.onmignore` patterns are applied through `globset`.
- Sizes, recursive package counts, `package.json` metadata, and Git repository
  roots are computed per directory, then fanned out in parallel with `rayon`
  across targets.
- Deletion is parallelized across targets with `rayon`. Each target's failure is
  recorded per item; a batch never aborts early.

## Development

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
```

## Repository

https://github.com/Lukasdias/oh-my-node-modules

## License

MIT
