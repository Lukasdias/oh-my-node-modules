/**
 * oh-my-node-modules - Public API
 * 
 * This module exports the public API for programmatic use.
 * Most users will use the CLI, but the API is available for
 * integration with other tools.
 * 
 * @example
 * ```typescript
 * import { scanForNodeModules, deleteSelectedNodeModules } from 'oh-my-node-modules';
 * 
 * const result = await scanForNodeModules({
 *   rootPath: '/path/to/projects',
 *   excludePatterns: [],
 *   followSymlinks: false,
 * });
 * 
 * // ... process results ...
 * ```
 */

// Core types
export type {
  NodeModulesInfo,
  AgeCategory,
  SizeCategory,
  SortOption,
  ScanOptions,
  DeleteOptions,
  DeletionResult,
  DeletionDetail,
  AppState,
  CliArgs,
  ScanStatistics,
  ColorConfig,
} from './types.js';

// Core functions
export { scanForNodeModules, analyzeNodeModules, quickScan, loadIgnorePatterns, loadFavorites, isNodeModulesInUse } from './scanner.js';
export { deleteSelectedNodeModules, generateDeletionPreview, generateJSONReport, selectBySize, selectByAge, selectAll, invertSelection } from './deletion.js';
export {
  formatBytes,
  parseSize,
  formatRelativeTime,
  getSizeCategory,
  getAgeCategory,
  sortNodeModules,
  filterNodeModules,
  calculateStatistics,
  toggleSelection,
  selectByPredicate,
} from './utils.js';

// Constants
export { SIZE_THRESHOLDS, AGE_THRESHOLDS, DEFAULT_COLORS } from './types.js';

// Version
export const VERSION = '1.0.0';
