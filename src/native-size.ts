/**
 * Native size calculation using system commands
 * 
 * This module provides fast directory size calculation by using native
 * system commands instead of recursive JavaScript traversal.
 * 
 * On Unix: uses `du -sb` (byte-accurate, fast)
 * On Windows: uses `dir /s` (fast, though less accurate)
 * Falls back to JS implementation if commands fail
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

/**
 * Result of a size calculation operation
 */
interface SizeResult {
  /** Size in bytes */
  bytes: number;
  /** Number of top-level packages */
  packageCount: number;
  /** Total number of packages including nested */
  totalPackageCount: number;
  /** Whether the result came from native command */
  isNative: boolean;
}

/**
 * Use native `du` command on Unix systems for fast size calculation
 * This is orders of magnitude faster than JS recursion for deep directories
 */
async function getSizeWithDu(dirPath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`du -sb "${dirPath}"`, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024, // 1MB buffer
    });
    
    const match = stdout.trim().match(/^(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Use native `dir` command on Windows for fast size calculation
 * Format: "X File(s) Y bytes"
 */
async function getSizeWithDir(dirPath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`dir /s "${dirPath}"`, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    
    // Look for the last "File(s)" line which contains the total
    const lines = stdout.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // Match patterns like "123 File(s) 45,678,901 bytes" or "X File(s) Y bytes"
      const match = line.match(/File\(s\)\s+([\d,]+)\s+bytes?/i);
      if (match) {
        const bytesStr = match[1].replace(/,/g, '');
        return parseInt(bytesStr, 10);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Count packages using native commands
 * Uses `ls` on Unix, `dir` on Windows
 */
async function countPackagesNative(dirPath: string): Promise<{ topLevel: number; total: number } | null> {
  try {
    const isWindows = platform() === 'win32';
    
    if (isWindows) {
      // Windows: count directories in node_modules
      const { stdout } = await execAsync(
        `dir /b /ad "${dirPath}" | find /c /v ""`,
        { timeout: 10000 }
      );
      const topLevel = parseInt(stdout.trim(), 10) || 0;
      
      // Rough estimate for total (can't easily count all nested on Windows)
      return { topLevel, total: topLevel };
    } else {
      // Unix: use find to count directories
      // Top-level packages (excluding hidden and .bin)
      const { stdout: topLevelOut } = await execAsync(
        `find "${dirPath}" -maxdepth 1 -type d ! -name ".*" ! -name "node_modules" | wc -l`,
        { timeout: 10000 }
      );
      const topLevel = Math.max(0, parseInt(topLevelOut.trim(), 10) - 1); // -1 for the node_modules dir itself
      
      // Total packages (all directories under node_modules)
      const { stdout: totalOut } = await execAsync(
        `find "${dirPath}" -type d ! -path "${dirPath}" ! -name ".*" | wc -l`,
        { timeout: 10000 }
      );
      const total = parseInt(totalOut.trim(), 10);
      
      return { topLevel, total };
    }
  } catch {
    return null;
  }
}

/**
 * Get directory size using the fastest available method
 * Priority: native commands > JS fallback
 */
export async function getFastDirectorySize(dirPath: string): Promise<SizeResult> {
  const isWindows = platform() === 'win32';
  
  // Try native commands first
  let sizeBytes: number | null = null;
  
  if (isWindows) {
    sizeBytes = await getSizeWithDir(dirPath);
  } else {
    sizeBytes = await getSizeWithDu(dirPath);
  }
  
  // Try native package counting
  const packageCounts = await countPackagesNative(dirPath);
  
  if (sizeBytes !== null && packageCounts !== null) {
    return {
      bytes: sizeBytes,
      packageCount: packageCounts.topLevel,
      totalPackageCount: packageCounts.total,
      isNative: true,
    };
  }
  
  // If native methods fail, return null to trigger fallback
  return {
    bytes: 0,
    packageCount: 0,
    totalPackageCount: 0,
    isNative: false,
  };
}

/**
 * Check if native size calculation is available on this platform
 */
export async function isNativeSizeAvailable(): Promise<boolean> {
  const isWindows = platform() === 'win32';
  
  try {
    if (isWindows) {
      await execAsync('dir /?');
    } else {
      await execAsync('du --version');
    }
    return true;
  } catch {
    return false;
  }
}
