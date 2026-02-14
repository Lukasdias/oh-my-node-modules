/**
 * Deletion module for safely removing node_modules directories
 * 
 * This module handles:
 * - Safe deletion with confirmations
 * - Dry run mode
 * - Progress tracking
 * - Error handling
 * - In-use detection
 * 
 * Safety is the priority - we never delete without explicit confirmation
 * and we check for potential issues before proceeding.
 */

import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { NodeModulesInfo, DeleteOptions, DeletionResult, DeletionDetail } from './types.js';
import { formatBytes, fileExists } from './utils.js';
import { isNodeModulesInUse } from './scanner.js';

const execAsync = promisify(exec);

/**
 * Delete selected node_modules directories.
 * 
 * This is the main entry point for deletion operations. It:
 * 1. Filters to only selected items
 * 2. Performs safety checks
 * 3. Deletes each node_modules (or simulates in dry run)
 * 4. Collects results and statistics
 * 
 * @param nodeModules - List of all node_modules (selected ones will be deleted)
 * @param options - Deletion options
 * @param onProgress - Optional callback for progress updates
 * @returns Deletion results with statistics
 */
export async function deleteSelectedNodeModules(
  nodeModules: NodeModulesInfo[],
  options: DeleteOptions,
  onProgress?: (current: number, total: number, currentPath: string) => void
): Promise<DeletionResult> {
  const selected = nodeModules.filter(nm => nm.selected);
  
  const result: DeletionResult = {
    totalAttempted: selected.length,
    successful: 0,
    failed: 0,
    bytesFreed: 0,
    formattedBytesFreed: '0 B',
    details: [],
  };

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    
    if (onProgress) {
      onProgress(i + 1, selected.length, item.projectName);
    }

    const detail = await deleteNodeModules(item, options);
    result.details.push(detail);

    if (detail.success) {
      result.successful++;
      result.bytesFreed += item.sizeBytes;
    } else {
      result.failed++;
    }
  }

  result.formattedBytesFreed = formatBytes(result.bytesFreed);
  return result;
}

/**
 * Delete a single node_modules directory.
 * 
 * Performs safety checks before deletion:
 * - Verifies it's actually a node_modules directory
 * - Checks if it's in use (if enabled)
 * - Verifies the path is valid
 * 
 * @param nodeModules - NodeModulesInfo to delete
 * @param options - Deletion options
 * @returns Detailed result of the deletion
 */
async function deleteNodeModules(
  nodeModules: NodeModulesInfo,
  options: DeleteOptions
): Promise<DeletionDetail> {
  const startTime = Date.now();
  
  const detail: DeletionDetail = {
    nodeModules,
    success: false,
    durationMs: 0,
  };

  try {
    // Safety check 1: Verify path ends with node_modules
    if (!nodeModules.path.endsWith('node_modules')) {
      detail.error = 'Path does not appear to be a node_modules directory';
      detail.durationMs = Date.now() - startTime;
      return detail;
    }

    // Safety check 2: Verify directory exists
    if (!(await fileExists(nodeModules.path))) {
      detail.error = 'Directory does not exist';
      detail.durationMs = Date.now() - startTime;
      return detail;
    }

    // Safety check 3: Check if in use
    if (options.checkRunningProcesses) {
      const inUse = await isNodeModulesInUse(nodeModules.path);
      if (inUse) {
        detail.error = 'Directory appears to be in use by a running process';
        detail.durationMs = Date.now() - startTime;
        return detail;
      }
    }

    // Safety check 4: Verify it looks like a real node_modules
    const isValidNodeModules = await verifyNodeModules(nodeModules.path);
    if (!isValidNodeModules) {
      detail.error = 'Directory does not appear to be a valid node_modules';
      detail.durationMs = Date.now() - startTime;
      return detail;
    }

    // Perform deletion (or simulate)
    if (options.dryRun) {
      detail.success = true;
    } else {
      try {
        if (options.force) {
          await forceDelete(nodeModules.path);
        } else {
          await fs.rm(nodeModules.path, { recursive: true, force: true });
        }
        detail.success = true;
      } catch (rmError) {
        const errorCode = (rmError as NodeJS.ErrnoException).code;
        const errorMessage = (rmError as Error).message;
        
        if (errorCode === 'EPERM' || errorCode === 'EACCES') {
          detail.error = 'Permission denied - run as Administrator or check file permissions';
        } else if (errorCode === 'EBUSY') {
          detail.error = 'Directory in use - close any programs using these files';
        } else if (errorMessage?.includes('ENOTEMPTY')) {
          detail.error = 'Directory not empty - may contain read-only files. Try using --force';
        } else {
          detail.error = errorMessage || 'Unknown error during deletion';
        }
      }
    }

    detail.durationMs = Date.now() - startTime;
  } catch (error) {
    detail.error = error instanceof Error ? error.message : String(error);
    detail.durationMs = Date.now() - startTime;
  }

  return detail;
}

