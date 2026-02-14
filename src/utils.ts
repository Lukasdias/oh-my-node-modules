/**
 * Utility functions for oh-my-node-modules
 * 
 * This module provides pure functions for common operations like
 * formatting bytes, parsing sizes, and date calculations.
 * Pure functions make testing easier and reduce side effects.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { 
  NodeModulesInfo, 
  AgeCategory, 
  SizeCategory,
  SortOption,
  ScanStatistics
} from './types.js';
import { SIZE_THRESHOLDS, AGE_THRESHOLDS } from './types.js';

// Re-export for convenience
export { SIZE_THRESHOLDS, AGE_THRESHOLDS };
export type { ScanStatistics };

/**
 * Format bytes into human-readable string.
 * Uses binary units (MiB, GiB) for accuracy.
 * 
 * @param bytes - Number of bytes to format
 * @returns Formatted string like "1.2 GB" or "456 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const base = 1024;
  const exponent = Math.floor(Math.log(bytes) / Math.log(base));
  const unit = units[Math.min(exponent, units.length - 1)];
  const value = bytes / Math.pow(base, exponent);
  
  // Show 1 decimal place for MB and above, 0 for smaller
  const decimals = exponent >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${unit}`;
}

/**
 * Parse human-readable size string into bytes.
 * Supports formats like "1gb", "500MB", "10mb"
 * 
 * @param sizeStr - Size string to parse
 * @returns Size in bytes, or undefined if invalid
 */
export function parseSize(sizeStr: string): number | undefined {
  const match = sizeStr.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!match) return undefined;
  
  const value = parseFloat(match[1]);
  const unit = match[2] || 'b';
  
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  };
  
  return Math.floor(value * (multipliers[unit] || 1));
}

/**
 * Format a date into "X days ago" string.
 * Provides more readable relative time than raw dates.
 * 
 * @param date - Date to format
 * @returns Formatted string like "30d ago" or "2d ago"
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? 'just now' : `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Determine size category based on bytes.
 * Used for color coding and smart selection.
 * 
 * @param bytes - Size in bytes
 * @returns Size category
 */
export function getSizeCategory(bytes: number): SizeCategory {
  if (bytes > SIZE_THRESHOLDS.LARGE) return 'huge';
  if (bytes > SIZE_THRESHOLDS.MEDIUM) return 'large';
  if (bytes > SIZE_THRESHOLDS.SMALL) return 'medium';
  return 'small';
}

/**
 * Determine age category based on days since modification.
 * Used to identify potentially stale node_modules.
 * 
 * @param lastModified - Last modification date
 * @returns Age category
 */
export function getAgeCategory(lastModified: Date): AgeCategory {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays > AGE_THRESHOLDS.OLD) return 'stale';
  if (diffDays > AGE_THRESHOLDS.RECENT) return 'old';
  if (diffDays > AGE_THRESHOLDS.FRESH) return 'recent';
  return 'fresh';
}

/**
 * Calculate age in days from a date.
 * 
 * @param date - Date to calculate age from
 * @returns Number of days
 */
export function getAgeInDays(date: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Sort node_modules by the specified option.
 * Pure function that returns a new sorted array.
 * 
 * @param items - Array to sort
 * @param sortBy - Sort option
 * @returns New sorted array
 */
export function sortNodeModules(
  items: NodeModulesInfo[],
  sortBy: SortOption
): NodeModulesInfo[] {
  const sorted = [...items]; // Create copy to avoid mutation
  
  switch (sortBy) {
    case 'size-desc':
      return sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case 'size-asc':
      return sorted.sort((a, b) => a.sizeBytes - b.sizeBytes);
    case 'date-desc':
      return sorted.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    case 'date-asc':
      return sorted.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
    case 'name-asc':
      return sorted.sort((a, b) => a.projectName.localeCompare(b.projectName));
    case 'name-desc':
      return sorted.sort((a, b) => b.projectName.localeCompare(a.projectName));
    case 'packages-desc':
      return sorted.sort((a, b) => b.totalPackageCount - a.totalPackageCount);
    case 'packages-asc':
      return sorted.sort((a, b) => a.totalPackageCount - b.totalPackageCount);
    default:
      return sorted;
  }
}

/**
 * Filter node_modules by search query.
 * Matches against project name and path.
 * 
 * @param items - Array to filter
 * @param query - Search query (case-insensitive)
 * @returns Filtered array
 */
export function filterNodeModules(
  items: NodeModulesInfo[],
  query: string
): NodeModulesInfo[] {
  if (!query.trim()) return items;
  
  const lowerQuery = query.toLowerCase();
  return items.filter(item => 
    item.projectName.toLowerCase().includes(lowerQuery) ||
    item.path.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Calculate statistics from node_modules list.
 * Used for overview displays and summaries.
 * 
 * @param items - Node modules to analyze
 * @returns Calculated statistics
 */
export function calculateStatistics(items: NodeModulesInfo[]): ScanStatistics {
  const selectedItems = items.filter(item => item.selected);
  const totalSize = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const selectedSize = selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0);
  
  const totalAge = items.reduce((sum, item) => {
    return sum + getAgeInDays(item.lastModified);
  }, 0);
  
  const staleCount = items.filter(item => item.ageCategory === 'stale').length;
  
  return {
    totalProjects: new Set(items.map(item => item.projectPath)).size,
    totalNodeModules: items.length,
    totalSizeBytes: totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    selectedCount: selectedItems.length,
    selectedSizeBytes: selectedSize,
    selectedSizeFormatted: formatBytes(selectedSize),
    averageAgeDays: items.length > 0 ? Math.round(totalAge / items.length) : 0,
    staleCount,
  };
}

/**
 * Check if a path should be excluded based on patterns.
 * Supports glob-like patterns with * and ? wildcards.
 * 
 * @param path - Path to check
 * @param patterns - Exclusion patterns
 * @returns True if path should be excluded
 */
export function shouldExcludePath(path: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    // Handle the special case of hidden directories: **/.* or .*
    // This should match paths like /home/user/.config or .git
    // but NOT ./ or paths like ./personal
    if (pattern === '**/.*' || pattern === '.*') {
      // Match any component that starts with a dot followed by actual characters
      return /(^|\/)\.[^\/]+($|\/)/.test(path);
    }
    
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');
    
    const regex = new RegExp(regexPattern, 'i');
    return regex.test(path);
  });
}

