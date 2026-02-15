# AGENTS.md - oh-my-node-modules

Guidelines for AI assistants working on this codebase.

## Build & Development Commands

```bash
# Development
bun run dev              # Watch mode with hot reload
bun run start            # Run compiled version

# Building
bun run build            # Build to dist/ (ESM + types)
bun run clean            # Remove dist/

# Testing (Bun native test runner)
bun test                 # Run all tests
bun test --watch         # Watch mode
bun test <pattern>       # Run single test file (e.g., bun test utils)

# Type Checking & Linting
bun run typecheck        # TypeScript strict mode check
bun run lint             # Alias for typecheck
```

## Code Style Guidelines

### TypeScript
- **Strict mode**: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` enabled
- **No `any`**: Use proper types or `unknown` with type guards
- **Explicit returns**: Always define return types on exported functions
- **Unused variables**: Compiler errors on unused locals/parameters

### Imports
```typescript
// ESM requires .js extensions
import { foo } from './utils.js';
import type { Bar } from './types.js';

// Node built-ins (no extension)
import { promises as fs } from 'fs';
import { join } from 'path';

// External packages (no extension)
import { fdir } from 'fdir';
import pLimit from 'p-limit';
```

### Naming Conventions
- **Files**: kebab-case (`size-worker.ts`, `utils.ts`)
- **Functions**: camelCase (`calculateSize`, `formatBytes`)
- **Types/Interfaces**: PascalCase (`NodeModulesInfo`, `ScanOptions`)
- **Constants**: UPPER_SNAKE_CASE for true constants (`SIZE_THRESHOLDS`)
- **Boolean props**: Prefix with verb (`isPending`, `hasNodeModules`)

### Function Patterns
```typescript
// Pure functions preferred (no side effects)
export function sortNodeModules(
  items: NodeModulesInfo[], 
  sortBy: SortOption
): NodeModulesInfo[] {
  return [...items].sort(/* ... */);  // Immutable - return new array
}

// Async with proper error handling
export async function analyzeNodeModules(
  path: string
): Promise<NodeModulesInfo> {
  try {
    const stats = await fs.stat(path);
    return { /* ... */ };
  } catch (error) {
    throw new Error(`Failed to analyze ${path}: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}
```

### Error Handling
```typescript
// Always wrap error messages with context
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`Error analyzing ${path}: ${message}`);
}

// Never suppress errors silently
// Bad: catch (e) { }
// Good: catch (e) { logError(e); throw e; }
```

### State Management (React/Ink)
```typescript
// Immutable updates only
setState(prev => ({
  ...prev,
  nodeModules: prev.nodeModules.map(item => 
    item.path === targetPath ? { ...item, selected: true } : item
  ),
}));

// Never mutate state directly
// Bad: state.nodeModules[0].selected = true;
```

## Project Structure

```
src/
├── types.ts           # All TypeScript interfaces, types, constants
├── utils.ts           # Pure utility functions (testable, no side effects)
├── scanner.ts         # Directory discovery (uses fdir for speed)
├── size-worker.ts     # Worker threads for parallel size calculation
├── deletion.ts        # Safe deletion logic with verification
├── cli.tsx            # CLI entry point, argument parsing
├── app.tsx            # Ink TUI app with React state
├── components/        # React/Ink UI components
│   └── index.tsx
└── index.ts           # Public API exports

tests/
├── utils.test.ts      # Unit tests for pure functions
├── scanner.test.ts    # Scanner integration tests
└── deletion.test.ts   # Deletion logic tests
```

## Testing Guidelines

```typescript
import { describe, it, expect } from 'bun:test';

describe('feature', () => {
  it('does something specific', () => {
    const result = functionToTest(input);
    expect(result).toBe(expected);
    expect(result).toHaveLength(2);
    expect(result.map(i => i.name)).toContain('item');
  });
});
```

- Test pure functions in `utils.ts` directly
- Use temp directories in `tmpdir()` for file system tests
- Clean up temp files in `afterEach`
- Mock external dependencies, test logic in isolation

## Performance Patterns

### Fast Directory Operations
```typescript
// Use fdir for discovery (1M files in <1s)
import { fdir } from 'fdir';

const crawler = new fdir()
  .withDirs()
  .withFullPaths()
  .filter((path, isDirectory) => basename(path) === 'node_modules')
  .crawl(rootPath);

const paths = await crawler.withPromise();
```

### Parallel Processing
```typescript
// Use worker threads for CPU-intensive work
import { calculateSizeWithWorker } from './size-worker.js';

// Use p-limit for controlled concurrency
import pLimit from 'p-limit';
const limit = pLimit(8);  // 8 concurrent on Windows, 4 on Unix

const results = await Promise.all(
  items.map(item => limit(() => processItem(item)))
);
```

### Platform-Specific Concurrency
```typescript
const CONCURRENCY = process.platform === 'win32' ? 8 : 4;
```

## Key Dependencies

- **fdir**: Ultra-fast directory crawling (replaces manual BFS)
- **p-limit**: Concurrency limiting for parallel operations
- **@clack/prompts**: Interactive CLI prompts
- **commander**: CLI argument parsing
- **picocolors**: Terminal colors
- **zod**: Runtime type validation

## Common Tasks

### Adding a New Feature
1. Add types to `types.ts`
2. Implement logic in appropriate module (scanner/utils/deletion)
3. Add tests in `tests/<module>.test.ts`
4. Update CLI in `cli.tsx` if user-facing
5. Run `bun run typecheck && bun test`

### Modifying the Scanner
- Discovery: Use `fdir` (already implemented)
- Size calculation: Use `calculateSizeWithWorker()`
- Progress: Call `onProgress(percent, count)` periodically
- Filters: Apply in fdir filter or post-discovery

### Error Messages
Include context for debugging:
```typescript
// Good
`Error analyzing ${path}: ${message}`

// Bad
'Analysis failed'
```

## Constraints

- **No shell commands on Windows**: Avoid `exec('dir /s')` - use worker threads
- **ESM only**: Always use `.js` extensions in imports
- **Node 20+**: Use modern APIs (fs.promises, etc.)
- **Cross-platform**: Test paths work on Windows (`\\`) and Unix (`/`)
- **Strict TypeScript**: Zero tolerance for `any` or unchecked nulls

## Before Submitting

```bash
bun run typecheck        # Must pass
bun test                 # All tests must pass
bun run build            # Must compile without errors
```
