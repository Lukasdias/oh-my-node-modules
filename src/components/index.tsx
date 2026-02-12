/**
 * Ink components for the TUI interface
 * 
 * This module provides React components for rendering the terminal UI.
 * Components follow the reactive pattern: props change -> re-render.
 * 
 * Component hierarchy:
 * App
 * ├── Header (title + total stats)
 * ├── List (scrollable node_modules list)
 * │   └── ListItem (individual node_modules)
 * ├── Footer (keyboard shortcuts)
 * └── Help (help overlay, conditionally rendered)
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { NodeModulesInfo, SortOption, ScanStatistics } from '../types.js';
import { getSizeColor } from '../utils.js';

// ============================================
// Header Component
// ============================================

interface HeaderProps {
  statistics: ScanStatistics;
  isScanning: boolean;
  scanProgress: number;
}

/** 
 * Header displays the app title and overall statistics.
 * Shows scanning progress when active.
 */
export const Header: React.FC<HeaderProps> = ({ statistics, isScanning, scanProgress }) => {
  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">oh-my-node-modules</Text>
        {isScanning && (
          <Text color="yellow">
            Scanning... {scanProgress}%
          </Text>
        )}
      </Box>
      
      <Box justifyContent="space-between" marginTop={1}>
        <Text>
          <Text color="white">Projects: </Text>
          <Text bold color="green">{statistics.totalProjects}</Text>
        </Text>
        <Text>
          <Text color="white">Total Size: </Text>
          <Text bold color="yellow">{statistics.totalSizeFormatted}</Text>
        </Text>
        <Text>
          <Text color="white">Selected: </Text>
          <Text bold color="cyan">{statistics.selectedCount}</Text>
          <Text> ({statistics.selectedSizeFormatted})</Text>
        </Text>
      </Box>
    </Box>
  );
};

// ============================================
// List Item Component
// ============================================

interface ListItemProps {
  item: NodeModulesInfo;
  isFocused: boolean;
}

/**
 * ListItem displays a single node_modules entry.
 * Shows selection state, focus state, and visual indicators.
 */
export const ListItem: React.FC<ListItemProps> = ({ item, isFocused }) => {
  // Determine colors based on categories
  const sizeColor = getSizeColor(item.sizeCategory);
  const ageColor = item.ageCategory === 'stale' ? 'gray' : 'white';
  const selectionIndicator = item.selected ? '[✓]' : '[ ]';
  const focusIndicator = isFocused ? '>' : ' ';
  
  // Warning indicator for large or old items
  const warningIndicator = (item.sizeCategory === 'huge' || item.ageCategory === 'stale') 
    ? '⚠️ ' 
    : '  ';

  return (
    <Box>
      <Text>
        <Text color={isFocused ? 'cyan' : 'white'}>{focusIndicator}</Text>
        <Text color={item.selected ? 'green' : 'white'}>{selectionIndicator}</Text>
        <Text> </Text>
        <Text>{warningIndicator}</Text>
        <Text>📁 </Text>
        <Text bold>{item.projectName}</Text>
        {item.projectVersion && (
          <Text color="gray"> (v{item.projectVersion})</Text>
        )}
        <Text>  </Text>
        <Text color={sizeColor} bold>{item.sizeFormatted}</Text>
        <Text>  </Text>
        <Text color={ageColor}>[{item.lastModifiedFormatted}]</Text>
      </Text>
    </Box>
  );
};

// ============================================
// List Component
// ============================================

interface ListProps {
  items: NodeModulesInfo[];
  selectedIndex: number;
  visibleCount: number;
}

/**
 * List displays a scrollable list of node_modules.
 * Handles virtual scrolling for performance with large lists.
 */
export const List: React.FC<ListProps> = ({ items, selectedIndex, visibleCount }) => {
  // Calculate visible range for virtual scrolling
  const halfVisible = Math.floor(visibleCount / 2);
  let startIndex = Math.max(0, selectedIndex - halfVisible);
  let endIndex = Math.min(items.length, startIndex + visibleCount);
  
  // Adjust start if we're near the end
  if (endIndex - startIndex < visibleCount) {
    startIndex = Math.max(0, endIndex - visibleCount);
  }

  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {items.length === 0 ? (
        <Box padding={2}>
          <Text color="gray">No node_modules found. Press 'q' to quit.</Text>
        </Box>
      ) : (
        <>
          {startIndex > 0 && (
            <Text color="gray">↑ {startIndex} more...</Text>
          )}
          
          {visibleItems.map((item, index) => {
            const actualIndex = startIndex + index;
            return (
              <ListItem
                key={item.path}
                item={item}
                isFocused={actualIndex === selectedIndex}
              />
            );
          })}
          
          {endIndex < items.length && (
            <Text color="gray">↓ {items.length - endIndex} more...</Text>
          )}
        </>
      )}
    </Box>
  );
};

