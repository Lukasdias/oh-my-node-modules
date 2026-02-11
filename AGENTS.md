# AGENTS.md - oh-my-node-modules

Architecture overview and development guide for AI assistants working on this codebase.

## Overview

**oh-my-node-modules** is a TUI CLI tool for visualizing and cleaning up node_modules directories. It combines:
- **Ink**: React-based terminal UI framework
- **@clack/prompts**: Interactive prompts for CLI mode
- **TypeScript**: Type-safe development

## Project Structure

```
src/
├── types.ts          # Core type definitions (interfaces, types, constants)
├── utils.ts          # Pure utility functions (formatting, sorting, filtering)
├── scanner.ts        # Discovery and analysis logic
├── deletion.ts       # Safe deletion operations
├── components/       
│   └── index.tsx     # Ink UI components (Header, List, Footer, etc.)
├── app.tsx           # Main application component with state management
├── cli.tsx           # CLI entry point and argument parsing
└── index.ts          # Public API exports
```

## Key Concepts

### Data Flow

```
Scanner → NodeModulesInfo[] → State → Components → Render
                ↓
          Utils (sort/filter)
```

1. **Scanner** discovers node_modules and creates `NodeModulesInfo` objects
2. **State** (React hooks) holds the current application state
3. **Utils** provide pure functions for sorting, filtering, formatting
4. **Components** render the UI based on state
5. **User Input** updates state, triggering re-render

### Core Types

**NodeModulesInfo**: Central data structure representing a node_modules directory
```typescript
interface NodeModulesInfo {
  path: string;              // Absolute path
  projectPath: string;       // Parent project path
  projectName: string;       // From package.json or directory name
  sizeBytes: number;         // Total size
  sizeFormatted: string;     // Human readable
  packageCount: number;      // Top-level packages
  totalPackageCount: number; // All packages (nested)
  lastModified: Date;
  lastModifiedFormatted: string;
  selected: boolean;         // For deletion
  isFavorite: boolean;       // Never suggest deleting
  ageCategory: AgeCategory;  // 'fresh' | 'recent' | 'old' | 'stale'
  sizeCategory: SizeCategory; // 'small' | 'medium' | 'large' | 'huge'
}
```

### State Management

The app uses React hooks for state management:

```typescript
const [state, setState] = useState<AppState>({
  nodeModules: [],           // All discovered items
  selectedIndex: 0,          // Current focus
  sortBy: 'size-desc',       // Current sort
  filterQuery: '',           // Search filter
  isScanning: false,
  isDeleting: false,
  scanProgress: 0,
  sessionBytesReclaimed: 0,
  showHelp: false,
});
```

State updates are **immutable** - always create new objects/arrays.

### Keyboard Handling

Input is handled via Ink's `useInput` hook:

```typescript
useInput((input, key) => {
  if (key.upArrow) navigateUp();
  if (input === 'd') promptDelete();
  // ... etc
});
```

**Key Design**: Input handlers check UI state first (help, confirm dialogs) to ensure proper modal behavior.

## Common Tasks

### Adding a New Sort Option

1. Add to `SortOption` type in `types.ts`
2. Add sort logic in `sortNodeModules()` in `utils.ts`
3. Add label in `getSortLabel()` in `components/index.tsx`

### Adding a New Filter

1. Create filter function in `utils.ts`
2. Add keyboard shortcut in `app.tsx` `useInput`
3. Update help text in `Help` component

### Adding a New Keyboard Shortcut

1. Add handler in `app.tsx` `useInput`
2. Update `Footer` component to show shortcut
3. Update `Help` component with documentation

### Modifying the Scanner

Scanner is in `scanner.ts`. Key functions:
- `scanForNodeModules()`: Main entry point
- `analyzeNodeModules()`: Detailed analysis of single node_modules
- `calculateDirectorySize()`: Recursive size calculation

Scanner is **async** and reports progress via callback.

### Modifying Deletion Logic

Deletion is in `deletion.ts`. Key functions:
- `deleteSelectedNodeModules()`: Main entry point
- `deleteNodeModules()`: Single deletion with safety checks
- `verifyNodeModules()`: Validates before deletion

Safety checks:
1. Path ends with 'node_modules'
2. Directory exists
3. Not in use (if check enabled)
4. Looks like valid node_modules

## Architecture Patterns

### Pure Functions

Utility functions in `utils.ts` are pure (no side effects):
```typescript
// Good: returns new array, doesn't mutate
export function sortNodeModules(items: NodeModulesInfo[], sortBy: SortOption): NodeModulesInfo[] {
  return [...items].sort(/* ... */);
}
```

### Immutable Updates

State updates always create new objects:
```typescript
setState(prev => ({
  ...prev,
  nodeModules: prev.nodeModules.map(item => 
    item.path === targetPath ? { ...item, selected: true } : item
  ),
}));
```

### Async Operations

Long-running operations (scan, delete) use async/await:
```typescript
const result = await scanForNodeModules(options, onProgress);
```

Progress callbacks keep UI responsive.

### Error Handling

Errors are caught and displayed in the UI:
```typescript
try {
  await operation();
} catch (error) {
  setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
}
```

## Performance Considerations

1. **Virtual Scrolling**: List component only renders visible items
2. **Memoization**: `useMemo` for expensive calculations (statistics, sorting)
3. **Debouncing**: Progress updates batched to avoid re-render storms
4. **Lazy Loading**: Scanner yields control periodically

## Testing

Tests use Vitest. Run with:
```bash
npm test
```

Test pure functions in `utils.ts` directly. For components, use Ink's testing utilities.

## Code Style

- **TypeScript strict mode**: No `any`, proper null checks
- **Named exports**: Prefer `export function` over default exports
- **JSDoc comments**: Explain "why" not just "what"
- **File extensions**: Use `.js` in imports (ESM requirement)

## Build & Publish

```bash
# Build
npm run build

# Test
npm run test:run

# Type check
npm run typecheck

# Publish
npm run prepublishOnly
npm publish
```

## Dependencies

**Runtime:**
- `ink`: React for terminals
- `@clack/prompts`: Interactive prompts
- `zod`: Runtime validation
- `react`: Peer dependency

**Development:**
- `typescript`: Type checking
- `bunchee`: Building
- `vitest`: Testing
- `@types/*`: Type definitions

## CLI Modes

The app supports three modes:

1. **Interactive TUI** (default): Full Ink-based UI with keyboard navigation
2. **Quick Scan** (`--scan`): Non-interactive summary report
3. **Auto Delete** (`--auto`): Non-interactive batch deletion

Mode is determined by CLI arguments in `cli.tsx`.

## Safety Features

1. **Path verification**: Must end with 'node_modules'
2. **In-use detection**: Checks for lock files
3. **Confirmation**: Required unless `--yes`
4. **Dry run**: `--dry-run` simulates without deleting
5. **Favorites**: Projects in `~/.onmfavorites` are protected

## Cross-Platform Support

- Uses Node.js `fs.promises` for file operations
- Uses `path.join` for path manipulation
- Avoids platform-specific features
- Works on macOS, Linux, Windows (WSL)

## Questions?

- Check `README.md` for user documentation
- Check this file for architecture questions
- Look at existing code for patterns
