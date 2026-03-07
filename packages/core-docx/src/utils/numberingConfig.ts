/**
 * Numbering Configuration Utilities
 * Utilities for creating and managing docx numbering configurations
 */

import { AlignmentType, convertInchesToTwip, LevelFormat } from 'docx';
import type { ILevelsOptions } from 'docx';

// Type mapping from schema strings to docx LevelFormat values
const LEVEL_FORMAT_MAP: Record<
  string,
  (typeof LevelFormat)[keyof typeof LevelFormat]
> = {
  decimal: LevelFormat.DECIMAL,
  upperRoman: LevelFormat.UPPER_ROMAN,
  lowerRoman: LevelFormat.LOWER_ROMAN,
  upperLetter: LevelFormat.UPPER_LETTER,
  lowerLetter: LevelFormat.LOWER_LETTER,
  bullet: LevelFormat.BULLET,
  ordinal: LevelFormat.ORDINAL,
  cardinalText: LevelFormat.CARDINAL_TEXT,
  ordinalText: LevelFormat.ORDINAL_TEXT,
  hex: LevelFormat.HEX,
  chicago: LevelFormat.CHICAGO,
  ideographDigital: LevelFormat.IDEOGRAPH__DIGITAL,
  japaneseCounting: LevelFormat.JAPANESE_COUNTING,
  aiueo: LevelFormat.AIUEO,
  iroha: LevelFormat.IROHA,
  decimalFullWidth: LevelFormat.DECIMAL_FULL_WIDTH,
  decimalHalfWidth: LevelFormat.DECIMAL_HALF_WIDTH,
  japaneseLegal: LevelFormat.JAPANESE_LEGAL,
  japaneseDigitalTenThousand: LevelFormat.JAPANESE_DIGITAL_TEN_THOUSAND,
  decimalEnclosedCircle: LevelFormat.DECIMAL_ENCLOSED_CIRCLE,
  decimalFullWidth2: LevelFormat.DECIMAL_FULL_WIDTH2,
  aiueoFullWidth: LevelFormat.AIUEO_FULL_WIDTH,
  irohaFullWidth: LevelFormat.IROHA_FULL_WIDTH,
  decimalZero: LevelFormat.DECIMAL_ZERO,
  ganada: LevelFormat.GANADA,
  chosung: LevelFormat.CHOSUNG,
  decimalEnclosedFullstop: LevelFormat.DECIMAL_ENCLOSED_FULLSTOP,
  decimalEnclosedParen: LevelFormat.DECIMAL_ENCLOSED_PARENTHESES,
  decimalEnclosedCircleChinese: LevelFormat.DECIMAL_ENCLOSED_CIRCLE_CHINESE,
  ideographEnclosedCircle: LevelFormat.IDEOGRAPH_ENCLOSED_CIRCLE,
  ideographTraditional: LevelFormat.IDEOGRAPH_TRADITIONAL,
  ideographZodiac: LevelFormat.IDEOGRAPH_ZODIAC,
  ideographZodiacTraditional: LevelFormat.IDEOGRAPH_ZODIAC_TRADITIONAL,
  taiwaneseCounting: LevelFormat.TAIWANESE_COUNTING,
  ideographLegalTraditional: LevelFormat.IDEOGRAPH_LEGAL_TRADITIONAL,
  taiwaneseCountingThousand: LevelFormat.TAIWANESE_COUNTING_THOUSAND,
  taiwaneseDigital: LevelFormat.TAIWANESE_DIGITAL,
  chineseCounting: LevelFormat.CHINESE_COUNTING,
  chineseLegalSimplified: LevelFormat.CHINESE_LEGAL_SIMPLIFIED,
  chineseCountingThousand: LevelFormat.CHINESE_COUNTING_THOUSAND,
  koreanDigital: LevelFormat.KOREAN_DIGITAL,
  koreanCounting: LevelFormat.KOREAN_COUNTING,
  koreanLegal: LevelFormat.KOREAN_LEGAL,
  koreanDigital2: LevelFormat.KOREAN_DIGITAL2,
  vietnameseCounting: LevelFormat.VIETNAMESE_COUNTING,
  russianLower: LevelFormat.RUSSIAN_LOWER,
  russianUpper: LevelFormat.RUSSIAN_UPPER,
  none: LevelFormat.NONE,
  numberInDash: LevelFormat.NUMBER_IN_DASH,
  hebrew1: LevelFormat.HEBREW1,
  hebrew2: LevelFormat.HEBREW2,
  arabicAlpha: LevelFormat.ARABIC_ALPHA,
  arabicAbjad: LevelFormat.ARABIC_ABJAD,
  hindiVowels: LevelFormat.HINDI_VOWELS,
  hindiConsonants: LevelFormat.HINDI_CONSONANTS,
  hindiNumbers: LevelFormat.HINDI_NUMBERS,
  hindiCounting: LevelFormat.HINDI_COUNTING,
  thaiLetters: LevelFormat.THAI_LETTERS,
  thaiNumbers: LevelFormat.THAI_NUMBERS,
  thaiCounting: LevelFormat.THAI_COUNTING,
};

const ALIGNMENT_MAP: Record<
  string,
  (typeof AlignmentType)[keyof typeof AlignmentType]
