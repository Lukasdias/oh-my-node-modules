/**
 * Worker thread for parallel directory size calculation
 * 
 * Worker threads allow us to calculate sizes of multiple node_modules
 * directories in parallel without blocking the main thread.
 * This is especially useful for large monorepos with many projects.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

interface WorkerResult {
  path: string;
  totalSize: number;
  packageCount: number;
  totalPackageCount: number;
  error?: string;
}

interface WorkerTask {
  path: string;
}

/**
 * Calculate directory size using iterative approach
 * Runs inside worker thread
 */
async function calculateDirectorySize(dirPath: string): Promise<{
  totalSize: number;
  packageCount: number;
  totalPackageCount: number;
}> {
  let totalSize = 0;
  let packageCount = 0;
  let totalPackageCount = 0;
  let isTopLevel = true;

  const pathsToProcess: string[] = [dirPath];
  const processedPaths = new Set<string>();

  while (pathsToProcess.length > 0) {
    const currentPath = pathsToProcess.pop()!;
    
    if (processedPaths.has(currentPath)) continue;
    processedPaths.add(currentPath);

    try {
      const stats = await fs.stat(currentPath);
      
      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        totalSize += 4096; // Directory entry size
        
        if (isTopLevel && currentPath !== dirPath) {
          const entryName = basename(currentPath);
          if (!entryName.startsWith('.') && entryName !== '.bin') {
            packageCount++;
          }
        }
        
        if (currentPath !== dirPath) {
          const entryName = basename(currentPath);
          if (!entryName.startsWith('.') && entryName !== '.bin') {
            totalPackageCount++;
          }
        }

        try {
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = join(currentPath, entry.name);
            pathsToProcess.push(entryPath);
          }
        } catch {
          // Permission denied - skip
        }
      }
    } catch {
      // File not accessible - skip
    }

    if (currentPath === dirPath) {
      isTopLevel = false;
    }
  }

  return { totalSize, packageCount, totalPackageCount };
}

/**
 * Worker thread execution
 */
if (!isMainThread && parentPort) {
  const task: WorkerTask = workerData as WorkerTask;
  
  calculateDirectorySize(task.path)
    .then(result => {
      const workerResult: WorkerResult = {
        path: task.path,
        totalSize: result.totalSize,
        packageCount: result.packageCount,
        totalPackageCount: result.totalPackageCount,
      };
      parentPort!.postMessage(workerResult);
    })
    .catch(error => {
      const workerResult: WorkerResult = {
        path: task.path,
        totalSize: 0,
        packageCount: 0,
        totalPackageCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      parentPort!.postMessage(workerResult);
    });
}

/**
 * Calculate size using worker thread
 */
export function calculateSizeWithWorker(dirPath: string): Promise<{
  totalSize: number;
  packageCount: number;
  totalPackageCount: number;
}> {
  return new Promise((resolve, reject) => {
    // Get the current file path
    const __filename = fileURLToPath(import.meta.url);
    
    const worker = new Worker(__filename, {
      workerData: { path: dirPath },
    });

    worker.on('message', (result: WorkerResult) => {
      if (result.error) {
        reject(new Error(result.error));
      } else {
        resolve({
          totalSize: result.totalSize,
          packageCount: result.packageCount,
          totalPackageCount: result.totalPackageCount,
        });
      }
      worker.terminate();
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

export { isMainThread };
