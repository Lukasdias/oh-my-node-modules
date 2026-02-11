/**
 * Test suite for oh-my-node-modules utilities
 * 
 * Tests use Vitest and focus on pure functions in utils.ts
 * These are the easiest to test and most critical to get right.
 */

import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  parseSize,
  formatRelativeTime,
  getSizeCategory,
  getAgeCategory,
  sortNodeModules,
  filterNodeModules,
  calculateStatistics,
  toggleSelection,
  shouldExcludePath,
  SIZE_THRESHOLDS,
} from '../src/utils.js';
import type { NodeModulesInfo, SortOption } from '../src/types.js';

// ============================================
// formatBytes Tests
// ============================================

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('shows decimal places for larger units', () => {
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatBytes(2048 * 1024 * 1024)).toBe('2.0 GB');
  });
});

// ============================================
// parseSize Tests
// ============================================

describe('parseSize', () => {
  it('parses bytes', () => {
    expect(parseSize('100')).toBe(100);
    expect(parseSize('100b')).toBe(100);
    expect(parseSize('100B')).toBe(100);
  });

  it('parses kilobytes', () => {
    expect(parseSize('1kb')).toBe(1024);
    expect(parseSize('1KB')).toBe(1024);
    expect(parseSize('2.5kb')).toBe(2560);
  });

  it('parses megabytes', () => {
    expect(parseSize('1mb')).toBe(1024 * 1024);
    expect(parseSize('500MB')).toBe(500 * 1024 * 1024);
  });

  it('parses gigabytes', () => {
    expect(parseSize('1gb')).toBe(1024 * 1024 * 1024);
    expect(parseSize('2GB')).toBe(2 * 1024 * 1024 * 1024);
  });

  it('handles whitespace', () => {
    expect(parseSize('  1 gb  ')).toBe(1024 * 1024 * 1024);
  });

  it('returns undefined for invalid input', () => {
    expect(parseSize('invalid')).toBeUndefined();
    expect(parseSize('')).toBeUndefined();
  });
});

// ============================================
// formatRelativeTime Tests
// ============================================

describe('formatRelativeTime', () => {
  it('formats recent times', () => {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    expect(formatRelativeTime(now)).toBe('just now');
    expect(formatRelativeTime(oneMinuteAgo)).toBe('just now');
    expect(formatRelativeTime(thirtyMinutesAgo)).toBe('30m ago');
  });

  it('formats days', () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    expect(formatRelativeTime(oneDayAgo)).toBe('1d ago');
    expect(formatRelativeTime(thirtyDaysAgo)).toBe('1mo ago');
  });

  it('formats months and years', () => {
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    
    expect(formatRelativeTime(sixtyDaysAgo)).toBe('2mo ago');
    expect(formatRelativeTime(yearAgo)).toBe('1y ago');
  });
});

// ============================================
// getSizeCategory Tests
// ============================================

describe('getSizeCategory', () => {
  it('categorizes sizes correctly', () => {
    expect(getSizeCategory(50 * 1024 * 1024)).toBe('small');
    expect(getSizeCategory(200 * 1024 * 1024)).toBe('medium');
    expect(getSizeCategory(600 * 1024 * 1024)).toBe('large');
    expect(getSizeCategory(2 * 1024 * 1024 * 1024)).toBe('huge');
  });

  it('handles boundary values', () => {
    expect(getSizeCategory(SIZE_THRESHOLDS.SMALL - 1)).toBe('small');
    expect(getSizeCategory(SIZE_THRESHOLDS.SMALL)).toBe('small');
    expect(getSizeCategory(SIZE_THRESHOLDS.SMALL + 1)).toBe('medium');
    expect(getSizeCategory(SIZE_THRESHOLDS.MEDIUM)).toBe('medium');
    expect(getSizeCategory(SIZE_THRESHOLDS.MEDIUM + 1)).toBe('large');
    expect(getSizeCategory(SIZE_THRESHOLDS.LARGE)).toBe('large');
    expect(getSizeCategory(SIZE_THRESHOLDS.LARGE + 1)).toBe('huge');
  });
});

// ============================================
// getAgeCategory Tests
// ============================================