> = {
  start: AlignmentType.START,
  end: AlignmentType.END,
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
};

export interface ListLevelConfig {
  level: number;
  format?: string;
  text?: string;
  alignment?: string;
  indent?: {
    left?: number;
    hanging?: number;
  };
  start?: number;
}

export interface NumberingConfig {
  reference: string;
  levels: ListLevelConfig[];
}

/**
 * Convert schema format string to docx LevelFormat
 */
function getLevelFormat(
  format?: string
): (typeof LevelFormat)[keyof typeof LevelFormat] {
  if (!format) return LevelFormat.BULLET;
  return LEVEL_FORMAT_MAP[format] || LevelFormat.BULLET;
}

/**
 * Convert schema alignment string to docx AlignmentType
 */
function getAlignment(
  alignment?: string
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (!alignment) return AlignmentType.LEFT;
  return ALIGNMENT_MAP[alignment] || AlignmentType.LEFT;
}

/**
 * Create a default level configuration for a given level number
 */
function createDefaultLevel(
  level: number,
  format: (typeof LevelFormat)[keyof typeof LevelFormat] = LevelFormat.BULLET,
  text?: string
): ILevelsOptions {
  const baseIndent = 0.5 * (level + 1); // Increase indent for each level
  const hangingIndent = 0.25;

  return {
    level,
    format,
    text: text || (format === LevelFormat.BULLET ? '•' : '%1.'),
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: {
          left: convertInchesToTwip(baseIndent),
          hanging: convertInchesToTwip(hangingIndent),
        },
      },
    },
  };
}

/**
 * Create numbering configuration from list config
 * Returns a single config item that can be added to INumberingOptions.config array
 */
export function createNumberingConfig(config: NumberingConfig): {
  levels: ILevelsOptions[];
  reference: string;
} {
  const levels: ILevelsOptions[] = [];

  // Process each level
  for (const levelConfig of config.levels) {
    const format = getLevelFormat(levelConfig.format);
    const alignment = getAlignment(levelConfig.alignment);
    const text =
      levelConfig.text ||
      (format === LevelFormat.BULLET ? '•' : `%${levelConfig.level + 1}.`);

    // Calculate indentation
    const baseIndent =
      levelConfig.indent?.left !== undefined
        ? levelConfig.indent.left / 72 // Convert points to inches
        : 0.5 * (levelConfig.level + 1);

    const hangingIndent =
      levelConfig.indent?.hanging !== undefined
        ? levelConfig.indent.hanging / 72 // Convert points to inches
        : 0.25;

    const level: ILevelsOptions = {
      level: levelConfig.level,
      format,
      text,
      alignment,
      style: {
        paragraph: {
          indent: {
            left: convertInchesToTwip(baseIndent),
            hanging: convertInchesToTwip(hangingIndent),
          },
        },
      },
      // Add start number if specified
      ...(levelConfig.start !== undefined && { start: levelConfig.start }),
    };

    levels.push(level);
  }

  return {
    reference: config.reference,
    levels,
  };
}

/**
 * Create a simple bullet list configuration
 */
export function createBulletListConfig(
  reference: string,
  bullet: string = '•'
): { levels: ILevelsOptions[]; reference: string } {
  return {
    reference,
    levels: [
      createDefaultLevel(0, LevelFormat.BULLET, bullet),
      createDefaultLevel(1, LevelFormat.BULLET, '◦'),
      createDefaultLevel(2, LevelFormat.BULLET, '▪'),
    ],
  };
}

/**
 * Create a simple numbered list configuration
 */
export function createNumberedListConfig(
  reference: string,
  start: number = 1
): { levels: ILevelsOptions[]; reference: string } {
  return {
    reference,
    levels: [
      { ...createDefaultLevel(0, LevelFormat.DECIMAL, '%1.'), start },
      createDefaultLevel(1, LevelFormat.LOWER_LETTER, '%2.'),
      createDefaultLevel(2, LevelFormat.LOWER_ROMAN, '%3.'),
    ],
  };
}

/**
 * Registry for managing numbering configurations
 */
export class NumberingRegistry {
  private configs: Map<
    string,
    { levels: ILevelsOptions[]; reference: string }
  > = new Map();
  private counter = 0;

  /**
   * Register a numbering configuration
   */
  register(config: { levels: ILevelsOptions[]; reference: string }): string {
    const reference = config.reference;
    this.configs.set(reference, config);
    return reference;
  }

  /**
   * Generate a unique reference ID
   */
  generateReference(prefix: string = 'list'): string {
    return `${prefix}-${++this.counter}`;
  }

  /**
   * Get all registered configurations as an array suitable for INumberingOptions
   */
  getAll(): { levels: ILevelsOptions[]; reference: string }[] {
    return Array.from(this.configs.values());
  }

  /**
   * Clear all configurations
   */
  clear(): void {
    this.configs.clear();
    this.counter = 0;
  }

  /**
   * Check if a reference exists
   */
  has(reference: string): boolean {
    return this.configs.has(reference);
  }

  /**
   * Get a configuration by reference
   */
  get(
    reference: string
  ): { levels: ILevelsOptions[]; reference: string } | undefined {
    return this.configs.get(reference);
  }
}

// Global registry instance
export const globalNumberingRegistry = new NumberingRegistry();
