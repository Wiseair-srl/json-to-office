import { promises as fs } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { watch, FSWatcher } from 'fs';
import { ComponentDefinition } from '@json-to-office/shared';
import { parseJsonWithLineNumbers } from './parser';

/**
 * File System utilities for JSON report definitions
 */

/**
 * Load JSON report definition from file
 * Supports both relative and absolute file paths
 */
export async function loadJsonDefinition(
  filePath: string
): Promise<ComponentDefinition> {
  try {
    // Resolve path (handles both relative and absolute paths)
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);

    // Check if file exists
    await fs.access(absolutePath);

    // Read file content
    const fileContent = await fs.readFile(absolutePath, 'utf-8');

    // Parse JSON with line number tracking for better errors
    return parseJsonWithLineNumbers(fileContent) as ComponentDefinition;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const fsError = error as Error & { code?: string };

      switch (fsError.code) {
        case 'ENOENT':
          throw new JsonFileError(
            `File not found: ${filePath}`,
            'FILE_NOT_FOUND'
          );
        case 'EACCES':
          throw new JsonFileError(
            `Permission denied: ${filePath}`,
            'PERMISSION_DENIED'
          );
        case 'EISDIR':
          throw new JsonFileError(
            `Path is a directory: ${filePath}`,
            'IS_DIRECTORY'
          );
        default:
          throw new JsonFileError(
            `File system error: ${fsError.message}`,
            'FS_ERROR'
          );
      }
    }

    // Re-throw parsing errors with file context
    if (error instanceof Error) {
      throw new JsonFileError(
        `Error loading ${filePath}: ${error.message}`,
        'PARSE_ERROR',
        error
      );
    }

    throw new JsonFileError(
      `Unknown error loading ${filePath}`,
      'UNKNOWN_ERROR'
    );
  }
}

/**
 * Load JSON definition with validation but without throwing on validation errors
 */
export async function loadJsonDefinitionSafe(filePath: string): Promise<{
  success: boolean;
  definition?: ComponentDefinition;
  error?: JsonFileError;
}> {
  try {
    const definition = await loadJsonDefinition(filePath);
    return { success: true, definition };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof JsonFileError
          ? error
          : new JsonFileError(
              error instanceof Error ? error.message : String(error),
              'UNKNOWN_ERROR'
            ),
    };
  }
}

/**
 * Watch JSON file for changes and call callback on modifications
 * Useful for development workflows
 */
export function watchJsonFile(
  filePath: string,
  callback: (
    _definition: ComponentDefinition | null,
    _error?: JsonFileError
  ) => void
): JsonFileWatcher {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);

  // Initial load
  loadJsonDefinitionSafe(absolutePath).then((result) => {
    if (result.success) {
      callback(result.definition!);
    } else {
      callback(null, result.error);
    }
  });

  // Set up file watcher
  const watcher = watch(absolutePath, { persistent: true }, (eventType) => {
    if (eventType === 'change') {
      // Debounce rapid file changes
      setTimeout(async () => {
        const result = await loadJsonDefinitionSafe(absolutePath);
        if (result.success) {
          callback(result.definition!);
        } else {
          callback(null, result.error);
        }
      }, 100);
    }
  });

  return new JsonFileWatcher(watcher, absolutePath);
}

/**
 * Watch multiple JSON files and call callback when any changes
 */
export function watchJsonFiles(
  filePaths: string[],
  callback: (
    _filePath: string,
    _definition: ComponentDefinition | null,
    _error?: JsonFileError
  ) => void
): JsonFileWatcher[] {
  return filePaths.map((filePath) => {
    return watchJsonFile(filePath, (definition, error) => {
      callback(filePath, definition, error);
    });
  });
}

/**
 * Check if file exists and is accessible
 */
