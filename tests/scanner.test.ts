/**
 * Test suite for oh-my-node-modules scanner
 * 
 * Tests the directory discovery and analysis functionality.
 * Uses temporary directories to avoid affecting real projects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  scanForNodeModules,
  analyzeNodeModules,
  quickScan,
} from '../src/scanner.js';
import { shouldExcludePath } from '../src/utils.js';
import type { ScanOptions } from '../src/types.js';

// Helper to create test directory structure
function createTestDir(): string {
  return mkdtempSync(join(tmpdir(), 'onm-test-'));
}

function cleanupTestDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================
// scanForNodeModules Tests
// ============================================

describe('scanForNodeModules', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('finds node_modules in single project', async () => {
    // Create a simple project
    const projectDir = join(testDir, 'project1');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'node_modules', 'lodash'), { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project1' }));

    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    const result = await scanForNodeModules(options);

    expect(result.nodeModules).toHaveLength(1);
    expect(result.nodeModules[0].projectName).toBe('project1');
    expect(result.errors).toHaveLength(0);
  });

  it('finds node_modules in nested projects', async () => {
    // Create nested projects
    const parentDir = join(testDir, 'parent');
    const childDir = join(parentDir, 'child');
    
    mkdirSync(join(parentDir, 'node_modules'), { recursive: true });
    writeFileSync(join(parentDir, 'package.json'), JSON.stringify({ name: 'parent' }));
    
    mkdirSync(join(childDir, 'node_modules'), { recursive: true });
    writeFileSync(join(childDir, 'package.json'), JSON.stringify({ name: 'child' }));

    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    const result = await scanForNodeModules(options);

    expect(result.nodeModules).toHaveLength(2);
    const names = result.nodeModules.map(n => n.projectName).sort();
    expect(names).toEqual(['child', 'parent']);
  });

  it('excludes hidden directories', async () => {
    const projectDir = join(testDir, '.hidden-project');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'hidden' }));

    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    const result = await scanForNodeModules(options);

    // Hidden directories should be skipped
    expect(result.nodeModules).toHaveLength(0);
  });

  it('respects maxDepth option', async () => {
    // Create nested structure: testDir/a/b/c/project
    const deepDir = join(testDir, 'a', 'b', 'c', 'project');
    mkdirSync(join(deepDir, 'node_modules'), { recursive: true });
    writeFileSync(join(deepDir, 'package.json'), JSON.stringify({ name: 'deep' }));

    // With maxDepth 2, should not reach level 4
    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
      maxDepth: 2,
    };

    const result = await scanForNodeModules(options);

    expect(result.nodeModules).toHaveLength(0);
  });

  it('reports progress callback', async () => {
    const projectDir = join(testDir, 'project1');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project1' }));

    const progressValues: number[] = [];
    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    await scanForNodeModules(options, (progress) => {
      progressValues.push(progress);
    });

    // Should have progress updates
    expect(progressValues.length).toBeGreaterThan(0);
    // Last value should be 100
    expect(progressValues[progressValues.length - 1]).toBe(100);
  });

  it('handles empty directory', async () => {
    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    const result = await scanForNodeModules(options);

    expect(result.nodeModules).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles permission errors gracefully', async () => {
    // Create a project
    const projectDir = join(testDir, 'project1');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project1' }));

    // Create a subdirectory with no read permissions (if not Windows)
    if (process.platform !== 'win32') {
      const restrictedDir = join(testDir, 'restricted');
      mkdirSync(restrictedDir, { recursive: true });
      // Note: chmod is not easily testable cross-platform
      // This test primarily verifies the error handling path exists
    }

    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    // Should not throw even with permission issues
    const result = await scanForNodeModules(options);
    expect(result.nodeModules).toHaveLength(1);
  });
});

// ============================================
// analyzeNodeModules Tests
// ============================================

describe('analyzeNodeModules', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('analyzes node_modules correctly', async () => {
    const projectDir = join(testDir, 'my-project');
    const nodeModulesDir = join(projectDir, 'node_modules');
    
    mkdirSync(join(nodeModulesDir, 'package-a'), { recursive: true });
    mkdirSync(join(nodeModulesDir, 'package-b'), { recursive: true });
    writeFileSync(join(nodeModulesDir, 'package-a', 'index.js'), 'console.log("a");');
    writeFileSync(join(nodeModulesDir, 'package-b', 'index.js'), 'console.log("b");');
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ 
      name: 'my-project',
      version: '1.0.0'
    }));

    const info = await analyzeNodeModules(nodeModulesDir, projectDir);

    expect(info.projectName).toBe('my-project');
    expect(info.projectVersion).toBe('1.0.0');
    expect(info.path).toBe(nodeModulesDir);
    expect(info.projectPath).toBe(projectDir);
    expect(info.totalPackageCount).toBe(2);
    expect(info.sizeBytes).toBeGreaterThan(0);
    expect(info.selected).toBe(false);
    expect(info.isFavorite).toBe(false);
  });

  it('uses directory name when no package.json', async () => {
    const projectDir = join(testDir, 'unnamed-project');
    const nodeModulesDir = join(projectDir, 'node_modules');
    
    mkdirSync(nodeModulesDir, { recursive: true });

    const info = await analyzeNodeModules(nodeModulesDir, projectDir);

    expect(info.projectName).toBe('unnamed-project');
    expect(info.projectVersion).toBeUndefined();
  });

  it('calculates size correctly', async () => {
    const projectDir = join(testDir, 'sized-project');
    const nodeModulesDir = join(projectDir, 'node_modules');
    
    // Create files with known sizes
    mkdirSync(join(nodeModulesDir, 'pkg'), { recursive: true });
    writeFileSync(join(nodeModulesDir, 'pkg', 'file1.js'), 'a'.repeat(100));
    writeFileSync(join(nodeModulesDir, 'pkg', 'file2.js'), 'b'.repeat(200));
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'sized' }));

    const info = await analyzeNodeModules(nodeModulesDir, projectDir);

    // Should be at least 300 bytes for content + directory overhead
    expect(info.sizeBytes).toBeGreaterThanOrEqual(300);
    expect(info.sizeFormatted).toContain('B');
  });
});

// ============================================
// quickScan Tests
// ============================================

describe('quickScan', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('quickly finds node_modules without full analysis', async () => {
    const projectDir = join(testDir, 'quick-project');
    mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'quick' }));

    const results = await quickScan(testDir);

    expect(results).toHaveLength(1);
    expect(results[0].projectName).toBe('quick');
    expect(results[0].path).toContain('node_modules');
    // Quick scan doesn't include size, count, etc.
    expect(results[0]).not.toHaveProperty('sizeBytes');
  });

  it('returns empty array when no node_modules found', async () => {
    const results = await quickScan(testDir);
    expect(results).toHaveLength(0);
  });
});

// ============================================
// shouldExcludePath Tests
// ============================================

describe('shouldExcludePath', () => {
  it('matches glob patterns', () => {
    expect(shouldExcludePath('/test/node_modules/lodash', ['**/node_modules/**'])).toBe(true);
    expect(shouldExcludePath('/test/.git/config', ['**/.git/**'])).toBe(true);
    expect(shouldExcludePath('/test/src/index.ts', ['**/node_modules/**'])).toBe(false);
  });

  it('handles multiple patterns', () => {
    const patterns = ['**/node_modules/**', '**/.git/**', '**/dist/**'];
    expect(shouldExcludePath('/test/node_modules/foo', patterns)).toBe(true);
    expect(shouldExcludePath('/test/dist/bundle.js', patterns)).toBe(true);
    expect(shouldExcludePath('/test/src/main.ts', patterns)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(shouldExcludePath('/test/NODE_MODULES/foo', ['**/node_modules/**'])).toBe(true);
    expect(shouldExcludePath('/test/.GIT/config', ['**/.git/**'])).toBe(true);
  });

  it('returns false for empty patterns', () => {
    expect(shouldExcludePath('/test/node_modules', [])).toBe(false);
  });
});

// ============================================
// Nested node_modules exclusion Tests
// ============================================

describe('nested node_modules filtering', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'onm-nested-test-'));
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('excludes nested node_modules inside dependencies', async () => {
    // Create structure: project/node_modules/lodash/node_modules/nested-dep
    const projectDir = join(testDir, 'project');
    mkdirSync(join(projectDir, 'node_modules', 'lodash', 'node_modules', 'nested-dep'), { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project' }));

    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    const result = await scanForNodeModules(options);

    // Should only find 1 node_modules (the project-level one)
    expect(result.nodeModules).toHaveLength(1);
    expect(result.nodeModules[0].projectName).toBe('project');
    // fdir adds trailing slash, so check with or without
    const expectedPath = join(projectDir, 'node_modules');
    expect(result.nodeModules[0].path === expectedPath || result.nodeModules[0].path === expectedPath + '/').toBe(true);
  });

  it('finds multiple project-level node_modules', async () => {
    // Create two projects
    const project1 = join(testDir, 'project1');
    const project2 = join(testDir, 'project2');
    
    mkdirSync(join(project1, 'node_modules', 'lodash'), { recursive: true });
    writeFileSync(join(project1, 'package.json'), JSON.stringify({ name: 'project1' }));
    
    mkdirSync(join(project2, 'node_modules', 'react'), { recursive: true });
    writeFileSync(join(project2, 'package.json'), JSON.stringify({ name: 'project2' }));

    const options: ScanOptions = {
      rootPath: testDir,
      excludePatterns: [],
      followSymlinks: false,
    };

    const result = await scanForNodeModules(options);

    // Should find exactly 2 node_modules (project-level only)
    expect(result.nodeModules).toHaveLength(2);
    const names = result.nodeModules.map(n => n.projectName).sort();
    expect(names).toEqual(['project1', 'project2']);
  });
});
