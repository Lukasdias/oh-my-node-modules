/**
 * Optimized scanner module for discovering and analyzing node_modules directories
 * 
 * Uses fdir for ultra-fast directory crawling (1M files in <1s),
 * worker threads for parallel size calculations.
 */

import { promises as fs } from 'fs';
import { join, basename, dirname } from 'path';
import { fdir } from 'fdir';
import pLimit from 'p-limit';
import type { NodeModulesInfo, ScanOptions, ScanResult } from './types.js';
import {
  formatBytes,
  formatRelativeTime,
  getSizeCategory,
  getAgeCategory,
  readPackageJson,
  fileExists,
} from './utils.js';
import { calculateSizeWithWorker } from './size-worker.js';

// Concurrency limits - higher on Windows for better performance
const SIZE_CALCULATION_CONCURRENCY = process.platform === 'win32' ? 8 : 4;

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
 * Calculate directory size using worker threads for parallel processing.
 */
async function calculateDirectorySizeAsync(dirPath: string): Promise<{
  totalSize: number;
  packageCount: number;
  totalPackageCount: number;
}> {
  try {
    // Use worker thread for calculation
    return await calculateSizeWithWorker(dirPath);
  } catch (error) {
    // Fallback to simple calculation if worker fails
    return calculateDirectorySizeSimple(dirPath);
  }
}

/**
 * Simple directory size calculation (fallback).
 */
async function calculateDirectorySizeSimple(dirPath: string): Promise<{
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
  
  // Calculate size using worker thread
  const { totalSize, packageCount, totalPackageCount } = await calculateDirectorySizeAsync(nodeModulesPath);

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
    isPending: false,
  } as NodeModulesInfo;
}

/**
 * Update NodeModulesInfo with calculated size.
 */
export async function updateNodeModulesSize(
  info: NodeModulesInfo
): Promise<NodeModulesInfo> {
  const { totalSize, packageCount, totalPackageCount } = await calculateDirectorySizeAsync(info.path);
  
  return {
    ...info,
    sizeBytes: totalSize,
    sizeFormatted: formatBytes(totalSize),
    packageCount,
    totalPackageCount,
    sizeCategory: getSizeCategory(totalSize),
    isPending: false,
  };
}

/**
 * Scan for node_modules directories using fdir for ultra-fast discovery.
 * 
 * Uses fdir (1M files in <1s) for discovery,
 * worker threads for parallel size calculations.
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

  // Phase 1: Use fdir for ultra-fast node_modules discovery
  if (onProgress) {
    onProgress(5, 0);
  }

  const rootPath = options.rootPath;
  const maxDepth = options.maxDepth;
  
  const crawler = new fdir()
    .withDirs()
    .withFullPaths()
    .filter((path, isDirectory) => {
      // Only include directories named 'node_modules'
      if (!isDirectory) return false;
      // Use basename to handle trailing slashes (fdir adds them)
      if (basename(path) !== 'node_modules') return false;
      
      // CRITICAL: Skip nested node_modules (e.g., node_modules/foo/node_modules)
      // These are dependencies, not projects
      const normalizedPath = path.replace(/\\/g, '/');
      const parentDir = dirname(normalizedPath);
      if (parentDir.includes('node_modules')) return false;
      
      // Get project path (parent of node_modules)
      const projectPath = dirname(path);
      
      // Skip hidden directories (directories starting with . in the path)
      const pathParts = projectPath.replace(rootPath, '').split(/[/\\]/);
      const hasHiddenDir = pathParts.some(part => part.startsWith('.'));
      if (hasHiddenDir) return false;
      
      // Check maxDepth
      if (maxDepth !== undefined) {
        const depth = pathParts.filter(p => p.length > 0).length;
        if (depth > maxDepth) return false;
      }
      
      return true;
    })
    .crawl(options.rootPath);

  // Get all node_modules paths quickly
  const nodeModulesPaths: string[] = await crawler.withPromise();
  
  // Strip trailing slashes from paths (fdir adds them)
  // Handle both forward (/) and back (\) slashes for cross-platform compatibility
  const normalizedPaths = nodeModulesPaths.map(p => p.replace(/[\\/]$/, ''));
  
  result.directoriesScanned = normalizedPaths.length;
  
  if (onProgress) {
    onProgress(10, normalizedPaths.length);
  }

  // Convert to analysis tasks
  const foundNodeModules = normalizedPaths.map(nodeModulesPath => ({
    nodeModulesPath,
    projectPath: dirname(nodeModulesPath),
  }));

  // Phase 2: Parallel size calculation with controlled concurrency
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
          
          // Report progress
          if (onProgress) {
            const progress = 10 + Math.round((result.nodeModules.length / foundNodeModules.length) * 90);
            onProgress(progress, result.nodeModules.length);
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
  // Use fdir for fast discovery
  const crawler = new fdir()
    .withDirs()
    .withFullPaths()
    .filter((path, isDirectory) => {
      if (!isDirectory) return false;
      if (basename(path) !== 'node_modules') return false;
      
      // Skip nested node_modules (dependencies, not projects)
      const normalizedPath = path.replace(/\\/g, '/');
      const parentDir = dirname(normalizedPath);
      if (parentDir.includes('node_modules')) return false;
      
      return true;
    })
    .crawl(rootPath);

  const nodeModulesPaths: string[] = await crawler.withPromise();
  
  // Strip trailing slashes from paths
  const normalizedPaths = nodeModulesPaths.map(p => p.replace(/[\\/]$/, ''));
  
  const results: Array<{ path: string; projectPath: string; projectName: string; repoPath: string }> = [];
  
  for (const nodeModulesPath of normalizedPaths) {
    const projectPath = dirname(nodeModulesPath);
    const packageJson = await readPackageJson(projectPath);
    const repoPath = await findRepoRoot(projectPath);
    
    results.push({
      path: nodeModulesPath,
      projectPath,
      projectName: packageJson?.name || basename(projectPath),
      repoPath,
    });
  }

  return results;
}
