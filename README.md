# oh-my-node-modules

Find and clean up node_modules directories to free disk space.

## Install

```bash
# With Bun
bun install -g oh-my-node-modules

# With npm
npm install -g oh-my-node-modules
```

## Usage

### Interactive mode

```bash
onm .                  # Start in current directory
onm ~/projects         # Scan specific directory
```

Keyboard shortcuts:
- `↑/↓` - Navigate
- `Space` - Toggle selection
- `d` - Delete selected
- `a` - Select all
- `n` - Deselect all
- `i` - Invert selection
- `s` - Change sort
- `f` - Filter
- `q` - Quit
- `?` - Help

### CLI mode

```bash
# Quick scan report
onm --scan .

# JSON output
onm --scan --json .

# Auto-delete large node_modules
onm --auto --min-size 500mb --yes .

# Preview what would be deleted
onm --auto --min-size 1gb --dry-run .
```

## Features

- **Fast scanning** - Parallel directory traversal with native system commands
- Interactive terminal UI
- Color-coded sizes (red >1GB, yellow >500MB)
- Multi-select with keyboard shortcuts
- Safe deletion with dry-run mode
- Filter by project name or path
- Shows last modified date

## Performance

oh-my-node-modules uses multiple optimization strategies for speed:

1. **Parallel scanning** - Multiple directories scanned concurrently
2. **Native size calculation** - Uses `du` (Unix) or `dir` (Windows) for fast size calculation
3. **Lazy loading** - Shows results immediately while calculating sizes in background
4. **Worker threads** - CPU-intensive operations run in parallel without blocking

## Development

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run build
bun test
bun run dev    # Watch mode
```

The built output works with both Bun and Node.js.

## Repository

https://github.com/Lukasdias/oh-my-node-modules

## Architecture

See [AGENTS.md](./AGENTS.md) for codebase documentation.

## License

MIT
