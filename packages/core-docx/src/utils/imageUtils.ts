import { readFileSync } from 'fs';
import probe from 'probe-image-size';
import { parsePercentageStringToFraction } from './widthUtils';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CalculatedDimensions {
  width: number;
  height: number;
}

/**
 * Parse width value - accepts either number (pixels) or percentage string
 * @param width - Width value as number or percentage string (e.g., "90%")
 * @param availableWidthPx - Available document width in pixels
 * @returns Width in pixels
 */
export function parseWidthValue(
  width: number | string,
  availableWidthPx: number
): number {
  if (typeof width === 'number') {
    return width;
  }

  // Parse percentage string using shared util while preserving error semantics
  const percentageMatch = (width as string).match(/^(\d+(?:\.\d+)?)%$/);
  if (percentageMatch) {
    const pct = parseFloat(percentageMatch[1]);
    if (pct < 0 || pct > 100) {
      throw new Error(
        `Invalid percentage value: ${width}. Must be between 0% and 100%`
      );
    }
    const fraction = parsePercentageStringToFraction(width as string);
    if (fraction !== undefined) {
      return Math.round(availableWidthPx * fraction);
    }
  }

  throw new Error(
    `Invalid width value: ${width}. Expected number (pixels) or percentage string (e.g., "90%")`
  );
}

/**
 * Parse a generic dimension value (number in px or percentage string)
 * @param value - numeric pixels or percentage string (e.g., "100%")
 * @param availablePx - available pixels for percentage reference
 */
export function parseDimensionValue(
  value: number | string,
  availablePx: number
): number {
  if (typeof value === 'number') return value;
  const percentageMatch = (value as string).match(/^(\d+(?:\.\d+)?)%$/);
  if (percentageMatch) {
    const pct = parseFloat(percentageMatch[1]);
    if (pct < 0 || pct > 100) {
      throw new Error(
        `Invalid percentage value: ${value}. Must be between 0% and 100%`
      );
    }
    const fraction = parsePercentageStringToFraction(value as string);
    if (fraction !== undefined) return Math.round(availablePx * fraction);
  }
  throw new Error(
    `Invalid dimension value: ${value}. Expected number (pixels) or percentage string (e.g., "90%")`
  );
}

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Check if a string is a base64 data URI
 * Supports format: data:image/[type];base64,[data]
 */
export function isBase64Image(string: string): boolean {
  return /^data:image\/[a-zA-Z+]+;base64,/.test(string);
}

/**
 * Decode base64 data URI to Buffer
 * @param dataUri - Base64 data URI (e.g., "data:image/png;base64,iVBORw0KGgo...")
 * @returns Decoded image buffer
 */
