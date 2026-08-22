import { promises as fs } from 'fs';
import { normalize } from 'path';
import type { ThemeConfigJson } from '@json-to-office/shared-docx';
import { ThemeParser } from './parser';

// File system error class with enhanced error details
export class ThemeFileError extends Error {
  constructor(
    message: string,
    public path?: string,
    public _cause?: Error
  ) {
    const pathInfo = path ? ` (path: ${path})` : '';
    super(`Failed to load theme file: ${message}${pathInfo}`);
    this.name = 'ThemeFileError';
  }
}

// Theme loader class with comprehensive security and error handling
export class ThemeLoader {
  private parser = new ThemeParser();
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
  private readonly ALLOWED_EXTENSIONS = ['.json'];

  async loadFromFile(filePath: string): Promise<ThemeConfigJson> {
    try {
      // Validate file path for security
      this.validateFilePath(filePath);

      // Read file with size limits
      const content = await this.readFileWithLimits(filePath);

      // Parse the theme content
      return this.parser.parse(content);
    } catch (error) {
      if (error instanceof ThemeFileError) {
        throw error;
      }

      // Handle file system errors
      if (error && typeof error === 'object' && 'code' in error) {
        const fsError = error as { code?: string; message: string };
        let message: string;

        switch (fsError.code) {
          case 'ENOENT':
            message = 'File not found';
            break;
          case 'EACCES':
            message = 'Permission denied';
            break;
          case 'EISDIR':
            message = 'Path is a directory, not a file';
            break;
          case 'EMFILE':
          case 'ENFILE':
            message = 'Too many open files';
            break;
          case 'ENOTDIR':
            message = 'Directory in path does not exist';
            break;
          default:
            message = `File system error: ${fsError.message}`;
        }

        throw new ThemeFileError(
          message,
          filePath,
          error instanceof Error ? error : undefined
        );
      }

      // Handle other errors
      throw new ThemeFileError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        filePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  async loadFromUrl(_url: string): Promise<ThemeConfigJson> {
    // Future enhancement for loading themes from URLs
    // Would need additional dependencies (fetch) and security considerations
    throw new ThemeFileError(
      'URL loading not yet implemented - use loadFromFile() instead'
    );
  }

  private validateFilePath(filePath: string): void {
    // Basic input validation
    if (!filePath || typeof filePath !== 'string') {
      throw new ThemeFileError('File path must be a non-empty string');
    }

    // Normalize the path to handle different separators and relative paths
    const normalizedPath = normalize(filePath);

    // Check for directory traversal attempts
    if (normalizedPath.includes('..')) {
      throw new ThemeFileError('Directory traversal is not allowed', filePath);
    }

    // Check for null bytes (path injection)
    if (normalizedPath.includes('\0')) {
      throw new ThemeFileError(
        'Null bytes in file path are not allowed',
        filePath
      );
    }

    // Validate file extension
    const hasValidExtension = this.ALLOWED_EXTENSIONS.some((ext) =>
      normalizedPath.toLowerCase().endsWith(ext)
    );

    if (!hasValidExtension) {
      throw new ThemeFileError(
        `Invalid file extension. Allowed: ${this.ALLOWED_EXTENSIONS.join(', ')}`,
        filePath
      );
    }

    // Additional security: ensure path is reasonable length
    if (normalizedPath.length > 1000) {
      throw new ThemeFileError('File path is too long', filePath);
    }
  }

  private async readFileWithLimits(filePath: string): Promise<string> {
    try {
      // Get file stats to check size before reading
      const stats = await fs.stat(filePath);

      // Check if it's actually a file
      if (!stats.isFile()) {
        throw new ThemeFileError('Path is not a regular file', filePath);
      }

      // Check file size limits
      if (stats.size > this.MAX_FILE_SIZE) {
        throw new ThemeFileError(
          `File too large (${stats.size} bytes, max ${this.MAX_FILE_SIZE} bytes)`,
          filePath
        );
      }

      // Check for empty file
      if (stats.size === 0) {
        throw new ThemeFileError('File is empty', filePath);
      }

      // Read file with proper encoding
      const content = await fs.readFile(filePath, 'utf8');

      // Verify content was read properly
      if (typeof content !== 'string') {
        throw new ThemeFileError('Failed to read file as text', filePath);
      }

      return content;
    } catch (error) {
      if (error instanceof ThemeFileError) {
        throw error;
      }

      // Re-throw as ThemeFileError for consistent error handling
      throw new ThemeFileError(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        filePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Utility method to validate a file path without reading
  validateFile(filePath: string): { valid: boolean; error?: string } {
    try {
      this.validateFilePath(filePath);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error ? error.message : 'Unknown validation error',
      };
    }
  }

  // Utility method to get file info
  async getFileInfo(filePath: string): Promise<{
    exists: boolean;
    size?: number;
    isFile?: boolean;
    error?: string;
  }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        exists: true,
        size: stats.size,
        isFile: stats.isFile(),
      };
    } catch (error) {
      return {
        exists: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