/**
 * Force delete a directory - handles read-only files and long paths on Windows.
 * Falls back to native commands if fs.rm fails.
 */
async function forceDelete(dirPath: string): Promise<void> {
  const isWindows = process.platform === 'win32';
  
  try {
    // First try normal deletion
    await fs.rm(dirPath, { recursive: true, force: true });
    return;
  } catch {
    // If that fails, try force approach
  }
  
  // Strategy 1: Make all files writable, then delete
  try {
    await makeWritableRecursive(dirPath);
    await fs.rm(dirPath, { recursive: true, force: true });
    return;
  } catch {
    // If that fails, try native command
  }
  
  // Strategy 2: Use native system command
  try {
    if (isWindows) {
      // Use Windows rd command with /s (recursive) /q (quiet)
      // Use UNC prefix for long paths
      const windowsPath = dirPath.length > 240 ? `\\\\?\\${resolve(dirPath)}` : dirPath;
      await execAsync(`rd /s /q "${windowsPath}"`, { timeout: 30000 });
    } else {
      // Use rm -rf on Unix
      await execAsync(`rm -rf "${dirPath}"`, { timeout: 30000 });
    }
    return;
  } catch {
    // Last resort: rename then delete
  }
  
  // Strategy 3: Rename to temp name, then delete (works when files are locked)
  const tempPath = `${dirPath}.old.${Date.now()}`;
  await fs.rename(dirPath, tempPath);
  try {
    await fs.rm(tempPath, { recursive: true, force: true });
  } catch {
    // Leave it for cleanup later
  }
}

/**
 * Recursively make all files and directories writable.
 */
async function makeWritableRecursive(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await makeWritableRecursive(fullPath);
      }
      
      // Make writable (777 for Unix, clears read-only for Windows)
      await fs.chmod(fullPath, 0o777).catch(() => {});
    }
    
    // Make directory itself writable
    await fs.chmod(dirPath, 0o777).catch(() => {});
  } catch {
    // Ignore errors during permission changes
  }
}

/**
 * Verify that a directory looks like a real node_modules.
 * 
 * We check for:
 * - Directory name is exactly "node_modules"
 * - Contains at least one subdirectory (package)
 * - Parent directory contains package.json
 * 
 * These checks prevent accidental deletion of similarly named directories.
 * 
 * @param path - Path to verify
 * @returns True if it looks like a valid node_modules
 */
