import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  deleteSelectedNodeModules,
  generateDeletionPreview,
  generateJSONReport,
  selectBySize,
  selectByAge,
  selectAll,
  invertSelection,
} from '../src/deletion.js';
import type { NodeModulesInfo, DeleteOptions } from '../src/types.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'onm-del-test-'));
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

function createMockNodeModules(name: string, sizeBytes: number = 100, selected: boolean = false): NodeModulesInfo {
  return {
    path: join(testDir, name, 'node_modules'),
    projectPath: join(testDir, name),
    projectName: name,
    sizeBytes,
    sizeFormatted: sizeBytes < 1024 ? `${sizeBytes} B` : `${Math.floor(sizeBytes / 1024)} KB`,
    packageCount: 1,
    totalPackageCount: 1,
    lastModified: new Date(Date.now() - 86400000),
    lastModifiedFormatted: '1d ago',
    selected,
    isFavorite: false,
    ageCategory: 'recent',
    sizeCategory: sizeBytes > 1024 * 1024 ? 'large' : 'small',
  };
}

describe('deleteSelectedNodeModules', () => {
  it('deletes selected node_modules in dry run mode', async () => {
    const projectDir = join(testDir, 'project1');
    const nodeModulesDir = join(projectDir, 'node_modules');
    mkdirSync(nodeModulesDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project1' }));
    writeFileSync(join(nodeModulesDir, 'test.txt'), 'test content');

    const items: NodeModulesInfo[] = [
      { ...createMockNodeModules('project1', 100, true), path: nodeModulesDir, projectPath: projectDir },
    ];

    const options: DeleteOptions = {
      dryRun: true,
      yes: true,
      checkRunningProcesses: false,
      showProgress: false,
    };

    const result = await deleteSelectedNodeModules(items, options);

    expect(result.totalAttempted).toBe(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.bytesFreed).toBe(100);
    expect(existsSync(nodeModulesDir)).toBe(true);
  });

  it('actually deletes node_modules when not in dry run', async () => {
    const projectDir = join(testDir, 'project1');
    const nodeModulesDir = join(projectDir, 'node_modules');
    mkdirSync(nodeModulesDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project1' }));
    writeFileSync(join(nodeModulesDir, 'test.txt'), 'test content');

    const items: NodeModulesInfo[] = [
      { ...createMockNodeModules('project1', 100, true), path: nodeModulesDir, projectPath: projectDir },
    ];

    const options: DeleteOptions = {
      dryRun: false,
      yes: true,
      checkRunningProcesses: false,
      showProgress: false,
    };

    const result = await deleteSelectedNodeModules(items, options);

    expect(result.totalAttempted).toBe(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(existsSync(nodeModulesDir)).toBe(false);
  });

  it('skips unselected items', async () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('project1', 100, false),
      createMockNodeModules('project2', 200, false),
    ];

    const options: DeleteOptions = {
      dryRun: false,
      yes: true,
      checkRunningProcesses: false,
      showProgress: false,
    };

    const result = await deleteSelectedNodeModules(items, options);

    expect(result.totalAttempted).toBe(0);
    expect(result.successful).toBe(0);
    expect(result.bytesFreed).toBe(0);
  });

  it('reports progress via callback', async () => {
    const projectDir = join(testDir, 'project1');
    const nodeModulesDir = join(projectDir, 'node_modules');
    mkdirSync(nodeModulesDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'project1' }));

    const items: NodeModulesInfo[] = [
      { ...createMockNodeModules('project1', 100, true), path: nodeModulesDir, projectPath: projectDir },
    ];

    const progressUpdates: Array<{ current: number; total: number; label: string }> = [];
    const options: DeleteOptions = {
      dryRun: true,
      yes: true,
      checkRunningProcesses: false,
      showProgress: true,
    };

    await deleteSelectedNodeModules(items, options, (current, total, label) => {
      progressUpdates.push({ current, total, label });
    });

    expect(progressUpdates).toHaveLength(1);
    expect(progressUpdates[0].current).toBe(1);
    expect(progressUpdates[0].total).toBe(1);
    expect(progressUpdates[0].label).toBe('project1');
  });

  it('fails for invalid paths', async () => {
    const items: NodeModulesInfo[] = [
      { ...createMockNodeModules('project1', 100, true), path: '/nonexistent/path/invalid_dir' },
    ];

    const options: DeleteOptions = {
      dryRun: false,
      yes: true,
      checkRunningProcesses: false,
      showProgress: false,
    };

    const result = await deleteSelectedNodeModules(items, options);

    expect(result.totalAttempted).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.details[0].error).toContain('not appear to be a node_modules');
  });
});

