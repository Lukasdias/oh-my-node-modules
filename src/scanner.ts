/**
 * Scanner module for discovering and analyzing node_modules directories
 * 
 * This module handles the core scanning functionality:
 * - Recursive directory traversal
 * - Size calculation (recursive)
 * - Package.json parsing
 * - Metadata extraction
 * 
 * All operations are async and non-blocking to keep the TUI responsive.
 */

import { promises as fs } from 'fs';
import { join, basename, dirname } from 'path';
import type { NodeModulesInfo, ScanOptions } from './types.js';
import {
  formatBytes,
  formatRelativeTime,
  getSizeCategory,
  getAgeCategory,
  readPackageJson,
  shouldExcludePath,
  fileExists,
} from './utils.js';

/**
 * Result of a directory scan operation.
 */
interface ScanResult {
  /** Discovered node_modules entries */
  nodeModules: NodeModulesInfo[];
  /** Number of directories scanned */
  directoriesScanned: number;
  /** Any errors encountered during scanning */
  errors: string[];
}

/**
 * Recursively scan for node_modules directories starting from root path.
 * 
 * This is the main entry point for discovery. It walks the directory tree,
 * identifies node_modules folders, and collects metadata about each one.
 * 
 * @param options - Scan configuration options
 * @param onProgress - Optional callback for progress updates (0-100)
 * @returns Scan results with all discovered node_modules
 */
