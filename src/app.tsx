/**
 * Main App component for oh-my-node-modules TUI
 * 
 * This is the root component that manages:
 * - Application state (using React hooks)
 * - Keyboard input handling
 * - Data flow between scanner and UI
 * - Lifecycle management (scan on mount, cleanup on exit)
 * 
 * The app follows the reactive pattern: state changes trigger re-renders.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { 
  Header, 
  List, 
  Footer, 
  Help, 
  ConfirmDialog,
  ProgressBar 
} from './components/index.js';
import type { AppState, SortOption, DeleteOptions } from './types.js';
import { createInitialState } from './types.js';
import {
  calculateStatistics,
  sortNodeModules,
  filterNodeModules,
  toggleSelection,
} from './utils.js';
import { scanForNodeModules, loadIgnorePatterns, loadFavorites } from './scanner.js';
import {
  deleteSelectedNodeModules,
  generateDeletionPreview,
  selectBySize,
  selectAll,
  invertSelection,
} from './deletion.js';

// ============================================
// Main App Component
// ============================================

interface AppProps {
  /** Root path to scan */
  rootPath: string;
  /** Initial sort option */
  initialSort?: SortOption;
}

/**
 * Main application component.
 *
 * Manages all application state and coordinates between:
 * - Scanner (discovery)
 * - UI components (rendering)
 * - Deletion operations
 * - User input
 */
