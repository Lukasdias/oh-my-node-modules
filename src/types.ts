/**
 * Core type definitions for oh-my-node-modules
 * 
 * These types represent the domain model for node_modules analysis.
 * Each interface answers a specific question about the data structure.
 */

/** 
 * Represents a discovered node_modules directory with all relevant metadata.
 * This is the core data structure that flows through the entire application.
 */
export interface NodeModulesInfo {
  /** Absolute path to the node_modules directory */
  path: string;
  
  /** Absolute path to the parent project directory (containing package.json) */
  projectPath: string;
  
  /** Project name from package.json, or directory name if no package.json */
  projectName: string;
  
  /** Project version from package.json, or undefined if not available */
  projectVersion?: string;
  
  /** Absolute path to the repo root (where .git is found) */
  repoPath: string;
  
  /** Total size in bytes (recursive, includes all nested files) */
  sizeBytes: number;
  
  /** Human-readable size string (e.g., "1.2 GB", "456 MB") */
  sizeFormatted: string;
  
  /** Number of packages directly in node_modules (top-level) */
  packageCount: number;
  
  /** Total number of packages including nested dependencies */
  totalPackageCount: number;
  
  /** Last modification time of the node_modules directory */
  lastModified: Date;
  
  /** Formatted string showing how long ago (e.g., "30d ago", "2d ago") */
  lastModifiedFormatted: string;
  
  /** Whether this node_modules is currently selected for deletion */
  selected: boolean;
  
  /** Whether this project is marked as a favorite (never suggest deleting) */
  isFavorite: boolean;
  
  /** Age category for color coding */
  ageCategory: AgeCategory;
  
  /** Size category for color coding */
  sizeCategory: SizeCategory;
  
  /** Whether size calculation is still pending (lazy mode) */
  isPending?: boolean;
  
  /** Whether the size was calculated using native commands */
  isNativeCalculation?: boolean;
}

/** 
 * Age categories determine visual styling in the TUI.
 * Used to highlight stale/old node_modules that might be safe to delete.
 */
export type AgeCategory = 'fresh' | 'recent' | 'old' | 'stale';

/**
 * Size categories determine visual styling and smart selection rules.
 * Helps users quickly identify large disk space consumers.
 */
export type SizeCategory = 'small' | 'medium' | 'large' | 'huge';

/**
 * Sort options for the TUI list view.
 * Each option represents a different way to organize the results.
 */
export type SortOption = 
  | 'size-desc'      // Largest first (default)
  | 'size-asc'       // Smallest first
  | 'date-desc'      // Most recently modified first
  | 'date-asc'       // Oldest first
  | 'name-asc'       // Alphabetical A-Z
  | 'name-desc'      // Alphabetical Z-A
  | 'packages-desc'  // Most packages first
  | 'packages-asc';  // Fewest packages first

/**
 * Result of a directory scan operation.
 */
export interface ScanResult {
  /** Discovered node_modules entries */
  nodeModules: NodeModulesInfo[];
  /** Number of directories scanned */
  directoriesScanned: number;
  /** Any errors encountered during scanning */
  errors: string[];
}

/**
 * Configuration options for the scanning process.
 * Controls what gets scanned and how results are filtered.
 */
export interface ScanOptions {
  /** Root directory to start scanning from */
  rootPath: string;
  
  /** Maximum depth to scan (undefined = unlimited) */
  maxDepth?: number;
  
  /** Patterns to exclude (glob strings) */
  excludePatterns: string[];
  
  /** Whether to follow symbolic links */
  followSymlinks: boolean;
  
  /** Minimum size threshold in bytes (skip smaller node_modules) */
  minSizeBytes?: number;
  
  /** Maximum age in days (only include node_modules older than this) */
  olderThanDays?: number;
}

/**
 * Configuration options for the deletion operation.
 * Controls safety checks and behavior during deletion.
 */
export interface DeleteOptions {
  /** Whether to perform a dry run (don't actually delete) */
  dryRun: boolean;

  /** Whether to skip confirmation prompts */
  yes: boolean;

  /** Whether to force delete (handle read-only files, long paths on Windows) */
  force: boolean;
  
  /** Whether to check for running processes before deleting */
  checkRunningProcesses: boolean;
  
  /** Whether to show a progress bar during deletion */
  showProgress: boolean;
}

/**
 * Results of a deletion operation.
 * Provides detailed feedback about what was deleted and any errors.
 */
export interface DeletionResult {
  /** Total number of node_modules directories attempted */
  totalAttempted: number;
  
  /** Number successfully deleted */
  successful: number;
  
  /** Number that failed to delete */
  failed: number;
  
  /** Total bytes freed (or that would be freed in dry run) */
  bytesFreed: number;
  
  /** Human-readable formatted version of bytes freed */
  formattedBytesFreed: string;
  
  /** Detailed results for each deletion attempt */
  details: DeletionDetail[];
}

/**
 * Result of a single node_modules deletion attempt.
 */
