/**
 * Curated list of popular Google Fonts for picker autocomplete.
 *
 * Not exhaustive — the full Google Fonts library has ~1500 families.
 * This is ~30 names known to cover most real-world use cases.
 */

export interface PopularGoogleFont {
  family: string;
  category: 'sans' | 'serif' | 'mono' | 'display' | 'handwriting';
  /** Weights available on Google Fonts for this family. */
  weights: number[];
  /** Whether italic variants exist. */
  hasItalic: boolean;
}

export const POPULAR_GOOGLE_FONTS: readonly PopularGoogleFont[] = [
  // Sans-serif
  {
    family: 'Inter',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: false,
  },
  {
    family: 'Roboto',
    category: 'sans',
    weights: [100, 300, 400, 500, 700, 900],
    hasItalic: true,
  },
  {
    family: 'Open Sans',
    category: 'sans',
    weights: [300, 400, 500, 600, 700, 800],
    hasItalic: true,
  },
  {
    family: 'Lato',
    category: 'sans',
    weights: [100, 300, 400, 700, 900],
    hasItalic: true,
  },
  {
    family: 'Montserrat',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Poppins',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Work Sans',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Nunito',
    category: 'sans',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'DM Sans',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Rubik',
    category: 'sans',
    weights: [300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Source Sans 3',
    category: 'sans',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Manrope',
    category: 'sans',
    weights: [200, 300, 400, 500, 600, 700, 800],
    hasItalic: false,
  },
  {
    family: 'Plus Jakarta Sans',
    category: 'sans',
    weights: [200, 300, 400, 500, 600, 700, 800],
    hasItalic: true,
  },
  {
    family: 'IBM Plex Sans',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700],
    hasItalic: true,
  },

  // Serif
  {
    family: 'Playfair Display',
    category: 'serif',
    weights: [400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Merriweather',
    category: 'serif',
    weights: [300, 400, 700, 900],
    hasItalic: true,
  },
  {
    family: 'Lora',
    category: 'serif',
    weights: [400, 500, 600, 700],
    hasItalic: true,
  },
  {
    family: 'Source Serif 4',
    category: 'serif',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'DM Serif Display',
    category: 'serif',
    weights: [400],
    hasItalic: true,
  },
  {
    family: 'Crimson Pro',
    category: 'serif',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Cormorant Garamond',
    category: 'serif',
    weights: [300, 400, 500, 600, 700],
    hasItalic: true,
  },

  // Monospace
  {
    family: 'JetBrains Mono',
    category: 'mono',
    weights: [100, 200, 300, 400, 500, 600, 700, 800],
    hasItalic: true,
  },
  {
    family: 'Fira Code',
    category: 'mono',
    weights: [300, 400, 500, 600, 700],
    hasItalic: false,
  },
  {
    family: 'IBM Plex Mono',
    category: 'mono',
    weights: [100, 200, 300, 400, 500, 600, 700],
    hasItalic: true,
  },
  {
    family: 'Source Code Pro',
    category: 'mono',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    hasItalic: true,
  },
  {
    family: 'Space Mono',
    category: 'mono',
    weights: [400, 700],
    hasItalic: true,
  },

  // Display
  {
    family: 'Bebas Neue',
    category: 'display',
    weights: [400],
    hasItalic: false,
  },
  {
    family: 'Abril Fatface',
    category: 'display',
    weights: [400],
    hasItalic: false,
  },
  {
    family: 'Archivo Black',
    category: 'display',
    weights: [400],
    hasItalic: false,
  },
  {
    family: 'Oswald',
    category: 'display',
    weights: [200, 300, 400, 500, 600, 700],
    hasItalic: false,
  },

  // Handwriting
  {
    family: 'Caveat',
    category: 'handwriting',
    weights: [400, 500, 600, 700],
    hasItalic: false,
  },
  {
    family: 'Pacifico',
    category: 'handwriting',
    weights: [400],
    hasItalic: false,
  },
];