export const App: React.FC<AppProps> = ({
  rootPath,
  initialSort = 'size-desc'
}) => {
  // Get terminal dimensions for responsive layout
  const { stdout } = useStdout();
  const { exit } = useApp();
  
  // Application state
  const [state, setState] = useState<AppState>(() => ({
    ...createInitialState(),
    sortBy: initialSort,
  }));
  
  // UI state (not part of core app state)
  const [showHelp, setShowHelp] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progressState, setProgressState] = useState({ current: 0, total: 0, label: '' });
  const [filterInput, setFilterInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  // Derived state: sorted and filtered items
  const sortedItems = useMemo(() => {
    const sorted = sortNodeModules(state.nodeModules, state.sortBy);
    return sorted;
  }, [state.nodeModules, state.sortBy]);

  const filteredItems = useMemo(() => {
    return filterNodeModules(sortedItems, state.filterQuery);
  }, [sortedItems, state.filterQuery]);

  // Calculate statistics from current items
  const statistics = useMemo(() => {
    return calculateStatistics(filteredItems);
  }, [filteredItems]);

  // Calculate visible list size based on terminal height
  const visibleListCount = useMemo(() => {
    // Reserve space for header, footer, and padding
    const reservedLines = 12;
    return Math.max(5, stdout.rows - reservedLines);
  }, [stdout.rows]);

  // ============================================
  // Effects
  // ============================================

  // Scan on mount
  useEffect(() => {
    const performScan = async () => {
      setState(prev => ({ ...prev, isScanning: true }));
      
      try {
        const excludePatterns = await loadIgnorePatterns();
        const favorites = await loadFavorites();
        
        const result = await scanForNodeModules(
          {
            rootPath,
            excludePatterns,
            followSymlinks: false,
          },
          (progress) => {
            setState(prev => ({ ...prev, scanProgress: progress }));
          }
        );

        // Mark favorites
        const itemsWithFavorites = result.nodeModules.map(item => ({
          ...item,
          isFavorite: favorites.has(item.projectPath),
        }));

        setState(prev => ({
          ...prev,
          nodeModules: itemsWithFavorites,
          isScanning: false,
          scanProgress: 100,
        }));

        if (result.errors.length > 0) {
          setErrorMessage(`Scan completed with ${result.errors.length} errors`);
        }
      } catch (error) {
        setState(prev => ({ ...prev, isScanning: false }));
        setErrorMessage(error instanceof Error ? error.message : 'Scan failed');
      }
    };

    performScan();
  }, [rootPath]);

  // ============================================
  // Keyboard Handlers
  // ============================================

  useInput((input, key) => {
    // Don't handle input during certain states
    if (state.isDeleting || showConfirm || showProgress) return;

    // Help overlay takes precedence
    if (showHelp) {
      if (input === 'q' || key.escape) {
        setShowHelp(false);
      }
      return;
    }

    // Filter mode
    if (showFilter) {
      if (key.escape) {
        setShowFilter(false);
        setFilterInput('');
        setState(prev => ({ ...prev, filterQuery: '' }));
      } else if (key.return) {
        setShowFilter(false);
        setState(prev => ({ ...prev, filterQuery: filterInput }));
      } else if (key.backspace || key.delete) {
        setFilterInput(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setFilterInput(prev => prev + input);
      }
      return;
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setState(prev => ({
        ...prev,
        selectedIndex: Math.max(0, prev.selectedIndex - 1),
      }));
    } else if (key.downArrow || input === 'j') {
      setState(prev => ({
        ...prev,
        selectedIndex: Math.min(filteredItems.length - 1, prev.selectedIndex + 1),
      }));
    }
    // Selection
    else if (input === ' ' || key.return) {
      setState(prev => {
        const newItems = toggleSelection(filteredItems, prev.selectedIndex);
        return {
          ...prev,
          nodeModules: prev.nodeModules.map(item => {
            const updated = newItems.find(n => n.path === item.path);
            return updated || item;
          }),
        };
      });
    }
    // Select all
    else if (input === 'a') {
      setState(prev => {
        const allSelected = filteredItems.every(item => item.selected);
        const newItems = selectAll(filteredItems, !allSelected);
        return {
          ...prev,
          nodeModules: prev.nodeModules.map(item => {
            const updated = newItems.find(n => n.path === item.path);
            return updated || item;
          }),
        };
      });
    }
    // Deselect all
    else if (input === 'n') {
      setState(prev => {
        const newItems = selectAll(filteredItems, false);
        return {
          ...prev,
          nodeModules: prev.nodeModules.map(item => {
            const updated = newItems.find(n => n.path === item.path);
            return updated || item;
          }),
        };
      });
    }
    // Invert selection
    else if (input === 'i') {
      setState(prev => {
        const newItems = invertSelection(filteredItems);
        return {
          ...prev,
          nodeModules: prev.nodeModules.map(item => {
            const updated = newItems.find(n => n.path === item.path);
            return updated || item;
          }),
        };
      });
    }
    // Select larger than current
    else if (input === '>') {
      const currentItem = filteredItems[state.selectedIndex];
      if (currentItem) {
        setState(prev => {
          const newItems = selectBySize(filteredItems, currentItem.sizeBytes);
          return {
            ...prev,
            nodeModules: prev.nodeModules.map(item => {
              const updated = newItems.find(n => n.path === item.path);
              return updated || item;
            }),
          };
        });
      }
    }
    // Delete
    else if (input === 'd') {
      const selected = filteredItems.filter(item => item.selected);
      if (selected.length > 0) {
        setShowConfirm(true);
      }
    }
    // Sort
    else if (input === 's') {
      setState(prev => {
        const sorts: SortOption[] = [
          'size-desc', 'size-asc', 
          'date-desc', 'date-asc',
          'name-asc', 'name-desc',
          'packages-desc', 'packages-asc'
        ];
        const currentIndex = sorts.indexOf(prev.sortBy);
        const nextIndex = (currentIndex + 1) % sorts.length;
        return { ...prev, sortBy: sorts[nextIndex] };
      });
    }
    // Filter
    else if (input === 'f') {
      setShowFilter(true);
      setFilterInput(state.filterQuery);
    }
    // Help
    else if (input === '?') {
      setShowHelp(true);
    }
    // Quit
    else if (input === 'q') {
      exit();
    }
  });

  // ============================================
  // Action Handlers
  // ============================================

  const handleConfirmDelete = useCallback(async () => {
    setShowConfirm(false);
    setShowProgress(true);
    setState(prev => ({ ...prev, isDeleting: true }));

    const options: DeleteOptions = {
      dryRun: false,
      yes: true,
      checkRunningProcesses: true,
      showProgress: true,
    };

    try {
      const result = await deleteSelectedNodeModules(
        state.nodeModules,
        options,
        (current, total, label) => {
          setProgressState({ current, total, label });
        }
      );

      // Update state to reflect deletions
      setState(prev => ({
        ...prev,
        nodeModules: prev.nodeModules.filter(nm => 
          !result.details.find(d => d.nodeModules.path === nm.path && d.success)
        ),
        isDeleting: false,
        sessionBytesReclaimed: prev.sessionBytesReclaimed + result.bytesFreed,
      }));

      setShowProgress(false);
    } catch (error) {
      setState(prev => ({ ...prev, isDeleting: false }));
      setShowProgress(false);
      setErrorMessage(error instanceof Error ? error.message : 'Deletion failed');
    }
  }, [state.nodeModules, exit]);

  const handleCancelDelete = useCallback(() => {
    setShowConfirm(false);
  }, []);

  // ============================================
  // Render
  // ============================================

  // If showing help overlay
  if (showHelp) {
    return (
      <Box flexDirection="column" height={stdout.rows}>
        <Header 
          statistics={statistics} 
          isScanning={state.isScanning} 
          scanProgress={state.scanProgress} 
        />
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Help onClose={() => setShowHelp(false)} />
        </Box>
      </Box>
    );
  }

  // If showing confirmation dialog
  if (showConfirm) {
    const preview = generateDeletionPreview(filteredItems);
    return (
      <Box flexDirection="column" height={stdout.rows}>
        <Header 
          statistics={statistics} 
          isScanning={state.isScanning} 
          scanProgress={state.scanProgress} 
        />
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <ConfirmDialog
            message={preview}
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
          />
        </Box>
      </Box>
    );
  }

  // If showing progress
  if (showProgress) {
    return (
      <Box flexDirection="column" height={stdout.rows}>
        <Header 
          statistics={statistics} 
          isScanning={state.isScanning} 
          scanProgress={state.scanProgress} 
        />
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <ProgressBar
            current={progressState.current}
            total={progressState.total}
            label={progressState.label}
            operation="Deleting"
          />
        </Box>
      </Box>
    );
  }

  // If showing filter input
  if (showFilter) {
    return (
      <Box flexDirection="column" height={stdout.rows}>
        <Header 
          statistics={statistics} 
          isScanning={state.isScanning} 
          scanProgress={state.scanProgress} 
        />
        <Box 
          flexGrow={1} 
          alignItems="center" 
          justifyContent="center"
          borderStyle="single"
          padding={2}
        >
          <Text>Filter: </Text>
          <Text color="cyan">{filterInput}</Text>
          <Text color="gray">_</Text>
        </Box>
        <Footer sortBy={state.sortBy} filterQuery={state.filterQuery} />
      </Box>
    );
  }

  // Main TUI view
  return (
    <Box flexDirection="column" height={stdout.rows}>
      <Header 
        statistics={statistics} 
        isScanning={state.isScanning} 
        scanProgress={state.scanProgress} 
      />
      
      {errorMessage && (
        <Box padding={1}>
          <Text color="red">⚠️ {errorMessage}</Text>
        </Box>
      )}

      <Box flexGrow={1} overflow="hidden">
        <List 
          items={filteredItems}
          selectedIndex={state.selectedIndex}
          visibleCount={visibleListCount}
        />
      </Box>

      <Footer sortBy={state.sortBy} filterQuery={state.filterQuery} />
    </Box>
  );
};

export default App;
