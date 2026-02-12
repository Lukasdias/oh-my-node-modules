import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { 
  Header, 
  ListItem, 
  List, 
  Footer,
  Help,
  ConfirmDialog,
  ProgressBar 
} from '../src/components/index.js';
import type { NodeModulesInfo } from '../src/types.js';
import type { ScanStatistics } from '../src/types.js';

function createMockStats(overrides: Partial<ScanStatistics> = {}): ScanStatistics {
  return {
    totalProjects: 5,
    totalNodeModules: 5,
    totalSizeBytes: 1024 * 1024 * 100,
    totalSizeFormatted: '100 MB',
    selectedCount: 2,
    selectedSizeBytes: 1024 * 1024 * 50,
    selectedSizeFormatted: '50 MB',
    averageAgeDays: 10,
    staleCount: 1,
    ...overrides,
  };
}

function createMockNodeModules(overrides: Partial<NodeModulesInfo> = {}): NodeModulesInfo {
  return {
    path: '/test/project/node_modules',
    projectPath: '/test/project',
    projectName: 'test-project',
    projectVersion: '1.0.0',
    sizeBytes: 1024 * 1024,
    sizeFormatted: '1 MB',
    packageCount: 10,
    totalPackageCount: 50,
    lastModified: new Date(),
    lastModifiedFormatted: '1d ago',
    selected: false,
    isFavorite: false,
    ageCategory: 'recent',
    sizeCategory: 'small',
    ...overrides,
  };
}

describe('Header', () => {
  it('renders app title', () => {
    const { lastFrame } = render(
      <Header 
        statistics={createMockStats()} 
        isScanning={false} 
        scanProgress={0} 
      />
    );

    expect(lastFrame()).toContain('oh-my-node-modules');
  });

  it('shows scanning progress when active', () => {
    const { lastFrame } = render(
      <Header 
        statistics={createMockStats()} 
        isScanning={true} 
        scanProgress={50} 
      />
    );

    expect(lastFrame()).toContain('Scanning');
    expect(lastFrame()).toContain('50%');
  });

  it('displays statistics', () => {
    const { lastFrame } = render(
      <Header 
        statistics={createMockStats({ totalProjects: 10, totalSizeFormatted: '1 GB' })} 
        isScanning={false} 
        scanProgress={0} 
      />
    );

    expect(lastFrame()).toContain('10');
    expect(lastFrame()).toContain('1 GB');
  });
});

describe('ListItem', () => {
  it('renders project name', () => {
    const item = createMockNodeModules({ projectName: 'my-app' });
    const { lastFrame } = render(<ListItem item={item} isFocused={false} />);

    expect(lastFrame()).toContain('my-app');
  });

  it('shows version when available', () => {
    const item = createMockNodeModules({ projectVersion: '2.0.0' });
    const { lastFrame } = render(<ListItem item={item} isFocused={false} />);

    expect(lastFrame()).toContain('2.0.0');
  });

  it('shows selection indicator when selected', () => {
    const item = createMockNodeModules({ selected: true });
    const { lastFrame } = render(<ListItem item={item} isFocused={false} />);

    expect(lastFrame()).toContain('✓');
  });

  it('shows unselected indicator when not selected', () => {
    const item = createMockNodeModules({ selected: false });
    const { lastFrame } = render(<ListItem item={item} isFocused={false} />);

    expect(lastFrame()).toContain('[ ]');
  });

  it('displays warning for huge directories', () => {
    const item = createMockNodeModules({ sizeCategory: 'huge' });
    const { lastFrame } = render(<ListItem item={item} isFocused={false} />);

    expect(lastFrame()).toContain('⚠️');
  });
});

describe('List', () => {
  it('renders empty state when no items', () => {
    const { lastFrame } = render(
      <List items={[]} selectedIndex={0} visibleCount={10} />
    );

    expect(lastFrame()).toContain('No node_modules found');
  });

  it('renders items', () => {
    const items = [
      createMockNodeModules({ projectName: 'project1' }),
      createMockNodeModules({ projectName: 'project2' }),
    ];
    const { lastFrame } = render(
      <List items={items} selectedIndex={0} visibleCount={10} />
    );

    expect(lastFrame()).toContain('project1');
    expect(lastFrame()).toContain('project2');
  });

  it('shows more indicator when items overflow', () => {
    const items = Array.from({ length: 20 }, (_, i) => 
      createMockNodeModules({ projectName: `project${i}` })
    );
    const { lastFrame } = render(
      <List items={items} selectedIndex={0} visibleCount={5} />
    );

    expect(lastFrame()).toContain('more...');
  });
});

describe('Footer', () => {
  it('renders keyboard shortcuts', () => {
    const { lastFrame } = render(
      <Footer sortBy="size-desc" filterQuery="" />
    );

    expect(lastFrame()).toContain('Navigate');
    expect(lastFrame()).toContain('Toggle');
    expect(lastFrame()).toContain('Delete');
  });

  it('shows current sort option', () => {
    const { lastFrame } = render(
      <Footer sortBy="name-asc" filterQuery="" />
    );

    expect(lastFrame()).toContain('name A-Z');
  });

  it('shows filter query when active', () => {
    const { lastFrame } = render(
      <Footer sortBy="size-desc" filterQuery="my-project" />
    );

    expect(lastFrame()).toContain('my-project');
  });
});

describe('Help', () => {
  it('renders keyboard shortcuts help', () => {
    const { lastFrame } = render(<Help onClose={() => {}} />);

    expect(lastFrame()).toContain('Keyboard Shortcuts');
    expect(lastFrame()).toContain('Navigation');
    expect(lastFrame()).toContain('Selection');
    expect(lastFrame()).toContain('Actions');
  });

  it('shows all keyboard shortcuts', () => {
    const { lastFrame } = render(<Help onClose={() => {}} />);

    expect(lastFrame()).toContain('↑/↓');
    expect(lastFrame()).toContain('Space');
    expect(lastFrame()).toContain('d');
    expect(lastFrame()).toContain('q');
  });
});

describe('ConfirmDialog', () => {
  it('renders confirmation message', () => {
    const { lastFrame } = render(
      <ConfirmDialog 
        message="Delete 2 node_modules?" 
        onConfirm={() => {}} 
        onCancel={() => {}} 
      />
    );

    expect(lastFrame()).toContain('Confirmation Required');
    expect(lastFrame()).toContain('Delete 2 node_modules?');
    expect(lastFrame()).toContain('y/N');
  });
});

describe('ProgressBar', () => {
  it('renders progress bar', () => {
    const { lastFrame } = render(
      <ProgressBar 
        current={5} 
        total={10} 
        label="project-name" 
        operation="Deleting" 
      />
    );

    expect(lastFrame()).toContain('Deleting');
    expect(lastFrame()).toContain('50%');
    expect(lastFrame()).toContain('project-name');
    expect(lastFrame()).toContain('5/10');
  });

  it('shows 0% at start', () => {
    const { lastFrame } = render(
      <ProgressBar 
        current={0} 
        total={10} 
        label="starting" 
        operation="Scanning" 
      />
    );

    expect(lastFrame()).toContain('0%');
  });

  it('shows 100% at completion', () => {
    const { lastFrame } = render(
      <ProgressBar 
        current={10} 
        total={10} 
        label="done" 
        operation="Complete" 
      />
    );

    expect(lastFrame()).toContain('100%');
  });
});