describe('getAgeCategory', () => {
  it('categorizes ages correctly', () => {
    const now = new Date();
    
    const fresh = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const stale = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    
    expect(getAgeCategory(fresh)).toBe('fresh');
    expect(getAgeCategory(recent)).toBe('recent');
    expect(getAgeCategory(old)).toBe('old');
    expect(getAgeCategory(stale)).toBe('stale');
  });
});

// ============================================
// sortNodeModules Tests
// ============================================

describe('sortNodeModules', () => {
  const createItem = (name: string, size: number, date: Date, packages: number): NodeModulesInfo => ({
    path: `/test/${name}`,
    projectPath: `/test/${name}`,
    projectName: name,
    sizeBytes: size,
    sizeFormatted: formatBytes(size),
    packageCount: packages,
    totalPackageCount: packages,
    lastModified: date,
    lastModifiedFormatted: formatRelativeTime(date),
    selected: false,
    isFavorite: false,
    ageCategory: 'fresh',
    sizeCategory: getSizeCategory(size),
  });

  it('sorts by size descending', () => {
    const items = [
      createItem('small', 100, new Date(), 10),
      createItem('large', 1000, new Date(), 10),
      createItem('medium', 500, new Date(), 10),
    ];
    
    const sorted = sortNodeModules(items, 'size-desc');
    expect(sorted[0].projectName).toBe('large');
    expect(sorted[1].projectName).toBe('medium');
    expect(sorted[2].projectName).toBe('small');
  });

  it('sorts by size ascending', () => {
    const items = [
      createItem('large', 1000, new Date(), 10),
      createItem('small', 100, new Date(), 10),
      createItem('medium', 500, new Date(), 10),
    ];
    
    const sorted = sortNodeModules(items, 'size-asc');
    expect(sorted[0].projectName).toBe('small');
    expect(sorted[1].projectName).toBe('medium');
    expect(sorted[2].projectName).toBe('large');
  });

  it('sorts by name', () => {
    const items = [
      createItem('zebra', 100, new Date(), 10),
      createItem('apple', 100, new Date(), 10),
      createItem('banana', 100, new Date(), 10),
    ];
    
    const sorted = sortNodeModules(items, 'name-asc');
    expect(sorted[0].projectName).toBe('apple');
    expect(sorted[1].projectName).toBe('banana');
    expect(sorted[2].projectName).toBe('zebra');
  });

  it('does not mutate original array', () => {
    const items = [
      createItem('b', 200, new Date(), 10),
      createItem('a', 100, new Date(), 10),
    ];
    
    const originalOrder = items.map(i => i.projectName);
    sortNodeModules(items, 'name-asc');
    expect(items.map(i => i.projectName)).toEqual(originalOrder);
  });
});

// ============================================
// filterNodeModules Tests
// ============================================

describe('filterNodeModules', () => {
  const createItem = (name: string): NodeModulesInfo => ({
    path: `/test/${name}/node_modules`,
    projectPath: `/test/${name}`,
    projectName: name,
    sizeBytes: 100,
    sizeFormatted: '100 B',
    packageCount: 10,
    totalPackageCount: 10,
    lastModified: new Date(),
    lastModifiedFormatted: '1d ago',
    selected: false,
    isFavorite: false,
    ageCategory: 'fresh',
    sizeCategory: 'small',
  });

  it('filters by project name', () => {
    const items = [
      createItem('my-app'),
      createItem('test-suite'),
      createItem('my-api'),
    ];
    
    const filtered = filterNodeModules(items, 'my');
    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.projectName)).toContain('my-app');
    expect(filtered.map(i => i.projectName)).toContain('my-api');
  });

  it('filters case-insensitively', () => {
    const items = [createItem('MyApp')];
    const filtered = filterNodeModules(items, 'myapp');
    expect(filtered).toHaveLength(1);
  });

  it('returns all items when query is empty', () => {
    const items = [createItem('a'), createItem('b')];
    expect(filterNodeModules(items, '')).toHaveLength(2);
    expect(filterNodeModules(items, '   ')).toHaveLength(2);
  });

  it('filters by path', () => {
    const items = [
      createItem('app'),
      createItem('test'),
    ];
    items[1].path = '/special/test/node_modules';
    
    const filtered = filterNodeModules(items, 'special');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].projectName).toBe('test');
  });
});

