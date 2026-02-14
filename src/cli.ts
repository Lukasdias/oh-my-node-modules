#!/usr/bin/env node
import { Command } from 'commander';
import { intro, outro, spinner, multiselect, confirm, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { scanForNodeModules, loadIgnorePatterns, calculatePendingSizes } from './scanner.js';
import { deleteSelectedNodeModules, selectBySize } from './deletion.js';
import { sortNodeModules, calculateStatistics, formatBytes } from './utils.js';
import type { NodeModulesInfo } from './types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '1.0.0';
  }
}

function formatItem(item: NodeModulesInfo): string {
  const isPending = (item as NodeModulesInfo & { isPending?: boolean }).isPending;
  const size = isPending 
    ? pc.yellow('  (...)  ')
    : pc.cyan(item.sizeFormatted.padStart(8));
  const age = pc.gray(item.lastModifiedFormatted);
  const warning = !isPending && item.sizeCategory === 'huge' ? pc.red(' ⚠') : '';
  return `${size}  ${item.projectName}${warning}  [${age}]`;
}

async function interactiveMode(rootPath: string) {
  intro(pc.cyan('oh-my-node-modules'));
  
  const s = spinner();
  s.start('Scanning for node_modules...');
  
  try {
    const excludePatterns = await loadIgnorePatterns();
    
    // Use lazy mode for immediate feedback - show node_modules list ASAP
    const result = await scanForNodeModules({
      rootPath,
      excludePatterns,
      followSymlinks: false,
    }, (_progress, found) => {
      if (found > 0) {
        s.message(`Scanning... found ${found} node_modules`);
      }
    }, true); // true = lazy mode
    
    s.stop(`Found ${result.nodeModules.length} node_modules directories`);
    
    if (result.nodeModules.length === 0) {
      outro(pc.yellow('No node_modules found.'));
      return;
    }
    
    let items = sortNodeModules(result.nodeModules, 'size-desc');
    
    // Show initial list while calculating sizes in background
    console.log(`\n${pc.gray('Calculating sizes...')}`);
    console.log(`${pc.gray('Projects sorted by size:')}\n`);
    
    // Calculate sizes in background with progress
    const sizeSpinner = spinner();
    sizeSpinner.start('Calculating directory sizes...');
    
    items = await calculatePendingSizes(items, (completed, total) => {
      sizeSpinner.message(`Calculating sizes... ${completed}/${total}`);
    });
    
    sizeSpinner.stop(`Calculated sizes for ${items.length} directories`);
    
    // Re-sort after sizes are calculated
    items = sortNodeModules(items, 'size-desc');
    
    const stats = calculateStatistics(items);
    console.log(`\n${pc.gray('Total:')} ${pc.white(stats.totalSizeFormatted)} across ${pc.white(String(stats.totalProjects))} projects`);
    console.log(`${pc.gray('Stale:')} ${pc.yellow(String(stats.staleCount))} directories > 90 days old\n`);
    
    while (true) {
      const options = items.map((item, index) => ({
        value: index,
        label: formatItem(item),
      }));
      
      const selected = await multiselect({
        message: 'Select directories to delete (space to toggle, enter to confirm):',
        options,
        required: false,
      });
      
      if (isCancel(selected)) {
        cancel('Cancelled');
        process.exit(0);
      }
      
      const selectedIndices = selected as number[];
      
      if (selectedIndices.length === 0) {
        const confirmExit = await confirm({
          message: 'No directories selected. Exit?',
        });
        if (confirmExit) {
          outro('Goodbye!');
          return;
        }
        continue;
      }
      
      const bytesToDelete = selectedIndices.reduce((sum: number, idx: number) => sum + items[idx].sizeBytes, 0);
      
      const confirmDelete = await confirm({
        message: `Delete ${selectedIndices.length} directories (${formatBytes(bytesToDelete)})?`,
      });
      
      if (confirmDelete) {
        items = items.map((item, idx) => ({
          ...item,
          selected: selectedIndices.includes(idx),
        }));
        
        const ds = spinner();
        ds.start('Deleting...');
        
        const result = await deleteSelectedNodeModules(items, {
          dryRun: false,
          yes: true,
          checkRunningProcesses: false,
          showProgress: false,
        });
        
        ds.stop(`Deleted ${result.successful}/${result.totalAttempted} directories`);
        outro(pc.green(`Freed ${result.formattedBytesFreed}`));
        return;
      }
    }
  } catch (error) {
    s.stop('Scan failed');
    console.error(pc.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

async function quickScanMode(rootPath: string, json: boolean) {
  const s = spinner();
  s.start('Scanning...');
  
  try {
    const excludePatterns = await loadIgnorePatterns();
    const result = await scanForNodeModules({
      rootPath,
      excludePatterns,
      followSymlinks: false,
    });
    
    s.stop(`Found ${result.nodeModules.length} directories`);
    
    const items = sortNodeModules(result.nodeModules, 'size-desc');
    
    if (json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      if (items.length === 0) {
        console.log(pc.yellow('No node_modules found.'));
        return;
      }
      
      console.log(`\n${pc.cyan('Projects sorted by size:')}\n`);
      
      for (const item of items.slice(0, 20)) {
        console.log(formatItem(item));
      }
      
      if (items.length > 20) {
        console.log(pc.gray(`\n... and ${items.length - 20} more`));
      }
      
      const stats = calculateStatistics(items);
      console.log(`\n${pc.gray('Total size:')} ${pc.cyan(stats.totalSizeFormatted)}`);
    }
  } catch (error) {
    s.stop('Scan failed');
    console.error(pc.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

async function autoDeleteMode(rootPath: string, minSize?: string, dryRun: boolean = false) {
  const s = spinner();
  s.start('Scanning...');
  
  try {
    const excludePatterns = await loadIgnorePatterns();
    const result = await scanForNodeModules({
      rootPath,
      excludePatterns,
      followSymlinks: false,
    });
    
    s.stop(`Found ${result.nodeModules.length} directories`);
    
    let items = result.nodeModules;
    
    if (minSize) {
      const bytes = parseInt(minSize);
      if (!isNaN(bytes)) {
        items = selectBySize(items, bytes);
      }
    }
    
    const selected = items.filter((i: NodeModulesInfo) => i.selected);
    
    if (selected.length === 0) {
      console.log(pc.yellow('No directories match the criteria.'));
      return;
    }
    
    const bytesToDelete = selected.reduce((sum: number, item: NodeModulesInfo) => sum + item.sizeBytes, 0);
    
    console.log(`\n${dryRun ? pc.yellow('[DRY RUN]') : pc.red('Will delete:')}`);
    console.log(`${selected.length} directories (${formatBytes(bytesToDelete)})\n`);
    
    for (const item of selected.slice(0, 10)) {
      console.log(`  ${pc.gray(item.projectPath)}`);
    }
    
    if (selected.length > 10) {
      console.log(pc.gray(`  ... and ${selected.length - 10} more`));
    }
    
    if (dryRun) {
      console.log(pc.yellow('\nDry run - no files deleted.'));
      return;
    }
    
    const confirmDelete = await confirm({
      message: `Delete these ${selected.length} directories?`,
    });
    
    if (confirmDelete) {
      const ds = spinner();
      ds.start('Deleting...');
      
      const result = await deleteSelectedNodeModules(items, {
        dryRun: false,
        yes: true,
        checkRunningProcesses: false,
        showProgress: false,
      });
      
      ds.stop(`Deleted ${result.successful}/${result.totalAttempted}`);
      console.log(pc.green(`Freed ${result.formattedBytesFreed}`));
    }
  } catch (error) {
    s.stop('Operation failed');
    console.error(pc.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

const program = new Command();

program
  .name('onm')
  .description('Find and clean up node_modules directories')
  .version(getVersion())
  .argument('<path>', 'Directory to scan')
  .option('--scan', 'quick scan mode (no interactive UI)')
  .option('--auto', 'auto-delete mode with filters')
  .option('--min-size <size>', 'minimum size in bytes for auto mode')
  .option('--dry-run', 'simulate deletion without actually deleting')
  .option('--json', 'output as JSON')
  .action(async (path: string, options) => {
    if (options.scan) {
      await quickScanMode(path, options.json);
    } else if (options.auto) {
      await autoDeleteMode(path, options.minSize, options.dryRun);
    } else {
      await interactiveMode(path);
    }
  });

program.parse();
