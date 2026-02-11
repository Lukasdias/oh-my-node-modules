/**
 * CLI entry point for oh-my-node-modules
 * 
 * This module handles:
 * - Command-line argument parsing
 * - Mode selection (TUI vs CLI mode)
 * - Exit code handling
 * - Quick scan mode (non-interactive)
 * - Auto-delete mode (non-interactive)
 * 
 * It's the bridge between the user and the application logic.
 */

import { render } from 'ink';
import React from 'react';
import { App } from './app.js';
import { scanForNodeModules, loadIgnorePatterns } from './scanner.js';
import { deleteSelectedNodeModules, generateDeletionPreview, selectBySize } from './deletion.js';
import { calculateStatistics, sortNodeModules, parseSize } from './utils.js';
import type { CliArgs, DeleteOptions } from './types.js';

/**
 * Parse command-line arguments into structured config.
 * 
 * Supports:
 * - Positional path argument
 * - --scan (quick scan mode)
 * - --auto (auto-delete mode)
 * - --dry-run (simulate deletions)
 * - --min-size (size threshold)
 * - --yes (skip confirmations)
 * - --json (JSON output)
 * - --help (show help)
 * - --version (show version)
 * 
 * @param args - Raw command-line arguments
 * @returns Parsed configuration
 */
function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    path: process.cwd(),
    scan: false,
    auto: false,
    dryRun: false,
    yes: false,
    json: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--scan':
        result.scan = true;
        break;
      case '--auto':
        result.auto = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--yes':
      case '-y':
        result.yes = true;
        break;
      case '--json':
        result.json = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--version':
      case '-v':
        result.version = true;
        break;
      case '--min-size':
        result.minSize = args[++i];
        break;
      default:
        // If it doesn't start with -, treat as path
        if (!arg.startsWith('-')) {
          result.path = arg;
        }
        break;
    }
  }

  return result;
}

/**
 * Show help message and exit.
 */
function showHelp(): void {
  console.log(`
oh-my-node-modules - Visualize and clean up node_modules directories

Usage:
  onm [path] [options]

Arguments:
  path                    Directory to scan (default: current directory)

Options:
  --scan                  Quick scan mode (no TUI, just report)
  --auto                  Auto-delete mode (no TUI, delete matching criteria)
  --dry-run               Simulate deletions without actually deleting
  --min-size <size>       Minimum size threshold (e.g., 1gb, 500mb)
  --yes, -y               Skip confirmations
  --json                  Output as JSON
  --help, -h              Show this help message
  --version, -v           Show version

Interactive Mode (default):
  onm                     Start interactive TUI
  onm /path/to/projects   Scan specific directory

Quick Scan Mode:
  onm --scan              Quick scan and summary
  onm --scan --json       Output JSON report

Auto-Delete Mode:
  onm --auto --min-size 1gb --yes    Delete all >1GB without prompting
  onm --auto --dry-run               Preview what would be deleted

Keyboard Shortcuts (Interactive Mode):
  ↑/↓ or j/k         Navigate
  Space or Enter     Toggle selection
  a                  Select all
  n                  Deselect all
  i                  Invert selection
  >                  Select larger than current
  d                  Delete selected
  s                  Change sort order
  f                  Filter/search
  q                  Quit
  ?                  Show help

Examples:
  # Start interactive TUI in current directory
  onm

  # Scan specific directory
  onm ~/projects

  # Quick scan and report
  onm --scan

  # Preview deletion of large node_modules
  onm --auto --min-size 500mb --dry-run

  # Delete all node_modules >1GB without confirmation
  onm --auto --min-size 1gb --yes
`);
}

/**
 * Show version and exit.
 */
function showVersion(): void {
  console.log('oh-my-node-modules v1.0.0');
}

/**
 * Quick scan mode - scan and report without TUI.
 */
async function runQuickScan(args: CliArgs): Promise<void> {
  console.log('Scanning for node_modules...\n');

  try {
    const excludePatterns = await loadIgnorePatterns();
    const result = await scanForNodeModules({
      rootPath: args.path,
      excludePatterns,
      followSymlinks: false,
    });

    const sorted = sortNodeModules(result.nodeModules, 'size-desc');
    const stats = calculateStatistics(sorted);

    if (args.json) {
      console.log(JSON.stringify({
        summary: stats,
        nodeModules: sorted.map(nm => ({
          path: nm.path,
          projectName: nm.projectName,
          projectVersion: nm.projectVersion,
          sizeBytes: nm.sizeBytes,
          sizeFormatted: nm.sizeFormatted,
          packageCount: nm.packageCount,
          lastModified: nm.lastModified,
          lastModifiedFormatted: nm.lastModifiedFormatted,
        })),
      }, null, 2));
    } else {
      console.log(`Found ${stats.totalProjects} projects with node_modules`);
      console.log(`Total size: ${stats.totalSizeFormatted}\n`);

      if (sorted.length > 0) {
        console.log('Projects (sorted by size):');
        console.log('─'.repeat(80));
        
        for (const nm of sorted) {
          const warning = nm.sizeCategory === 'huge' ? ' ⚠️' : '';
          console.log(
            `${nm.sizeFormatted.padStart(10)}  ${nm.projectName}${warning}  [${nm.lastModifiedFormatted}]`
          );
        }
      }

      if (result.errors.length > 0) {
        console.log(`\n⚠️  ${result.errors.length} errors during scan`);
      }
    }
  } catch (error) {
    console.error('Scan failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Auto-delete mode - delete without TUI.
 */
async function runAutoDelete(args: CliArgs): Promise<void> {
  console.log('Scanning for node_modules...\n');

  try {
    const excludePatterns = await loadIgnorePatterns();
    const result = await scanForNodeModules({
      rootPath: args.path,
      excludePatterns,
      followSymlinks: false,
    });

    let items = result.nodeModules;

    // Apply size filter if specified
    if (args.minSize) {
      const minBytes = parseSize(args.minSize);
      if (minBytes) {
        items = selectBySize(items, minBytes);
      }
    }

    const selected = items.filter(nm => nm.selected);
    
    if (selected.length === 0) {
      console.log('No node_modules match the criteria.');
      return;
    }

    // Show preview
    const preview = generateDeletionPreview(items);
    console.log(preview);

    // Confirm unless --yes
    if (!args.yes) {
      // In real implementation, would use clack prompts here
      console.log('Use --yes to proceed without confirmation.');
      return;
    }

    // Delete
    const options: DeleteOptions = {
      dryRun: args.dryRun,
      yes: true,
      checkRunningProcesses: true,
      showProgress: true,
    };

    console.log(args.dryRun ? '\n[DRY RUN] No files will be deleted\n' : '\n');

    const deleteResult = await deleteSelectedNodeModules(items, options);

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Deleted: ${deleteResult.successful}/${deleteResult.totalAttempted}`);
    console.log(`Space ${args.dryRun ? 'that would be' : ''} freed: ${deleteResult.formattedBytesFreed}`);

    if (deleteResult.failed > 0) {
      console.log(`Failed: ${deleteResult.failed}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Operation failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Main entry point.
 * Parses arguments and routes to appropriate mode.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  if (args.auto) {
    await runAutoDelete(args);
    process.exit(0);
  }

  if (args.scan) {
    await runQuickScan(args);
    process.exit(0);
  }

  // Interactive TUI mode (default)
  const { waitUntilExit } = render(<App rootPath={args.path} />);
  await waitUntilExit();
}

// Run main and handle errors
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