// ============================================
// calculateStatistics Tests
// ============================================

describe('calculateStatistics', () => {
  const createItem = (name: string, size: number, selected: boolean): NodeModulesInfo => ({
    path: `/test/${name}`,
    projectPath: `/test/${name}`,
    projectName: name,
    sizeBytes: size,
    sizeFormatted: formatBytes(size),
    packageCount: 10,
    totalPackageCount: 10,
    lastModified: new Date(),
    lastModifiedFormatted: '1d ago',
    selected,
    isFavorite: false,
    ageCategory: 'fresh',
    sizeCategory: getSizeCategory(size),
  });

  it('calculates totals correctly', () => {
    const items = [
      createItem('a', 100, false),
      createItem('b', 200, false),
    ];
    
    const stats = calculateStatistics(items);
    expect(stats.totalProjects).toBe(2);
    expect(stats.totalNodeModules).toBe(2);
    expect(stats.totalSizeBytes).toBe(300);
  });

  it('calculates selected totals', () => {
    const items = [
      createItem('a', 100, true),
      createItem('b', 200, false),
      createItem('c', 300, true),
    ];
    
    const stats = calculateStatistics(items);
    expect(stats.selectedCount).toBe(2);
    expect(stats.selectedSizeBytes).toBe(400);
  });

  it('handles empty array', () => {
    const stats = calculateStatistics([]);
    expect(stats.totalProjects).toBe(0);
    expect(stats.totalSizeBytes).toBe(0);
    expect(stats.averageAgeDays).toBe(0);
  });
});

// ============================================
// toggleSelection Tests
// ============================================

describe('toggleSelection', () => {
  const createItem = (name: string, selected: boolean): NodeModulesInfo => ({
    path: `/test/${name}`,
    projectPath: `/test/${name}`,
    projectName: name,
    sizeBytes: 100,
    sizeFormatted: '100 B',
    packageCount: 10,
    totalPackageCount: 10,
    lastModified: new Date(),
    lastModifiedFormatted: '1d ago',
    selected,
    isFavorite: false,
    ageCategory: 'fresh',
    sizeCategory: 'small',
  });

  it('toggles selection on', () => {
    const items = [
      createItem('a', false),
      createItem('b', false),
    ];
    
    const result = toggleSelection(items, 0);
    expect(result[0].selected).toBe(true);
    expect(result[1].selected).toBe(false);
  });

  it('toggles selection off', () => {
    const items = [
      createItem('a', true),
      createItem('b', false),
    ];
    
    const result = toggleSelection(items, 0);
    expect(result[0].selected).toBe(false);
  });

  it('returns same array for invalid index', () => {
    const items = [createItem('a', false)];
    expect(toggleSelection(items, -1)).toBe(items);
    expect(toggleSelection(items, 5)).toBe(items);
  });

  it('does not mutate original', () => {
    const items = [createItem('a', false)];
    const result = toggleSelection(items, 0);
    expect(items[0].selected).toBe(false);
    expect(result[0].selected).toBe(true);
  });
});

// ============================================
// shouldExcludePath Tests
// ============================================

describe('shouldExcludePath', () => {
  it('matches simple patterns', () => {
    expect(shouldExcludePath('/test/node_modules/foo', ['**/node_modules/**'])).toBe(true);
    expect(shouldExcludePath('/test/.git/config', ['**/.git/**'])).toBe(true);
  });

  it('matches multiple patterns', () => {
    const patterns = ['**/node_modules/**', '**/.git/**'];
    expect(shouldExcludePath('/test/node_modules/lodash', patterns)).toBe(true);
    expect(shouldExcludePath('/test/.git/config', patterns)).toBe(true);
    expect(shouldExcludePath('/test/src', patterns)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(shouldExcludePath('/test/NODE_MODULES/lodash', ['**/node_modules/**'])).toBe(true);
  });

  it('returns false for empty patterns', () => {
    expect(shouldExcludePath('/test', [])).toBe(false);
  });
});