// ============================================
// Footer Component
// ============================================

interface FooterProps {
  sortBy: SortOption;
  filterQuery: string;
}

/**
 * Footer displays keyboard shortcuts and current state.
 */
export const Footer: React.FC<FooterProps> = ({ sortBy, filterQuery }) => {
  const sortLabel = getSortLabel(sortBy);
  
  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Box justifyContent="space-between">
        <Text color="gray">
          [↑/↓] Navigate  [Space] Toggle  [d] Delete  [a] Select all  [s] Sort ({sortLabel})  [f] Filter
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color="gray">
          [i] Invert  [&gt;] Select larger  [q] Quit  [?] Help
        </Text>
        {filterQuery && (
          <Text color="cyan">Filter: {filterQuery}</Text>
        )}
      </Box>
    </Box>
  );
};

// ============================================
// Help Overlay Component
// ============================================

interface HelpProps {
  onClose: () => void;
}

/**
 * Help displays keyboard shortcuts and usage instructions.
 */
export const Help: React.FC<HelpProps> = ({ onClose }) => {
  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onClose();
    }
  });

  return (
    <Box 
      flexDirection="column" 
      borderStyle="double" 
      padding={2}
      width="80%"
    >
      <Text bold color="cyan">oh-my-node-modules - Keyboard Shortcuts</Text>
      <Box marginY={1}>
        <Text color="gray">Navigation</Text>
      </Box>
      <Text>  ↑/↓ or j/k     Navigate up/down</Text>
      <Text>  Space          Toggle selection</Text>
      <Text>  Enter          Toggle selection</Text>
      
      <Box marginY={1}>
        <Text color="gray">Selection</Text>
      </Box>
      <Text>  a              Select all visible</Text>
      <Text>  n              Deselect all</Text>
      <Text>  i              Invert selection</Text>
      <Text>  {'>'}              Select larger than previous</Text>
      
      <Box marginY={1}>
        <Text color="gray">Actions</Text>
      </Box>
      <Text>  d              Delete selected</Text>
      <Text>  s              Change sort order</Text>
      <Text>  f              Filter/search</Text>
      
      <Box marginY={1}>
        <Text color="gray">Other</Text>
      </Box>
      <Text>  q              Quit</Text>
      <Text>  ?              Toggle this help</Text>
      <Text>  Esc            Close help/exit filter</Text>

      <Box marginTop={2}>
        <Text color="gray">Press any key to close...</Text>
      </Box>
    </Box>
  );
};

// ============================================
// Confirmation Dialog Component
// ============================================

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmDialog asks for user confirmation before destructive actions.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ 
  message, 
  onConfirm, 
  onCancel 
}) => {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box 
      flexDirection="column" 
      borderStyle="double" 
      borderColor="yellow"
      padding={2}
      width="80%"
    >
      <Text color="yellow" bold>⚠️  Confirmation Required</Text>
      <Box marginY={1}>
        <Text>{message}</Text>
      </Box>
      <Text color="gray">Proceed? (y/N): </Text>
    </Box>
  );
};

// ============================================
// Progress Bar Component
// ============================================

interface ProgressBarProps {
  current: number;
  total: number;
  label: string;
  operation: string;
}

/**
 * ProgressBar shows progress during long operations.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  current, 
  total, 
  label,
  operation 
}) => {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const barWidth = 40;
  const filledWidth = Math.round((percentage / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  
  const filledBar = '█'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);

  return (
    <Box 
      flexDirection="column" 
      borderStyle="single" 
      padding={1}
      width="80%"
    >
      <Text bold>{operation}...</Text>
      <Box marginY={1}>
        <Text color="cyan">{filledBar}</Text>
        <Text color="gray">{emptyBar}</Text>
        <Text> {percentage}%</Text>
      </Box>
      <Text color="gray">{current}/{total}: {label}</Text>
    </Box>
  );
};

// ============================================
// Helper Functions
// ============================================

function getSortLabel(sortBy: SortOption): string {
  const labels: Record<SortOption, string> = {
    'size-desc': 'size ↓',
    'size-asc': 'size ↑',
    'date-desc': 'date ↓',
    'date-asc': 'date ↑',
    'name-asc': 'name A-Z',
    'name-desc': 'name Z-A',
    'packages-desc': 'pkgs ↓',
    'packages-asc': 'pkgs ↑',
  };
  return labels[sortBy] || sortBy;
}