describe('generateDeletionPreview', () => {
  it('generates preview for selected items', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('project1', 100, true),
      createMockNodeModules('project2', 200, true),
      createMockNodeModules('project3', 300, false),
    ];

    const preview = generateDeletionPreview(items);

    expect(preview).toContain('2 node_modules');
    expect(preview).toContain('project1');
    expect(preview).toContain('project2');
    expect(preview).not.toContain('project3');
  });

  it('handles empty selection', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('project1', 100, false),
    ];

    const preview = generateDeletionPreview(items);

    expect(preview).toContain('No node_modules selected');
  });
});

describe('generateJSONReport', () => {
  it('generates valid JSON report', () => {
    const result = {
      totalAttempted: 2,
      successful: 1,
      failed: 1,
      bytesFreed: 1024,
      formattedBytesFreed: '1 KB',
      details: [
        {
          nodeModules: createMockNodeModules('project1', 512, true),
          success: true,
          durationMs: 100,
        },
        {
          nodeModules: createMockNodeModules('project2', 512, true),
          success: false,
          error: 'Permission denied',
          durationMs: 50,
        },
      ],
    };

    const json = generateJSONReport(result);
    const parsed = JSON.parse(json);

    expect(parsed.summary.totalAttempted).toBe(2);
    expect(parsed.summary.successful).toBe(1);
    expect(parsed.summary.failed).toBe(1);
    expect(parsed.details).toHaveLength(2);
    expect(parsed.details[0].success).toBe(true);
    expect(parsed.details[1].error).toBe('Permission denied');
  });
});

describe('selectBySize', () => {
  it('selects items larger than threshold', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('small', 100, false),
      createMockNodeModules('medium', 500, false),
      createMockNodeModules('large', 1000, false),
    ];

    const result = selectBySize(items, 400);

    expect(result[0].selected).toBe(false);
    expect(result[1].selected).toBe(true);
    expect(result[2].selected).toBe(true);
  });

  it('includes items exactly at threshold', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('exact', 500, false),
    ];

    const result = selectBySize(items, 500);

    expect(result[0].selected).toBe(true);
  });
});

describe('selectByAge', () => {
  it('selects items older than threshold', () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const items: NodeModulesInfo[] = [
      { ...createMockNodeModules('old', 100, false), lastModified: old },
      { ...createMockNodeModules('recent', 100, false), lastModified: recent },
    ];

    const result = selectByAge(items, 5);

    expect(result[0].selected).toBe(true);
    expect(result[1].selected).toBe(false);
  });
});

describe('selectAll', () => {
  it('selects all items', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('a', 100, false),
      createMockNodeModules('b', 100, false),
    ];

    const result = selectAll(items, true);

    expect(result.every(i => i.selected)).toBe(true);
  });

  it('deselects all items', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('a', 100, true),
      createMockNodeModules('b', 100, true),
    ];

    const result = selectAll(items, false);

    expect(result.every(i => !i.selected)).toBe(true);
  });
});

describe('invertSelection', () => {
  it('inverts selection state', () => {
    const items: NodeModulesInfo[] = [
      createMockNodeModules('a', 100, true),
      createMockNodeModules('b', 100, false),
      createMockNodeModules('c', 100, true),
    ];

    const result = invertSelection(items);

    expect(result[0].selected).toBe(false);
    expect(result[1].selected).toBe(true);
    expect(result[2].selected).toBe(false);
  });
});
