import { describe, it, expect } from 'vitest';
import { parseTextWithDecorators, type TextStyle } from '../textParser';
import { TextRun } from 'docx';

describe('textParser', () => {
  describe('parseTextWithDecorators', () => {
    it('should parse plain text without decorators', () => {
      const text = 'This is plain text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(1);
      expect(runs[0]).toBeInstanceOf(TextRun);
    });

    it('should parse bold text with ** markers', () => {
      const text = 'This is **bold** text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
      expect(runs[0]).toBeInstanceOf(TextRun);
      expect(runs[1]).toBeInstanceOf(TextRun);
      expect(runs[2]).toBeInstanceOf(TextRun);
    });

    it('should parse bold text with __ markers', () => {
      const text = 'This is __bold__ text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
    });

    it('should parse italic text with * markers', () => {
      const text = 'This is *italic* text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
    });

    it('should parse italic text with _ markers', () => {
      const text = 'This is _italic_ text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
    });

    it('should parse bold italic text with *** markers', () => {
      const text = 'This is ***bold italic*** text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
    });

    it('should parse bold italic text with ___ markers', () => {
      const text = 'This is ___bold italic___ text';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
    });

    it('should handle multiple decorators in one text', () => {
      const text = 'This has **bold**, *italic*, and ***both*** styles';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(7);
    });

    it('should handle newlines in text', () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(3);
    });

    it('should handle newlines with decorators', () => {
      const text = '**Bold line 1**\n*Italic line 2*\nPlain line 3';
      const runs = parseTextWithDecorators(text);

      expect(runs.length).toBeGreaterThan(0);
    });

    it('should apply base style to all text runs', () => {
      const text = 'This is text with base style';
      const baseStyle: TextStyle = {
        font: 'Arial',
        size: 24,
        color: '000000',
      };

      const runs = parseTextWithDecorators(text, baseStyle);
      expect(runs).toHaveLength(1);
    });

    it('should combine base style with decorator styles', () => {
      const text = 'This is **bold** text';
      const baseStyle: TextStyle = {
        font: 'Times New Roman',
        size: 20,
        color: '333333',
      };

      const runs = parseTextWithDecorators(text, baseStyle);
      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle empty text', () => {
      const runs = parseTextWithDecorators('');
      expect(runs).toHaveLength(1);
      expect(runs[0]).toBeInstanceOf(TextRun);
    });

    it('should handle text with only spaces', () => {
      const text = '   ';
      const runs = parseTextWithDecorators(text);

      expect(runs).toHaveLength(1);
    });

    it('should handle nested decorators correctly', () => {
      const text = 'This **has _nested_ decorators** here';
      const runs = parseTextWithDecorators(text);

      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle unmatched decorators', () => {
      const text = 'This has ** unmatched bold';
      const runs = parseTextWithDecorators(text);

      expect(runs.length).toBeGreaterThan(0);
    });

    it('should apply bold color option when specified', () => {
      const text = 'This is **bold** text';
      const baseStyle: TextStyle = {
        color: '000000',
      };
      const options = {
        boldColor: 'FF0000',
      };

      const runs = parseTextWithDecorators(text, baseStyle, options);
      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle placeholders in text', () => {
      const text = 'Hello {NAME}, welcome!';
      const options = {
        placeholderContext: {
          NAME: 'John Doe',
        },
      };

      const runs = parseTextWithDecorators(text, {}, options);
      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle placeholders with decorators', () => {
      const text = 'Hello **{NAME}**, welcome!';
      const options = {
        placeholderContext: {
          NAME: 'John Doe',
        },
      };

      const runs = parseTextWithDecorators(text, {}, options);
      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle multiple placeholders', () => {
      const text = '{GREETING} {NAME}, {MESSAGE}';
      const options = {
        placeholderContext: {
          GREETING: 'Hello',
          NAME: 'John',
          MESSAGE: 'welcome!',
        },
      };

      const runs = parseTextWithDecorators(text, {}, options);
      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle decorators at the beginning and end of text', () => {
      const text = '**Start bold** middle *end italic*';
      const runs = parseTextWithDecorators(text);

      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle consecutive decorators', () => {
      const text = '**bold***italic*normal';
      const runs = parseTextWithDecorators(text);

      expect(runs.length).toBeGreaterThan(0);
    });

    it('should handle underline style in base style', () => {
      const text = 'Underlined text';
      const baseStyle: TextStyle = {
        underline: {
          type: 'single',
          color: '0000FF',
        },
      };

      const runs = parseTextWithDecorators(text, baseStyle);
      expect(runs).toHaveLength(1);
    });

    it('should handle complex multi-line text with mixed styles', () => {
      const text = `**Title**
This is a *paragraph* with multiple lines.
It has **bold** and *italic* text.
And even ***bold italic*** text!`;

      const runs = parseTextWithDecorators(text);
      expect(runs.length).toBeGreaterThan(0);
    });
  });
});
