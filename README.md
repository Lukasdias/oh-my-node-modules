# oh-my-node-modules

Visualize, analyze, and clean up node_modules directories to reclaim disk space.

## Quick Start

```bash
# Install globally
npm install -g oh-my-node-modules

# Or use with npx
npx oh-my-node-modules

# Start interactive TUI
onm

# Quick scan report
onm --scan

# Delete all >1GB node_modules
onm --auto --min-size 1gb --yes
```

## Features

- **Interactive TUI**: Full terminal UI with keyboard navigation
- **Size Visualization**: Color-coded sizes (red >1GB, yellow >500MB)
- **Smart Selection**: Multi-select, select all, invert, select by size
- **Safe Deletion**: Confirmation prompts, dry-run mode, in-use detection
- **Filtering**: Search and filter projects by name or path
- **Progress Tracking**: Visual feedback during scan and delete operations

## Usage

### Interactive Mode (Default)

```bash
onm                    # Start in current directory
onm ~/projects         # Scan specific directory
```

Keyboard shortcuts:
- `↑/↓` - Navigate
- `Space` - Toggle selection
- `d` - Delete selected
- `a` - Select all
- `s` - Change sort
- `f` - Filter
- `q` - Quit
- `?` - Help

### CLI Mode

```bash
# Quick scan and report
onm --scan

# JSON output
onm --scan --json

# Auto-delete with filters
onm --auto --min-size 500mb --yes
onm --auto --dry-run  # Preview only
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Type check
npm run typecheck

# Dev mode (watch)
npm run dev
```

See [AGENTS.md](./AGENTS.md) for architecture documentation.

## License

MIT