/**
 * Toggle selection state for a node_modules item.
 * Returns new array with toggled item (immutable update).
 * 
 * @param items - Current items array
 * @param index - Index of item to toggle
 * @returns New array with toggled selection
 */
export function toggleSelection(
  items: NodeModulesInfo[],
  index: number
): NodeModulesInfo[] {
  if (index < 0 || index >= items.length) return items;
  
  return items.map((item, i) => 
    i === index ? { ...item, selected: !item.selected } : item
  );
}

/**
 * Select or deselect all items matching a predicate.
 * Useful for "select all >500MB" or "select all stale" operations.
 * 
 * @param items - Current items array
 * @param predicate - Function to determine which items to select
 * @param selected - Whether to select (true) or deselect (false)
 * @returns New array with updated selections
 */
export function selectByPredicate(
  items: NodeModulesInfo[],
  predicate: (item: NodeModulesInfo) => boolean,
  selected: boolean
): NodeModulesInfo[] {
  return items.map(item => 
    predicate(item) ? { ...item, selected } : item
  );
}

/**
 * Get a color for a size category.
 * Used for consistent visual feedback across the TUI.
 * 
 * @param category - Size category
 * @returns Color name for Ink Text component
 */
export function getSizeColor(category: SizeCategory): string {
  switch (category) {
    case 'huge': return 'red';
    case 'large': return 'yellow';
    case 'medium': return 'cyan';
    case 'small': return 'green';
    default: return 'white';
  }
}

/**
 * Get a color for an age category.
 * 
 * @param category - Age category
 * @returns Color name for Ink Text component
 */
export function getAgeColor(category: AgeCategory): string {
  switch (category) {
    case 'stale': return 'gray';
    case 'old': return 'yellow';
    case 'recent': return 'cyan';
    case 'fresh': return 'green';
    default: return 'white';
  }
}

/**
 * Calculate a cleanup priority score for a node_modules.
 * Larger and older = higher priority for cleanup.
 * 
 * @param item - Node modules to score
 * @returns Priority score (higher = more urgent to clean)
 */
export function getCleanupPriority(item: NodeModulesInfo): number {
  // Size score: logarithmic scale, 1GB = 100 points
  const sizeScore = Math.log2(item.sizeBytes + 1) * 10;
  
  // Age score: 1 year = 100 points
  const ageScore = getAgeInDays(item.lastModified);
  
  // Combined score: prioritize large and old
  return Math.round(sizeScore + (ageScore / 3));
}

/**
 * Sort node_modules by cleanup priority (highest first).
 * Combines size and age for intelligent ranking.
 * 
 * @param items - Array to sort
 * @returns New sorted array with highest priority first
 */
export function sortByCleanupPriority(items: NodeModulesInfo[]): NodeModulesInfo[] {
  return [...items].sort((a, b) => getCleanupPriority(b) - getCleanupPriority(a));
}

/**
 * Truncate a string to fit within a maximum length.
 * Adds ellipsis if truncated.
 * 
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  if (maxLength <= 3) return str.slice(0, maxLength);
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Safe file existence check that doesn't throw.
 * Useful for checking if package.json exists before parsing.
 * 
 * @param path - Path to check
 * @returns True if file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse package.json safely.
 * Returns undefined if file doesn't exist or is invalid.
 * 
 * @param projectPath - Path to project directory
 * @returns Parsed package.json or undefined
 */
export async function readPackageJson(
  projectPath: string
): Promise<{ name?: string; version?: string } | undefined> {
  const packagePath = join(projectPath, 'package.json');
  
  try {
    const content = await fs.readFile(packagePath, 'utf-8');
    const parsed = JSON.parse(content) as { name?: string; version?: string };
    return parsed;
  } catch {
    return undefined;
  }
}