export async function checkJsonFile(filePath: string): Promise<{
  exists: boolean;
  readable: boolean;
  isDirectory: boolean;
  error?: string;
}> {
  try {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
    const stats = await fs.stat(absolutePath);

    return {
      exists: true,
      readable: true,
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const fsError = error as Error & { code?: string };

      switch (fsError.code) {
        case 'ENOENT':
          return {
            exists: false,
            readable: false,
            isDirectory: false,
            error: 'File not found',
          };
        case 'EACCES':
          return {
            exists: true,
            readable: false,
            isDirectory: false,
            error: 'Permission denied',
          };
        default:
          return {
            exists: false,
            readable: false,
            isDirectory: false,
            error: fsError.message,
          };
      }
    }

    return {
      exists: false,
      readable: false,
      isDirectory: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Find JSON files in a directory (non-recursive)
 */
export async function findJsonFiles(directoryPath: string): Promise<string[]> {
  try {
    const absolutePath = isAbsolute(directoryPath)
      ? directoryPath
      : resolve(directoryPath);
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(absolutePath, entry.name));
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const fsError = error as Error & { code?: string };

      switch (fsError.code) {
        case 'ENOENT':
          throw new JsonFileError(
            `Directory not found: ${directoryPath}`,
            'DIRECTORY_NOT_FOUND'
          );
        case 'ENOTDIR':
          throw new JsonFileError(
            `Path is not a directory: ${directoryPath}`,
            'NOT_DIRECTORY'
          );
        case 'EACCES':
          throw new JsonFileError(
            `Permission denied: ${directoryPath}`,
            'PERMISSION_DENIED'
          );
        default:
          throw new JsonFileError(
            `Directory error: ${fsError.message}`,
            'DIRECTORY_ERROR'
          );
      }
    }

    throw new JsonFileError(
      `Unknown error reading directory ${directoryPath}`,
      'UNKNOWN_ERROR'
    );
  }
}

/**
 * Save JSON report definition to file
 */
export async function saveJsonDefinition(
  definition: ComponentDefinition,
  filePath: string,
  options: { pretty?: boolean; backup?: boolean } = {}
): Promise<void> {
  const { pretty = true, backup = false } = options;

  try {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);

    // Create backup if requested
    if (backup) {
      try {
        const backupPath = `${absolutePath}.backup`;
        await fs.copyFile(absolutePath, backupPath);
      } catch (error) {
        // Ignore backup errors if original file doesn't exist
        if (
          error instanceof Error &&
          'code' in error &&
          (error as Error & { code?: string }).code !== 'ENOENT'
        ) {
          console.warn(`Failed to create backup: ${error.message}`);
        }
      }
    }

    // Serialize JSON
    const jsonContent = pretty
      ? JSON.stringify(definition, null, 2)
      : JSON.stringify(definition);

    // Write file
    await fs.writeFile(absolutePath, jsonContent, 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const fsError = error as Error & { code?: string };

      switch (fsError.code) {
        case 'EACCES':
          throw new JsonFileError(
            `Permission denied: ${filePath}`,
            'PERMISSION_DENIED'
          );
        case 'ENOSPC':
          throw new JsonFileError(
            `No space left on device: ${filePath}`,
            'NO_SPACE'
          );
        default:
          throw new JsonFileError(
            `Write error: ${fsError.message}`,
            'WRITE_ERROR'
          );
      }
    }

    throw new JsonFileError(
      `Unknown error saving ${filePath}`,
      'UNKNOWN_ERROR'
    );
  }
}

/**
 * File watcher wrapper class
 */
export class JsonFileWatcher {
  private watcher: FSWatcher;
  private filePath: string;

  constructor(watcher: FSWatcher, filePath: string) {
    this.watcher = watcher;
    this.filePath = filePath;
  }

  /**
   * Stop watching the file
   */
  public close(): void {
    this.watcher.close();
  }

  /**
   * Get the watched file path
   */
  public getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Custom error class for file system operations
 */
export class JsonFileError extends Error {
  public readonly code: string;
  public readonly originalError?: Error;

  constructor(message: string, code: string, originalError?: Error) {
    super(message);
    this.name = 'JsonFileError';
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Utility function to validate JSON file extension
 */
export function hasJsonExtension(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.json');
}

/**
 * Utility to ensure a path has .json extension
 */
export function ensureJsonExtension(filePath: string): string {
  return hasJsonExtension(filePath) ? filePath : `${filePath}.json`;
}
