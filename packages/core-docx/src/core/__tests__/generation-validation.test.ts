import { describe, it, expect } from 'vitest';
import { generateBufferFromJson } from '../generator';
import { JsonValidationError } from '../../json/parser';
import type { ReportComponentDefinition } from '../../types';

// A minimal valid document used as the base for each case.
function validDoc(): ReportComponentDefinition {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      { name: 'heading', props: { level: 1, text: 'Title' } },
      { name: 'paragraph', props: { text: 'Hello.' } },
    ],
  };
}

describe('generation validation (standard path)', () => {
  it('generates a valid document (object input)', async () => {
    const buf = await generateBufferFromJson(validDoc());
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generates a valid document (string input)', async () => {
    const buf = await generateBufferFromJson(JSON.stringify(validDoc()));
    expect(buf.length).toBeGreaterThan(0);
  });

  it('throws on a malformed nested prop on the object path (the reported bug)', async () => {
    const doc = validDoc();
    // Wrong key name: should be { type: 'single' }
    (doc.children[1].props as any).font = {
      size: 14,
      lineSpacing: { name: 'single' },
    };

    await expect(generateBufferFromJson(doc)).rejects.toBeInstanceOf(
      JsonValidationError
    );
    try {
      await generateBufferFromJson(doc);
    } catch (e) {
      const paths = (e as JsonValidationError).validationErrors.map(
        (v) => v.path
      );
      // Strict schema surfaces both the missing required `type` and the
      // unexpected `name` key.
      expect(paths.some((p) => p.includes('lineSpacing/type'))).toBe(true);
      expect(paths.some((p) => p.includes('lineSpacing/name'))).toBe(true);
    }
  });

  it('throws on an unknown extra key (strict nested schema)', async () => {
    const doc = validDoc();
    (doc.children[1].props as any).font = {
      lineSpacing: { type: 'single', bogus: 1 },
    };
    await expect(generateBufferFromJson(doc)).rejects.toBeInstanceOf(
      JsonValidationError
    );
  });

  it('throws on an unknown top-level prop', async () => {
    const doc = validDoc();
    (doc.props as any).title = 'Not a real prop'; // belongs under metadata.title
    await expect(generateBufferFromJson(doc)).rejects.toBeInstanceOf(
      JsonValidationError
    );
  });

  it('allowUnknownFields strips unknown keys instead of throwing', async () => {
    const doc = validDoc();
    (doc.children[1].props as any).font = {
      lineSpacing: { type: 'single', bogus: 1 },
    };
    const buf = await generateBufferFromJson(doc, {
      validation: { allowUnknownFields: true },
    });
    expect(buf.length).toBeGreaterThan(0);
  });

  it('validation.enabled=false skips validation entirely', async () => {
    const doc = validDoc();
    (doc.children[1].props as any).font = {
      lineSpacing: { name: 'single' },
    };
    // Would throw with validation on; opting out lets it through.
    const buffer = await generateBufferFromJson(doc, {
      validation: { enabled: false },
    });
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('throws on invalid JSON-string structure', async () => {
    const bad = JSON.stringify({ name: 'docx' }); // missing children
    await expect(generateBufferFromJson(bad)).rejects.toBeTruthy();
  });
});