export interface DeletionDetail {
  /** The node_modules info that was targeted */
  nodeModules: NodeModulesInfo;
  
  /** Whether the deletion succeeded */
  success: boolean;
  
  /** Error message if deletion failed */
  error?: string;
  
  /** Time taken to delete in milliseconds */
  durationMs: number;
}

/**
 * Application state for the TUI.
 * Centralized state management following the reactive pattern.
 */
export interface AppState {
  /** All discovered node_modules directories */
  nodeModules: NodeModulesInfo[];
  
  /** Currently selected index in the list (for keyboard navigation) */
  selectedIndex: number;
  
  /** Current sort option */
  sortBy: SortOption;
  
  /** Current filter string (empty = no filter) */
  filterQuery: string;
  
  /** Whether the app is currently scanning */
  isScanning: boolean;
  
  /** Whether the app is currently deleting */
  isDeleting: boolean;
  
  /** Scan progress (0-100) */
  scanProgress: number;
  
  /** Total bytes reclaimed in this session */
  sessionBytesReclaimed: number;
  
  /** Whether to show the help overlay */
  showHelp: boolean;
  
  /** Error message to display (undefined = no error) */
  errorMessage?: string;
}

/**
 * Initial state factory function.
 * Creates a fresh application state with sensible defaults.
 */
export function createInitialState(): AppState {
  return {
    nodeModules: [],
    selectedIndex: 0,
    sortBy: 'size-desc',
    filterQuery: '',
    isScanning: false,
    isDeleting: false,
    scanProgress: 0,
    sessionBytesReclaimed: 0,
    showHelp: false,
  };
}

/**
 * CLI arguments parsed from command line.
 * Used to configure the application behavior.
 */
export interface CliArgs {
  /** Path to scan (default: current directory) */
  path: string;
  
  /** Quick scan mode (no TUI, just report) */
  scan: boolean;
  
  /** Auto-delete mode (no TUI, delete matching criteria) */
  auto: boolean;
  
  /** Dry run mode (don't actually delete) */
  dryRun: boolean;
  
  /** Skip confirmations */
  yes: boolean;
  
  /** Minimum size threshold for auto mode (e.g., "1gb", "500mb") */
  minSize?: string;
  
  /** Output as JSON */
  json: boolean;
  
  /** Show help message */
  help: boolean;
  
  /** Show version */
  version: boolean;
}

/**
 * Statistics calculated from a list of node_modules.
 * Used for summary displays and overview headers.
 */
export interface ScanStatistics {
  /** Total number of projects found */
  totalProjects: number;
  
  /** Total number of node_modules directories */
  totalNodeModules: number;
  
  /** Total size of all node_modules in bytes */
  totalSizeBytes: number;
  
  /** Total size formatted as human-readable string */
  totalSizeFormatted: string;
  
  /** Number of selected node_modules */
  selectedCount: number;
  
  /** Total size of selected node_modules */
  selectedSizeBytes: number;
  
  /** Total size of selected formatted */
  selectedSizeFormatted: string;
  
  /** Average age in days */
  averageAgeDays: number;
  
  /** Number of stale node_modules (>30 days) */
  staleCount: number;
}

/**
 * Color configuration for terminal output.
 * Provides semantic color mapping for different categories.
 */
export interface ColorConfig {
  /** Color for huge directories (>1GB) */
  huge: string;
  
  /** Color for large directories (>500MB) */
  large: string;
  
  /** Color for small directories (<100MB) */
  small: string;
  
  /** Color for stale/old directories */
  stale: string;
  
  /** Color for fresh directories */
  fresh: string;
  
  /** Color for selected items */
  selected: string;
  
  /** Color for errors */
  error: string;
  
  /** Color for success */
  success: string;
  
  /** Color for warnings */
  warning: string;
  
  /** Color for info/primary text */
  info: string;
}

/** Default color configuration using standard terminal colors */
export const DEFAULT_COLORS: ColorConfig = {
  huge: 'red',
  large: 'yellow',
  small: 'green',
  stale: 'gray',
  fresh: 'white',
  selected: 'cyan',
  error: 'red',
  success: 'green',
  warning: 'yellow',
  info: 'blue',
};

/**
 * Thresholds for size categorization in bytes.
 * Used to determine visual styling and smart selection rules.
 */
export const SIZE_THRESHOLDS = {
  /** 100 MB - upper bound for "small" category */
  SMALL: 100 * 1024 * 1024,
  /** 500 MB - upper bound for "medium" category */
  MEDIUM: 500 * 1024 * 1024,
  /** 1 GB - upper bound for "large" category */
  LARGE: 1024 * 1024 * 1024,
} as const;

/**
 * Thresholds for age categorization in days.
 * Used to identify stale node_modules that might be safe to delete.
 */
export const AGE_THRESHOLDS = {
  /** 7 days - still considered fresh */
  FRESH: 7,
  /** 30 days - warning threshold */
  RECENT: 30,
  /** 90 days - stale threshold */
  OLD: 90,
} as const;
