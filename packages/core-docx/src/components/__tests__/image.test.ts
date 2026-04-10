import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Paragraph } from 'docx';
import { createMockTheme } from './helpers';
import type { ComponentDefinition } from '../../types';

// Mock createImage function
vi.mock('../../core/content', async () => {
  const { Paragraph } = await vi.importActual<typeof import('docx')>('docx');
  return {
    createImage: vi.fn().mockResolvedValue([new Paragraph({})]),
  };
});

import { renderImageComponent } from '../image';
import { createImage } from '../../core/content';
const mockCreateImage = createImage as any;

describe('components/image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('renderImageComponent', () => {
    it('should render image with path', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          caption: undefined,
          width: undefined,
          height: undefined,
          alignment: undefined,
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render image with caption', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.jpg',
          caption: 'Figure 1: Sample Image',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.jpg',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          caption: 'Figure 1: Sample Image',
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render image with specific width', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          width: 400,
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: 400,
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should render image with specific height', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          height: 300,
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          height: 300,
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should render image with both width and height', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          width: 600,
          height: 400,
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: 600,
          height: 400,
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should render image with left alignment', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          alignment: 'left',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          alignment: 'left',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should render image with center alignment', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          alignment: 'center',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          alignment: 'center',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should render image with right alignment', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          alignment: 'right',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          alignment: 'right',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should handle various image formats', async () => {
      const formats = [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.bmp',
        '.svg',
        '.webp',
      ];

      for (const format of formats) {
        const component: ComponentDefinition = {
          name: 'image',
          props: {
            path: `/path/to/image${format}`,
          },
        };

        const result = await renderImageComponent(component, createMockTheme());

        expect(mockCreateImage).toHaveBeenCalledWith(
          `/path/to/image${format}`,
          expect.any(Object),
          undefined,
          expect.any(Object)
        );
        expect(result).toHaveLength(1);
      }
    });

    it('should handle absolute file paths', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/Users/user/Documents/images/photo.jpg',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/Users/user/Documents/images/photo.jpg',
        expect.any(Object),
        undefined,
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
    });

    it('should handle relative file paths', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: './images/logo.png',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        './images/logo.png',
        expect.any(Object),
        undefined,
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
    });

    it('should handle URL paths', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: 'https://example.com/image.png',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        'https://example.com/image.png',
        expect.any(Object),
        undefined,
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
    });

    it('should handle base64 images', async () => {
      const base64Data =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          base64: base64Data,
          width: 100,
          height: 100,
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        base64Data,
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: 100,
          height: 100,
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should prioritize base64 over path when both provided', async () => {
      const base64Data =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          base64: base64Data,
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      // Should use base64 when both are provided
      expect(mockCreateImage).toHaveBeenCalledWith(
        base64Data,
        expect.any(Object),
        undefined,
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
    });

    it('should apply theme defaults', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
        },
      };

      const theme = createMockTheme({
        componentDefaults: {
          image: {
            width: 500,
            height: 350,
            alignment: 'center',
          },
        },
      });

      const result = await renderImageComponent(component, theme);

      expect(mockCreateImage).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('should handle non-image component type', async () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          content: 'Not an image',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('should handle missing config', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {},
      } as ComponentDefinition;

      // Should throw error when neither path nor base64 is provided
      await expect(
        renderImageComponent(component, createMockTheme())
      ).rejects.toThrow(
        'Image component requires either "path" or "base64" property'
      );
    });

    it('should handle empty path', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '',
        },
      };

      // Should throw error when path is empty and base64 is not provided
      await expect(
        renderImageComponent(component, createMockTheme())
      ).rejects.toThrow(
        'Image component requires either "path" or "base64" property'
      );
    });

    it('should handle very long caption', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          caption:
            'This is a very long caption that describes the image in great detail. It contains multiple sentences and should wrap properly when rendered in the document. The caption provides context and explanation for the image.',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          caption: expect.stringContaining('This is a very long caption'),
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should handle all options combined', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/complex/path/to/image.jpg',
          caption: 'Complex Image with All Options',
          width: 800,
          height: 600,
          alignment: 'center',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/complex/path/to/image.jpg',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          caption: 'Complex Image with All Options',
          width: 800,
          height: 600,
          alignment: 'center',
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle percentage width (90%)', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          width: '90%',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: '90%',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should handle percentage width (50%)', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          width: '50%',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: '50%',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should handle percentage width (100%)', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          width: '100%',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: '100%',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should handle decimal percentage width (75.5%)', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
          width: '75.5%',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: '75.5%',
        })
      );
      expect(result).toHaveLength(1);
    });

    it('should pass undefined width when not specified (default 100% applied in createImage)', async () => {
      const component: ComponentDefinition = {
        name: 'image',
        props: {
          path: '/path/to/image.png',
        },
      };

      const result = await renderImageComponent(component, createMockTheme());

      // renderImageComponent passes undefined, createImage applies 100% default
      expect(mockCreateImage).toHaveBeenCalledWith(
        '/path/to/image.png',
        expect.any(Object),
        undefined,
        expect.objectContaining({
          width: undefined,
        })
      );
      expect(result).toHaveLength(1);
    });
  });
});
