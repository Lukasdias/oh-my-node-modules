/**
 * Optimized scanner module for discovering and analyzing node_modules directories
 * 
 * Uses sequential BFS for reliable directory discovery,
 * parallel processing only for size calculations.
 */

import { promises as fs } from 'fs';
import { join, basename, dirname } from 'path';
import pLimit from 'p-limit';
import type { NodeModulesInfo, ScanOptions, ScanResult } from './types.js';
import {
  formatBytes,
  formatRelativeTime,
  getSizeCategory,
  getAgeCategory,
  readPackageJson,
  shouldExcludePath,
  fileExists,
} from './utils.js';
import { getFastDirectorySize } from './native-size.js';

// Concurrency limit for size calculations only
const SIZE_CALCULATION_CONCURRENCY = 4;

/**
 * Find the repo root by looking for .git directory.
 */
async function findRepoRoot(startPath: string): Promise<string> {
  let currentPath = startPath;
  const root = process.platform === 'win32' ? 'C:\\' : '/';
  
  while (currentPath !== root && currentPath !== dirname(currentPath)) {
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
 * Get age in days from a date.
 */
function getAgeInDays(date: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate directory size using JS fallback (iterative).
 */
async function calculateDirectorySizeFallback(dirPath: string): Promise<{
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
        totalSize += 4096;
        
        if (isTopLevel && currentPath !== dirPath) {
          const entryName = basename(currentPath);
          if (!entryName.startsWith('.') && entryName !== '.bin') {
            packageCount++;
          }
        }
        
        if (currentPath !== dirPath) {
          const entryName = basename(currentPath);
          if (!entryName.startsWith('.') && entryName !== '.bin') {
            totalPackageCount++;
          }
        }

        try {
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = join(currentPath, entry.name);
            pathsToProcess.push(entryPath);
          }
        } catch {
          // Permission denied - skip
        }
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
 * Calculate size using fastest available method.
 */
async function calculateSizeWithFallback(dirPath: string): Promise<{
  totalSize: number;
  packageCount: number;
  totalPackageCount: number;
  isNative: boolean;
}> {
  // Try native size calculation first
  const nativeResult = await getFastDirectorySize(dirPath);
  
  if (nativeResult.isNative && nativeResult.bytes > 0) {
    return {
      totalSize: nativeResult.bytes,
      packageCount: nativeResult.packageCount,
      totalPackageCount: nativeResult.totalPackageCount,
      isNative: true,
    };
  }
  
  // Fallback to JS implementation
  const fallbackResult = await calculateDirectorySizeFallback(dirPath);
  return {
    ...fallbackResult,
    isNative: false,
  };
}

/**
 * Analyze a single node_modules directory.
 */
export async function analyzeNodeModules(
  nodeModulesPath: string,
  projectPath: string,
  lazy: boolean = false
): Promise<NodeModulesInfo> {
  // Get basic stats
  const stats = await fs.stat(nodeModulesPath);
  
  // In lazy mode, return pending info
  if (lazy) {
    const packageJson = await readPackageJson(projectPath);
    const projectName = packageJson?.name || basename(projectPath);
    const repoPath = await findRepoRoot(projectPath);
    
    return {
      path: nodeModulesPath,
      projectPath,
      projectName,
      projectVersion: packageJson?.version,
      repoPath,
      sizeBytes: 0,
      sizeFormatted: 'calculating...',
      packageCount: 0,
      totalPackageCount: 0,
      lastModified: stats.mtime,
      lastModifiedFormatted: formatRelativeTime(stats.mtime),
      selected: false,
      isFavorite: false,
      ageCategory: getAgeCategory(stats.mtime),
      sizeCategory: 'small',
      isPending: true,
    } as NodeModulesInfo;
  }
  
  // Calculate size (native or fallback)
  const { totalSize, packageCount, totalPackageCount, isNative } = await calculateSizeWithFallback(nodeModulesPath);

  // Read project info
  const packageJson = await readPackageJson(projectPath);
  const projectName = packageJson?.name || basename(projectPath);
  const repoPath = await findRepoRoot(projectPath);

  // Determine categories
  const sizeCategory = getSizeCategory(totalSize);
  const ageCategory = getAgeCategory(stats.mtime);

  return {
    path: nodeModulesPath,
    projectPath,
    projectName,
    projectVersion: packageJson?.version,
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
    isNativeCalculation: isNative,
  } as NodeModulesInfo;
}

/**
 * Update NodeModulesInfo with calculated size.
 */
export async function updateNodeModulesSize(
  info: NodeModulesInfo
): Promise<NodeModulesInfo> {
  const { totalSize, packageCount, totalPackageCount, isNative } = await calculateSizeWithFallback(info.path);
  
  return {
    ...info,
    sizeBytes: totalSize,
    sizeFormatted: formatBytes(totalSize),
    packageCount,
    totalPackageCount,
    sizeCategory: getSizeCategory(totalSize),
    isPending: false,
    isNativeCalculation: isNative,
  };
}

/**
 * Scan for node_modules directories.
 * 
 * Uses sequential BFS for reliable discovery,
 * parallel processing only for size calculations.
 */
export async function scanForNodeModules(
  options: ScanOptions,
  onProgress?: (progress: number, found: number) => void,
  lazy: boolean = false
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

  // Collect all node_modules paths first (fast)
  const foundNodeModules: Array<{ nodeModulesPath: string; projectPath: string }> = [];

  let processedCount = 0;
  let totalEstimate = 1;

  // Phase 1: Sequential BFS to find all node_modules directories
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
        foundNodeModules.push({ nodeModulesPath, projectPath: currentPath });
        
        if (onProgress) {
          onProgress(Math.min(100, Math.round((processedCount / totalEstimate) * 100)), foundNodeModules.length);
        }
      }

      // Queue subdirectories for scanning
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

    processedCount++;
    if (onProgress && foundNodeModules.length === 0) {
      onProgress(Math.min(100, Math.round((processedCount / totalEstimate) * 100)), 0);
    }
  }

  // Phase 2: Parallel size calculation
  if (foundNodeModules.length > 0) {
    const sizeLimit = pLimit(SIZE_CALCULATION_CONCURRENCY);
    
    const analysisPromises = foundNodeModules.map(({ nodeModulesPath, projectPath }) =>
      sizeLimit(async () => {
        try {
          const info = await analyzeNodeModules(nodeModulesPath, projectPath, lazy);

          // Apply filters (only in non-lazy mode)
          if (!lazy) {
            const passesFilter = (!options.minSizeBytes || info.sizeBytes >= options.minSizeBytes) &&
              (!options.olderThanDays || getAgeInDays(info.lastModified) >= options.olderThanDays);

            if (passesFilter) {
              result.nodeModules.push(info);
            }
          } else {
            result.nodeModules.push(info);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Error analyzing ${nodeModulesPath}: ${errorMessage}`);
        }
      })
    );

    await Promise.all(analysisPromises);
  }

  // Ensure we report 100% at the end
  if (onProgress) {
    onProgress(100, result.nodeModules.length);
  }

  return result;
}

/**
 * Calculate sizes for all pending node_modules entries in parallel.
 */
export async function calculatePendingSizes(
  nodeModules: NodeModulesInfo[],
  onProgress?: (completed: number, total: number) => void
): Promise<NodeModulesInfo[]> {
  const pending = nodeModules.filter(nm => (nm as NodeModulesInfo & { isPending?: boolean }).isPending);
  
  if (pending.length === 0) return nodeModules;

  const limit = pLimit(SIZE_CALCULATION_CONCURRENCY);
  let completed = 0;
  const total = pending.length;

  const updatePromises = pending.map(pendingItem =>
    limit(async () => {
      try {
        const updated = await updateNodeModulesSize(pendingItem);
        completed++;
        if (onProgress) {
          onProgress(completed, total);
        }
        return updated;
      } catch (error) {
        completed++;
        if (onProgress) {
          onProgress(completed, total);
        }
        return {
          ...pendingItem,
          sizeFormatted: 'error',
          isPending: false,
        };
      }
    })
  );

  const updatedItems = await Promise.all(updatePromises);
  
  // Merge updated items back into original array
  const updatedMap = new Map(updatedItems.map(item => [item.path, item]));
  return nodeModules.map(item => updatedMap.get(item.path) || item);
}

/**
 * Load ignore patterns from .onmignore file.
 */
export async function loadIgnorePatterns(): Promise<string[]> {
  const patterns: string[] = [
    '**/node_modules/**',
    '**/.git/**',
    '**/.*',
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
 */
export async function isNodeModulesInUse(path: string): Promise<boolean> {
  try {
    const lockFiles = ['.package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    const projectPath = dirname(path);
    
    for (const lockFile of lockFiles) {
      const lockPath = join(projectPath, lockFile);
      try {
        const stats = await fs.stat(lockPath);
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