export function decodeBase64Image(dataUri: string): Buffer {
  try {
    // Extract the base64 data after the comma
    const base64Data = dataUri.split(',')[1];
    if (!base64Data) {
      throw new Error('Invalid base64 data URI format');
    }
    return Buffer.from(base64Data, 'base64');
  } catch (error) {
    throw new Error(
      `Failed to decode base64 image: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract MIME type from base64 data URI
 * @param dataUri - Base64 data URI (e.g., "data:image/svg+xml;base64,...")
 * @returns MIME type (e.g., "image/svg+xml") or undefined if not found
 */
export function extractMimeTypeFromDataUri(
  dataUri: string
): string | undefined {
  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  return match ? match[1] : undefined;
}

/**
 * Detect image type from file extension
 * @param path - File path or URL
 * @returns Image type (jpg, png, gif, bmp, svg) or undefined
 */
export function detectImageTypeFromExtension(
  path: string
): 'jpg' | 'png' | 'gif' | 'bmp' | 'svg' | undefined {
  const extension = path.toLowerCase().split('.').pop()?.split('?')[0]; // Handle query params in URLs
  switch (extension) {
  case 'jpg':
  case 'jpeg':
    return 'jpg';
  case 'png':
    return 'png';
  case 'gif':
    return 'gif';
  case 'bmp':
    return 'bmp';
  case 'svg':
    return 'svg';
  default:
    return undefined;
  }
}

/**
 * Detect image type from MIME type
 * @param mimeType - MIME type string (e.g., "image/svg+xml", "image/png")
 * @returns Image type (jpg, png, gif, bmp, svg) or undefined
 */
export function detectImageTypeFromMimeType(
  mimeType: string
): 'jpg' | 'png' | 'gif' | 'bmp' | 'svg' | undefined {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('svg')) return 'svg';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  return undefined;
}

/**
 * Detect image type from path or base64 data URI
 * Prioritizes: MIME type from base64 > file extension > default to 'png'
 * @param imagePath - File path, URL, or base64 data URI
 * @returns Image type (jpg, png, gif, bmp, svg)
 */
export function detectImageType(
  imagePath: string
): 'jpg' | 'png' | 'gif' | 'bmp' | 'svg' {
  // Check if it's a base64 data URI and extract MIME type
  if (isBase64Image(imagePath)) {
    const mimeType = extractMimeTypeFromDataUri(imagePath);
    if (mimeType) {
      const typeFromMime = detectImageTypeFromMimeType(mimeType);
      if (typeFromMime) return typeFromMime;
    }
  }

  // Try to detect from file extension
  const typeFromExtension = detectImageTypeFromExtension(imagePath);
  if (typeFromExtension) return typeFromExtension;

  // Default to PNG for backward compatibility
  return 'png';
}

/**
 * Download image from URL and return buffer
 * Uses native fetch with automatic redirect following and proper headers
 */
export async function downloadImageFromUrl(url: string): Promise<Buffer> {
  try {
    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; json-to-docx/1.0)',
      },
      redirect: 'follow', // Automatically follow redirects (default behavior)
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `Failed to download image: HTTP ${response.status} ${response.statusText}`
      );
    }

    // Get the response as an ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Convert ArrayBuffer to Buffer
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error instanceof Error) {
      // Handle timeout errors
      if (error.name === 'AbortError') {
        throw new Error(
          'Failed to download image: Request timeout after 10 seconds'
        );
      }
      throw new Error(`Failed to download image from ${url}: ${error.message}`);
    }
    throw new Error(`Failed to download image from ${url}: Unknown error`);
  }
}

/**
 * Get image buffer from base64 data URI, URL, or local file
 */
export async function getImageBuffer(imagePath: string): Promise<Buffer> {
  // Check for base64 data URI first
  if (isBase64Image(imagePath)) {
    return decodeBase64Image(imagePath);
  }
  // Check for URL
  if (isValidUrl(imagePath)) {
    return await downloadImageFromUrl(imagePath);
  }
  // Otherwise treat as local file path
  return readFileSync(imagePath);
}

/**
 * Get the dimensions of an image file or URL
 */
export async function getImageDimensions(
  imagePath: string
): Promise<ImageDimensions> {
  try {
    const imageBuffer = await getImageBuffer(imagePath);
    const result = probe.sync(imageBuffer);

    if (!result) {
      throw new Error(`Unable to determine dimensions for image: ${imagePath}`);
    }

    return {
      width: result.width,
      height: result.height,
    };
  } catch (error) {
    throw new Error(
      `Error reading image dimensions from ${imagePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Calculate missing dimension while preserving aspect ratio
 */
export function calculateMissingDimension(
  originalWidth: number,
  originalHeight: number,
  targetWidth?: number,
  targetHeight?: number
): CalculatedDimensions {
  if (targetWidth && targetHeight) {
    // Both dimensions provided, use as-is
    return { width: targetWidth, height: targetHeight };
  }

  const aspectRatio = originalWidth / originalHeight;

  if (targetWidth && !targetHeight) {
    // Width provided, calculate height
    return {
      width: targetWidth,
      height: Math.round(targetWidth / aspectRatio),
    };
  }

  if (!targetWidth && targetHeight) {
    // Height provided, calculate width
    return {
      width: Math.round(targetHeight * aspectRatio),
      height: targetHeight,
    };
  }

  // Neither provided, return original dimensions
  return { width: originalWidth, height: originalHeight };
}

/**
 * Calculate image dimensions with aspect ratio preservation and fallback constraints
 */
export async function calculateImageDimensions(
  imagePath: string,
  targetWidth?: number,
  targetHeight?: number,
  fallbackWidth: number = 300,
  fallbackHeight: number = 180
): Promise<CalculatedDimensions> {
  try {
    const originalDimensions = await getImageDimensions(imagePath);
    return calculateMissingDimension(
      originalDimensions.width,
      originalDimensions.height,
      targetWidth,
      targetHeight
    );
  } catch (error) {
    // If we can't read the image, use fallback logic
    if (targetWidth && targetHeight) {
      return { width: targetWidth, height: targetHeight };
    }

    if (targetWidth && !targetHeight) {
      // Use a default aspect ratio (16:9) for fallback
      return { width: targetWidth, height: Math.round((targetWidth * 9) / 16) };
    }

    if (!targetWidth && targetHeight) {
      // Use a default aspect ratio (16:9) for fallback
      return {
        width: Math.round((targetHeight * 16) / 9),
        height: targetHeight,
      };
    }

    // No dimensions provided and can't read image, use fallback
    return { width: fallbackWidth, height: fallbackHeight };
  }
}
