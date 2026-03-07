/**
 * Placeholder Image Utility
 * Provides an embedded placeholder image for charts when generation fails or assets are missing
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Cache for the singleton placeholder path
let cachedPlaceholderPath: string | null = null;

/**
 * Generate a placeholder image as a Buffer
 * Returns a PNG buffer for compatibility with docx format
 */
export function getPlaceholderImageBuffer(): Buffer {
  // Return PNG buffer for consistency with docx requirements
  return getPlaceholderPngBuffer();
}

/**
 * Generate a placeholder image and save it to a temporary file
 * Returns the path to the generated placeholder file (reuses existing if available)
 */
export async function createPlaceholderImageFile(): Promise<string> {
  // Return cached placeholder if it exists and is still valid
  if (cachedPlaceholderPath && fs.existsSync(cachedPlaceholderPath)) {
    return cachedPlaceholderPath;
  }

  try {
    // Create temp directory for placeholder
    const tempDir = path.join(os.tmpdir(), 'json-to-docx-temp', 'placeholders');

    // Try to create directory with error handling
    let actualTempDir = tempDir;
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    } catch (error) {
      // Fallback to current working directory if temp dir fails
      console.warn('Failed to create temp directory, using fallback:', error);
      const fallbackDir = path.join(process.cwd(), '.temp', 'placeholders');
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      actualTempDir = fallbackDir;
    }

    // Use a consistent filename for reuse (PNG for better compatibility)
    const placeholderPath = path.join(actualTempDir, 'placeholder.png');

    // Only create if it doesn't exist
    if (!fs.existsSync(placeholderPath)) {
      // Write PNG to file for better compatibility with docx
      fs.writeFileSync(placeholderPath, getPlaceholderPngBuffer());
    }

    // Cache the path for reuse
    cachedPlaceholderPath = placeholderPath;

    return placeholderPath;
  } catch (error) {
    console.error('Failed to create placeholder file:', error);
    // Return a data URL as last resort
    throw new Error('Unable to create placeholder file: ' + error);
  }
}

/**
 * Get a PNG placeholder as base64-encoded data URL
 * This is a minimal 1x1 transparent PNG for fallback scenarios
 */
export function getPlaceholderDataUrl(): string {
  // 1x1 transparent PNG
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
}

/**
 * Get a more detailed PNG placeholder as Buffer
 * This creates a simple gray box with "Chart" text
 */
export function getPlaceholderPngBuffer(): Buffer {
  // This is a simple 600x400 PNG with a gray background and placeholder text
  // Generated from the SVG above and converted to base64
  const base64 = `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`;

  return Buffer.from(base64, 'base64');
}

/**
 * Clean up placeholder files and cached paths
 * Call this when the document generation is complete
 */
export async function cleanupPlaceholders(): Promise<void> {
  // Clear the cached path
  cachedPlaceholderPath = null;

  try {
    // Try to clean up temp directory placeholders
    const tempDir = path.join(os.tmpdir(), 'json-to-docx-temp', 'placeholders');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        if (file.startsWith('placeholder')) {
          fs.unlinkSync(path.join(tempDir, file));
        }
      }
    }

    // Also clean up fallback directory if it exists
    const fallbackDir = path.join(process.cwd(), '.temp', 'placeholders');
    if (fs.existsSync(fallbackDir)) {
      const files = fs.readdirSync(fallbackDir);
      for (const file of files) {
        if (file.startsWith('placeholder')) {
          fs.unlinkSync(path.join(fallbackDir, file));
        }
      }
    }
  } catch (error) {
    // Silently ignore cleanup errors
    console.debug('Placeholder cleanup warning:', error);
  }
}