export async function scanForNodeModules(
  options: ScanOptions,
  onProgress?: (progress: number) => void
): Promise<ScanResult> {
  const result: ScanResult = {
    nodeModules: [],
    directoriesScanned: 0,
    errors: [],
  };

  const visitedPaths = new Set<string>();
  const pathsToScan: Array<{ path: string; depth: number }> = [
    { path: options.rootPath, depth: 0 },
  ];

  let processedCount = 0;
  let totalEstimate = 1; // Start with 1, will adjust as we discover

  while (pathsToScan.length > 0) {
    const { path: currentPath, depth } = pathsToScan.shift()!;

    // Skip if already visited or exceeds max depth
    if (visitedPaths.has(currentPath)) continue;
    if (options.maxDepth !== undefined && depth > options.maxDepth) continue;
    if (shouldExcludePath(currentPath, options.excludePatterns)) continue;

    visitedPaths.add(currentPath);
    result.directoriesScanned++;

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      // Check if current directory has node_modules
      const hasNodeModules = entries.some(
        entry => entry.isDirectory() && entry.name === 'node_modules'
      );

      if (hasNodeModules) {
        const nodeModulesPath = join(currentPath, 'node_modules');
        const info = await analyzeNodeModules(nodeModulesPath, currentPath);

        // Apply filters
        if (options.minSizeBytes && info.sizeBytes < options.minSizeBytes) {
          // Skip - too small
        } else if (
          options.olderThanDays &&
          getAgeInDays(info.lastModified) < options.olderThanDays
        ) {
          // Skip - too recent
        } else {
          result.nodeModules.push(info);
        }
      }

      // Add subdirectories to scan queue (excluding node_modules itself)
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          !entry.name.startsWith('.')
        ) {
          const subPath = join(currentPath, entry.name);
          if (!shouldExcludePath(subPath, options.excludePatterns)) {
            pathsToScan.push({ path: subPath, depth: depth + 1 });
            totalEstimate++;
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Error scanning ${currentPath}: ${errorMessage}`);
    }

    // Report progress
    processedCount++;
    if (onProgress) {
      const progress = Math.min(100, Math.round((processedCount / totalEstimate) * 100));
      onProgress(progress);
    }
  }

  // Ensure we report 100% at the end
  if (onProgress) {
    onProgress(100);
  }

  return result;
}

/**
 * Find the repo root by looking for .git directory.
 * Walks up the directory tree until .git is found or root is reached.
 * 
 * @param startPath - Starting path to search from
 * @returns Path to repo root, or startPath if no .git found
 */
async function findRepoRoot(startPath: string): Promise<string> {
  let currentPath = startPath;
  const root = '/';
  
  while (currentPath !== root) {
    const gitPath = join(currentPath, '.git');
    try {
      if (await fileExists(gitPath)) {
        return currentPath;
      }
    } catch {
      // Continue searching
    }
    currentPath = dirname(currentPath);
  }
  
  return startPath;
}

/**
 * Analyze a specific node_modules directory and extract all metadata.
 * 
 * This function performs the heavy lifting of:
 * - Calculating total size (recursive)
 * - Counting packages
 * - Reading parent project info
 * - Determining age and size categories
 * 
 * @param nodeModulesPath - Path to node_modules directory
 * @param projectPath - Path to parent project (containing package.json)
 * @returns Complete metadata for the node_modules
 */
export async function analyzeNodeModules(
  nodeModulesPath: string,
  projectPath: string
): Promise<NodeModulesInfo> {
  // Get basic stats
  const stats = await fs.stat(nodeModulesPath);
  
  // Calculate size and count packages
  const { totalSize, packageCount, totalPackageCount } = await calculateDirectorySize(
    nodeModulesPath
  );

  // Read project info from package.json
  const packageJson = await readPackageJson(projectPath);
  const projectName = packageJson?.name || basename(projectPath);
  const projectVersion = packageJson?.version;

  // Find repo root by looking for .git
  const repoPath = await findRepoRoot(projectPath);

  // Determine categories
  const sizeCategory = getSizeCategory(totalSize);
  const ageCategory = getAgeCategory(stats.mtime);

  return {
    path: nodeModulesPath,
    projectPath,
    projectName,
    projectVersion,
    repoPath,
    sizeBytes: totalSize,
    sizeFormatted: formatBytes(totalSize),
    packageCount,
    totalPackageCount,
    lastModified: stats.mtime,
    lastModifiedFormatted: formatRelativeTime(stats.mtime),
    selected: false,
    isFavorite: false,
    ageCategory,
    sizeCategory,
  };
}

/**
 * Recursively calculate directory size and package counts.
 * 
 * This is an expensive operation for large node_modules directories.
 * We optimize by:
 * - Using iterative approach (avoid stack overflow)
 * - Counting only top-level packages for packageCount
 * - Counting all packages for totalPackageCount
 * 
 * @param dirPath - Directory to analyze
 * @returns Size in bytes and package counts
 */
async function calculateDirectorySize(dirPath: string): Promise<{
  totalSize: number;
  packageCount: number;
  totalPackageCount: number;
}> {
  let totalSize = 0;
  let packageCount = 0;
  let totalPackageCount = 0;
  let isTopLevel = true;

  const pathsToProcess: string[] = [dirPath];
  const processedPaths = new Set<string>();

  while (pathsToProcess.length > 0) {
    const currentPath = pathsToProcess.pop()!;
    
    if (processedPaths.has(currentPath)) continue;
    processedPaths.add(currentPath);

    try {
      const stats = await fs.stat(currentPath);
      
      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        // Add directory entry size (approximate)
        totalSize += 4096; // Typical directory entry size
        
        // Count packages at top level only
        if (isTopLevel && currentPath !== dirPath) {
          const entryName = basename(currentPath);
          // Skip hidden directories and special directories
          if (!entryName.startsWith('.') && entryName !== '.bin') {
            packageCount++;
          }
        }
        
        // Count all packages for total
        if (currentPath !== dirPath) {
          const entryName = basename(currentPath);
          if (!entryName.startsWith('.') && entryName !== '.bin') {
            totalPackageCount++;
          }
        }

        // Read directory contents
        try {
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = join(currentPath, entry.name);
            pathsToProcess.push(entryPath);
          }
        } catch {
          // Permission denied or other error - skip this directory
        }
      } else if (stats.isSymbolicLink()) {
        // Skip symbolic links to avoid cycles
      }
    } catch {
      // File not accessible - skip
    }

    if (currentPath === dirPath) {
      isTopLevel = false;
    }
  }

  return { totalSize, packageCount, totalPackageCount };
}

/**
 * Helper to get age in days from a date.
 */
function getAgeInDays(date: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Load ignore patterns from .onmignore file.
 * 
 * Looks for .onmignore in:
 * 1. Current working directory
 * 2. Home directory
 * 
 * @returns Array of ignore patterns
 */
export async function loadIgnorePatterns(): Promise<string[]> {
  const patterns: string[] = [
    '**/node_modules/**', // Never scan inside node_modules
    '**/.git/**',
    '**/.*', // Hidden directories
  ];

  const ignoreFiles = [
    join(process.cwd(), '.onmignore'),
    join(process.env.HOME || process.cwd(), '.onmignore'),
  ];

  for (const ignoreFile of ignoreFiles) {
    try {
      if (await fileExists(ignoreFile)) {
        const content = await fs.readFile(ignoreFile, 'utf-8');
        const lines = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        patterns.push(...lines);
      }
    } catch {
      // Ignore errors reading ignore files
    }
  }

  return patterns;
}

/**
 * Load favorites list from .onmfavorites file.
 * 
 * Favorites are projects that should never be suggested for deletion.
 * 
 * @returns Set of favorite project paths
 */
export async function loadFavorites(): Promise<Set<string>> {
  const favorites = new Set<string>();

  const favoritesFile = join(process.env.HOME || process.cwd(), '.onmfavorites');

  try {
    if (await fileExists(favoritesFile)) {
      const content = await fs.readFile(favoritesFile, 'utf-8');
      const lines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      
      for (const line of lines) {
        favorites.add(line);
      }
    }
  } catch {
    // Ignore errors reading favorites
  }

  return favorites;
}

/**
 * Check if a node_modules directory is currently in use.
 * 
 * This is a safety check to prevent deleting node_modules that
 * might be actively being used by a running process.
 * 
 * Note: This is a best-effort check and may not catch all cases.
 * 
 * @param path - Path to node_modules
 * @returns True if potentially in use
 */
export async function isNodeModulesInUse(path: string): Promise<boolean> {
  // This is a simplified check - in production, you might want to:
  // 1. Check for lock files
  // 2. Check for running node processes using this path
  // 3. Check for open file handles
  
  try {
    const lockFiles = ['.package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    const projectPath = dirname(path);
    
    for (const lockFile of lockFiles) {
      const lockPath = join(projectPath, lockFile);
      try {
        const stats = await fs.stat(lockPath);
        // If lock file was modified in the last minute, might be in use
        const oneMinuteAgo = Date.now() - 60 * 1000;
        if (stats.mtime.getTime() > oneMinuteAgo) {
          return true;
        }
      } catch {
        // Lock file doesn't exist - that's fine
      }
    }
  } catch {
    // Error checking - assume not in use
  }

  return false;
}

/**
 * Quick scan mode - just report without full metadata.
 * 
 * Faster than full scan when you just need a quick overview.
 * 
 * @param rootPath - Root directory to scan
 * @returns Basic info about found node_modules
 */
export async function quickScan(rootPath: string): Promise<Array<{
  path: string;
  projectPath: string;
  projectName: string;
  repoPath: string;
}>> {
  const results: Array<{ path: string; projectPath: string; projectName: string; repoPath: string }> = [];
  const visitedPaths = new Set<string>();
  const pathsToScan = [rootPath];

  while (pathsToScan.length > 0) {
    const currentPath = pathsToScan.pop()!;
    
    if (visitedPaths.has(currentPath)) continue;
    visitedPaths.add(currentPath);

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      const hasNodeModules = entries.some(
        entry => entry.isDirectory() && entry.name === 'node_modules'
      );

      if (hasNodeModules) {
        const projectPath = currentPath;
        const nodeModulesPath = join(currentPath, 'node_modules');
        const packageJson = await readPackageJson(projectPath);
        const repoPath = await findRepoRoot(projectPath);
        
        results.push({
          path: nodeModulesPath,
          projectPath,
          projectName: packageJson?.name || basename(projectPath),
          repoPath,
        });
      }

      // Add subdirectories
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          !entry.name.startsWith('.')
        ) {
          pathsToScan.push(join(currentPath, entry.name));
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return results;
}
