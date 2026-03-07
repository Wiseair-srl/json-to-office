import { describe, it, expect } from 'vitest';
import {
  parseWidthValue,
  detectImageType,
  detectImageTypeFromExtension,
  detectImageTypeFromMimeType,
  extractMimeTypeFromDataUri,
} from '../imageUtils';

describe('imageUtils', () => {
  describe('parseWidthValue', () => {
    const availableWidth = 600; // Example available width in pixels

    describe('numeric values', () => {
      it('should return numeric width unchanged', () => {
        expect(parseWidthValue(400, availableWidth)).toBe(400);
      });

      it('should handle zero width', () => {
        expect(parseWidthValue(0, availableWidth)).toBe(0);
      });

      it('should handle large numeric values', () => {
        expect(parseWidthValue(1920, availableWidth)).toBe(1920);
      });
    });

    describe('percentage values', () => {
      it('should calculate 50% correctly', () => {
        expect(parseWidthValue('50%', availableWidth)).toBe(300);
      });

      it('should calculate 90% correctly', () => {
        expect(parseWidthValue('90%', availableWidth)).toBe(540);
      });

      it('should calculate 100% correctly', () => {
        expect(parseWidthValue('100%', availableWidth)).toBe(600);
      });

      it('should calculate 0% correctly', () => {
        expect(parseWidthValue('0%', availableWidth)).toBe(0);
      });

      it('should handle decimal percentages', () => {
        expect(parseWidthValue('75.5%', availableWidth)).toBe(453);
      });

      it('should handle small decimal percentages', () => {
        expect(parseWidthValue('33.33%', availableWidth)).toBe(200);
      });

      it('should round to nearest pixel', () => {
        expect(parseWidthValue('66.66%', availableWidth)).toBe(400);
      });
    });

    describe('edge cases', () => {
      it('should handle 1% width', () => {
        expect(parseWidthValue('1%', availableWidth)).toBe(6);
      });

      it('should handle 99% width', () => {
        expect(parseWidthValue('99%', availableWidth)).toBe(594);
      });

      it('should handle very small percentages', () => {
        expect(parseWidthValue('0.1%', availableWidth)).toBe(1);
      });
    });

    describe('error handling', () => {
      it('should throw error for percentage > 100', () => {
        expect(() => parseWidthValue('101%', availableWidth)).toThrow(
          'Invalid percentage value: 101%. Must be between 0% and 100%'
        );
      });

      it('should throw error for percentage > 100 (large)', () => {
        expect(() => parseWidthValue('200%', availableWidth)).toThrow(
          'Invalid percentage value: 200%. Must be between 0% and 100%'
        );
      });

      it('should throw error for negative percentage', () => {
        expect(() => parseWidthValue('-10%', availableWidth)).toThrow(
          'Invalid width value'
        );
      });

      it('should throw error for invalid percentage format', () => {
        expect(() => parseWidthValue('50', availableWidth)).toThrow(
          'Invalid width value: 50. Expected number (pixels) or percentage string'
        );
      });

      it('should throw error for invalid string format', () => {
        expect(() => parseWidthValue('abc', availableWidth)).toThrow(
          'Invalid width value: abc. Expected number (pixels) or percentage string'
        );
      });

      it('should throw error for percentage with no number', () => {
        expect(() => parseWidthValue('%', availableWidth)).toThrow(
          'Invalid width value'
        );
      });

      it('should throw error for percentage with space', () => {
        expect(() => parseWidthValue('50 %', availableWidth)).toThrow(
          'Invalid width value'
        );
      });
    });

    describe('different available widths', () => {
      it('should calculate correctly for small available width', () => {
        expect(parseWidthValue('50%', 200)).toBe(100);
      });

      it('should calculate correctly for large available width', () => {
        expect(parseWidthValue('50%', 1920)).toBe(960);
      });

      it('should calculate correctly for odd available width', () => {
        expect(parseWidthValue('50%', 555)).toBe(278); // Rounded from 277.5
      });
    });

    describe('default width behavior', () => {
      it('should handle 100% width as default', () => {
        expect(parseWidthValue('100%', availableWidth)).toBe(600);
      });

      it('should calculate 100% correctly for various available widths', () => {
        expect(parseWidthValue('100%', 800)).toBe(800);
        expect(parseWidthValue('100%', 1200)).toBe(1200);
        expect(parseWidthValue('100%', 400)).toBe(400);
      });
    });
  });

  describe('extractMimeTypeFromDataUri', () => {
    it('should extract MIME type from PNG data URI', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgo...';
      expect(extractMimeTypeFromDataUri(dataUri)).toBe('image/png');
    });

    it('should extract MIME type from SVG data URI', () => {
      const dataUri = 'data:image/svg+xml;base64,PHN2Zy...';
      expect(extractMimeTypeFromDataUri(dataUri)).toBe('image/svg+xml');
    });

    it('should extract MIME type from JPEG data URI', () => {
      const dataUri = 'data:image/jpeg;base64,/9j/4AAQ...';
      expect(extractMimeTypeFromDataUri(dataUri)).toBe('image/jpeg');
    });

    it('should return undefined for invalid data URI', () => {
      expect(extractMimeTypeFromDataUri('not-a-data-uri')).toBeUndefined();
    });

    it('should return undefined for data URI without MIME type', () => {
      expect(extractMimeTypeFromDataUri('data:;base64,abc')).toBeUndefined();
    });
  });

  describe('detectImageTypeFromExtension', () => {
    it('should detect PNG from .png extension', () => {
      expect(detectImageTypeFromExtension('image.png')).toBe('png');
      expect(detectImageTypeFromExtension('/path/to/image.png')).toBe('png');
    });

    it('should detect JPG from .jpg and .jpeg extensions', () => {
      expect(detectImageTypeFromExtension('image.jpg')).toBe('jpg');
      expect(detectImageTypeFromExtension('image.jpeg')).toBe('jpg');
    });

    it('should detect SVG from .svg extension', () => {
      expect(detectImageTypeFromExtension('icon.svg')).toBe('svg');
      expect(detectImageTypeFromExtension('/assets/icon.svg')).toBe('svg');
    });

    it('should detect GIF from .gif extension', () => {
      expect(detectImageTypeFromExtension('animation.gif')).toBe('gif');
    });

    it('should detect BMP from .bmp extension', () => {
      expect(detectImageTypeFromExtension('bitmap.bmp')).toBe('bmp');
    });

    it('should handle URLs with query parameters', () => {
      expect(
        detectImageTypeFromExtension('https://example.com/image.png?v=123')
      ).toBe('png');
      expect(
        detectImageTypeFromExtension('https://example.com/icon.svg?size=large')
      ).toBe('svg');
    });

    it('should be case insensitive', () => {
      expect(detectImageTypeFromExtension('IMAGE.PNG')).toBe('png');
      expect(detectImageTypeFromExtension('ICON.SVG')).toBe('svg');
      expect(detectImageTypeFromExtension('Photo.JPG')).toBe('jpg');
    });

    it('should return undefined for unknown extensions', () => {
      expect(detectImageTypeFromExtension('file.txt')).toBeUndefined();
      expect(detectImageTypeFromExtension('document.pdf')).toBeUndefined();
    });

    it('should return undefined for files without extension', () => {
      expect(detectImageTypeFromExtension('filename')).toBeUndefined();
    });
  });

  describe('detectImageTypeFromMimeType', () => {
    it('should detect PNG from image/png MIME type', () => {
      expect(detectImageTypeFromMimeType('image/png')).toBe('png');
    });

    it('should detect JPG from image/jpeg MIME type', () => {
      expect(detectImageTypeFromMimeType('image/jpeg')).toBe('jpg');
      expect(detectImageTypeFromMimeType('image/jpg')).toBe('jpg');
    });

    it('should detect SVG from image/svg+xml MIME type', () => {
      expect(detectImageTypeFromMimeType('image/svg+xml')).toBe('svg');
    });

    it('should detect GIF from image/gif MIME type', () => {
      expect(detectImageTypeFromMimeType('image/gif')).toBe('gif');
    });

    it('should detect BMP from image/bmp MIME type', () => {
      expect(detectImageTypeFromMimeType('image/bmp')).toBe('bmp');
    });

    it('should be case insensitive', () => {
      expect(detectImageTypeFromMimeType('IMAGE/PNG')).toBe('png');
      expect(detectImageTypeFromMimeType('Image/Svg+Xml')).toBe('svg');
    });

    it('should return undefined for unknown MIME types', () => {
      expect(detectImageTypeFromMimeType('text/plain')).toBeUndefined();
      expect(detectImageTypeFromMimeType('application/pdf')).toBeUndefined();
    });
  });

  describe('detectImageType', () => {
    describe('base64 data URIs', () => {
      it('should detect PNG from base64 data URI', () => {
        const dataUri = 'data:image/png;base64,iVBORw0KGgo...';
        expect(detectImageType(dataUri)).toBe('png');
      });

      it('should detect SVG from base64 data URI', () => {
        const dataUri = 'data:image/svg+xml;base64,PHN2Zy...';
        expect(detectImageType(dataUri)).toBe('svg');
      });

      it('should detect JPEG from base64 data URI', () => {
        const dataUri = 'data:image/jpeg;base64,/9j/4AAQ...';
        expect(detectImageType(dataUri)).toBe('jpg');
      });

      it('should detect GIF from base64 data URI', () => {
        const dataUri = 'data:image/gif;base64,R0lGOD...';
        expect(detectImageType(dataUri)).toBe('gif');
      });
    });

    describe('file paths and URLs', () => {
      it('should detect PNG from file extension', () => {
        expect(detectImageType('/path/to/image.png')).toBe('png');
      });

      it('should detect SVG from file extension', () => {
        expect(detectImageType('/assets/icon.svg')).toBe('svg');
      });

      it('should detect JPEG from file extension', () => {
        expect(detectImageType('photo.jpg')).toBe('jpg');
        expect(detectImageType('photo.jpeg')).toBe('jpg');
      });

      it('should detect from URLs', () => {
        expect(detectImageType('https://example.com/image.png')).toBe('png');
        expect(detectImageType('https://example.com/icon.svg')).toBe('svg');
      });

      it('should handle URLs with query parameters', () => {
        expect(detectImageType('https://example.com/image.png?v=1')).toBe(
          'png'
        );
        expect(detectImageType('https://example.com/icon.svg?size=lg')).toBe(
          'svg'
        );
      });
    });

    describe('fallback behavior', () => {
      it('should default to PNG for unknown file types', () => {
        expect(detectImageType('unknown.xyz')).toBe('png');
        expect(detectImageType('noextension')).toBe('png');
      });

      it('should default to PNG for invalid base64 without MIME type', () => {
        const invalidDataUri = 'data:;base64,abc123';
        expect(detectImageType(invalidDataUri)).toBe('png');
      });
    });

    describe('priority order', () => {
      it('should prioritize MIME type over extension for base64', () => {
        // Even if the data URI says PNG, we trust the MIME type
        const dataUri = 'data:image/svg+xml;base64,iVBORw0KGgo...';
        expect(detectImageType(dataUri)).toBe('svg');
      });
    });
  });
});