async function verifyNodeModules(dirPath: string): Promise<boolean> {
  try {
    // Check name - use basename to handle both / and \ separators
    const baseName = dirPath.replace(/\\/g, '/').split('/').pop();
    if (baseName !== 'node_modules') {
      return false;
    }

    // Check it has contents (not empty)
    const entries = await fs.readdir(dirPath);
    let hasSubdirs = false;
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      try {
        const stats = await fs.stat(entryPath);
        if (stats.isDirectory()) {
          hasSubdirs = true;
          break;
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    // Parent should have package.json
    const normalizedPath = dirPath.replace(/\\/g, '/');
    const parentPath = normalizedPath.replace(/\/node_modules$/, '');
    const hasPackageJson = await fileExists(join(parentPath, 'package.json'));

    return hasSubdirs || hasPackageJson;
  } catch {
    return false;
  }
}

/**
 * Generate a preview report of what would be deleted.
 * 
 * Used for dry run mode and confirmation prompts.
 * 
 * @param nodeModules - All node_modules items
 * @returns Formatted report string
 */
export function generateDeletionPreview(nodeModules: NodeModulesInfo[]): string {
  const selected = nodeModules.filter(nm => nm.selected);
  
  if (selected.length === 0) {
    return 'No node_modules selected for deletion.';
  }

  const totalBytes = selected.reduce((sum, nm) => sum + nm.sizeBytes, 0);
  
  let report = `\n⚠️  You are about to delete ${selected.length} node_modules director${selected.length === 1 ? 'y' : 'ies'}:\n\n`;
  
  for (const nm of selected) {
    const shortPath = nm.path.replace(process.cwd(), '.');
    report += `   • ${shortPath} (${nm.sizeFormatted})\n`;
  }
  
  report += `\n   Total space to reclaim: ${formatBytes(totalBytes)}\n`;
  
  return report;
}

/**
 * Generate a JSON report of deletion results.
 * 
 * @param result - Deletion result
 * @returns JSON string
 */
export function generateJSONReport(result: DeletionResult): string {
  return JSON.stringify({
    summary: {
      totalAttempted: result.totalAttempted,
      successful: result.successful,
      failed: result.failed,
      bytesFreed: result.bytesFreed,
      formattedBytesFreed: result.formattedBytesFreed,
    },
    details: result.details.map(d => ({
      path: d.nodeModules.path,
      projectName: d.nodeModules.projectName,
      sizeBytes: d.nodeModules.sizeBytes,
      sizeFormatted: d.nodeModules.sizeFormatted,
      success: d.success,
      error: d.error,
      durationMs: d.durationMs,
    })),
  }, null, 2);
}

/**
 * Select node_modules by size criteria.
 * 
 * Helper for "select all >500MB" functionality.
 * 
 * @param nodeModules - All node_modules
 * @param minSizeBytes - Minimum size in bytes
 * @returns Updated array with selections
 */
export function selectBySize(
  nodeModules: NodeModulesInfo[],
  minSizeBytes: number
): NodeModulesInfo[] {
  return nodeModules.map(nm => 
    nm.sizeBytes >= minSizeBytes ? { ...nm, selected: true } : nm
  );
}

/**
 * Select node_modules by age criteria.
 * 
 * Helper for "select all older than X days" functionality.
 * 
 * @param nodeModules - All node_modules
 * @param minAgeDays - Minimum age in days
 * @returns Updated array with selections
 */
export function selectByAge(
  nodeModules: NodeModulesInfo[],
  minAgeDays: number
): NodeModulesInfo[] {
  const now = new Date();
  return nodeModules.map(nm => {
    const ageDays = Math.floor((now.getTime() - nm.lastModified.getTime()) / (1000 * 60 * 60 * 24));
    return ageDays >= minAgeDays ? { ...nm, selected: true } : nm;
  });
}

/**
 * Select all node_modules.
 * 
 * @param nodeModules - All node_modules
 * @param selected - Whether to select (true) or deselect (false)
 * @returns Updated array
 */
export function selectAll(
  nodeModules: NodeModulesInfo[],
  selected: boolean
): NodeModulesInfo[] {
  return nodeModules.map(nm => ({ ...nm, selected }));
}

/**
 * Invert selection.
 * 
 * @param nodeModules - All node_modules
 * @returns Updated array with inverted selections
 */
export function invertSelection(nodeModules: NodeModulesInfo[]): NodeModulesInfo[] {
  return nodeModules.map(nm => ({ ...nm, selected: !nm.selected }));
}
