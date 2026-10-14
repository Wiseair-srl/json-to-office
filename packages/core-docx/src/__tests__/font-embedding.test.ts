/**
 * The `embed` export mode: a document's non-safe fonts travel inside the
 * package, as docx.js 9.10 writes them — `word/fonts/font<N>.odttf`, a
 * `w:embed*` per face in the font table, `w:embedTrueTypeFonts` in the
 * settings — with jto deciding which resolved source fills which of Word's
 * four slots, which may be embedded at all, and what key each is obfuscated
 * with.
 *
 * Asserted on the package, not on the object graph: every one of those parts
 * is read by a reader that never sees jto, and the obfuscation key only means
 * something against the bytes it is paired with.
 *
 * The fixture is Life Sans, eight static faces in the repo, none of them
 * installed anywhere these tests run. `no-font-embedding.test.ts` guards the
 * other two modes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { GenerationWarning } from '@json-to-office/shared';
import { generateBufferFromJson } from '../core/generator';

const FONTS = path.resolve(__dirname, '../styles/fonts/life-sans');
const ttf = (file: string): Buffer => readFileSync(path.join(FONTS, file));

const REGULAR = ttf('LifeSans-Regular.ttf');
const BOLD = ttf('LifeSans-Bold.ttf');
const ITALIC = ttf('LifeSans-Italic.ttf');
const BOLD_ITALIC = ttf('LifeSans-Bold-Italic.ttf');
const MEDIUM = ttf('LifeSans-Medium.ttf');
const SEMI_BOLD = ttf('LifeSans-SemiBold.ttf');

/** An uppercase GUID in braces, the only shape Word and LibreOffice decode. */
const FONT_KEY = /^\{[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/;

/** A `kind: "data"` source: the bytes travel in the request, nothing is read from disk. */
const data = (bytes: Buffer, weight: number, italic = false) => ({
  kind: 'data' as const,
  data: bytes.toString('base64'),
  weight,
  italic,
});

type Source = ReturnType<typeof data>;

const document = (children: unknown[] = []) => ({
  name: 'docx' as const,
  props: { theme: 'minimal' },
  children: [
    {
      name: 'heading',
      props: { level: 1, text: 'Title', font: { family: 'Life Sans' } },
    },
    {
      name: 'paragraph',
      props: {
        text: 'Body with **bold** and *italic*.',
        font: { family: 'Life Sans' },
      },
    },
    ...children,
  ],
});

/** A copy of `ttf` claiming the embedding licence `fsType` in its OS/2 table. */
function withFsType(ttf: Buffer, fsType: number): Buffer {
  const out = Buffer.from(ttf);
  const tables = out.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (out.toString('ascii', record, record + 4) === 'OS/2') {
      out.writeUInt16BE(fsType, out.readUInt32BE(record + 8) + 8);
      return out;
    }
  }
  throw new Error('fixture has no OS/2 table');
}

/** Undo ECMA-376 obfuscation: XOR the first 32 bytes with the key, reversed. */
function deobfuscate(part: Buffer, fontKey: string): Buffer {
  const key = Buffer.from(fontKey.replace(/[{}-]/g, ''), 'hex').reverse();
  const out = Buffer.from(part);
  for (let i = 0; i < 32; i++) out[i] ^= key[i % 16];
  return out;
}

async function embed(
  sources: Source[],
  options: { children?: unknown[]; renderer?: 'docxjs' | 'office-open' } = {}
) {
  const warnings: GenerationWarning[] = [];
  const buffer = await generateBufferFromJson(
    document(options.children) as never,
    {
      fonts: {
        mode: 'embed',
        extraEntries: [{ id: 'Life Sans', family: 'Life Sans', sources }],
        googleFonts: { enabled: false },
      },
      warnings,
      ...(options.renderer ? { renderer: options.renderer } : {}),
    }
  );
  const zip = await JSZip.loadAsync(buffer);
  const text = async (name: string) =>
    (await zip.file(name)?.async('string')) ?? '';
  /** Each `w:embed*` of the font table, by element, with its part and key. */
  const embeds = async () => {
    const fontTable = await text('word/fontTable.xml');
    const rels = await text('word/_rels/fontTable.xml.rels');
    return Promise.all(
      [
        ...fontTable.matchAll(
          /<w:(embed\w+) r:id="(rId\d+)" w:fontKey="([^"]+)"\/>/g
        ),
      ].map(async ([, element, id, fontKey]) => {
        const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(
          rels
        )?.[1];
        const part = await zip.file(`word/${target}`)!.async('nodebuffer');
        return {
          element,
          id,
          fontKey,
          target,
          font: deobfuscate(part, fontKey),
        };
      })
    );
  };
  return {
    buffer,
    warnings,
    embeds,
    fontTable: await text('word/fontTable.xml'),
    settings: await text('word/settings.xml'),
    parts: Object.keys(zip.files).filter((f) => /^word\/fonts\/./.test(f)),
  };
}

const coded = (warnings: GenerationWarning[], code: string) =>
  warnings.filter((w) => w.context?.code === code);

describe('embed export mode (docx.js)', () => {
  it('embeds regular, bold, italic and bold italic, keyed by their own bytes', async () => {
    const sources = [
      data(REGULAR, 400),
      data(BOLD, 700),
      data(ITALIC, 400, true),
      data(BOLD_ITALIC, 700, true),
    ];
    const result = await embed(sources);

    expect(result.parts).toEqual([
      'word/fonts/font1.odttf',
      'word/fonts/font2.odttf',
      'word/fonts/font3.odttf',
      'word/fonts/font4.odttf',
    ]);
    expect(result.fontTable.match(/<w:font w:name="Life Sans">/g)).toHaveLength(
      1
    );
    expect(result.settings).toContain('<w:embedTrueTypeFonts/>');

    const embeds = await result.embeds();
    expect(
      embeds.map(({ element, id, target }) => [element, id, target])
    ).toEqual([
      ['embedRegular', 'rId1', 'fonts/font1.odttf'],
      ['embedBold', 'rId2', 'fonts/font2.odttf'],
      ['embedItalic', 'rId3', 'fonts/font3.odttf'],
      ['embedBoldItalic', 'rId4', 'fonts/font4.odttf'],
    ]);
    for (const { fontKey } of embeds) expect(fontKey).toMatch(FONT_KEY);
    // Undoing the XOR with the key the font table names gives back the very
    // file that was registered: the key and the part agree.
    expect(embeds.map(({ font }) => font)).toEqual([
      REGULAR,
      BOLD,
      ITALIC,
      BOLD_ITALIC,
    ]);

    const summary = coded(result.warnings, 'FONT_MODE_EMBED');
    expect(summary).toHaveLength(1);
    expect(summary[0].message).toContain(
      'Life Sans: regular, bold, italic, boldItalic'
    );

    // docx.js mints a random key per face; the deterministic default derives
    // it from the font instead, so a second build is the same package.
    const again = await embed(sources);
    expect(again.buffer.equals(result.buffer)).toBe(true);
  }, 60_000);

  it('fills regular and bold from 500 and 600 when 400 and 700 are missing', async () => {
    const result = await embed([data(MEDIUM, 500), data(SEMI_BOLD, 600)]);

    const embeds = await result.embeds();
    expect(embeds.map(({ element }) => element)).toEqual([
      'embedRegular',
      'embedBold',
    ]);
    expect(embeds.map(({ font }) => font)).toEqual([MEDIUM, SEMI_BOLD]);
    const [summary] = coded(result.warnings, 'FONT_MODE_EMBED');
    expect(summary.message).toContain(
      'Life Sans: regular, bold (regular ← 500, bold ← 600)'
    );
  }, 60_000);

  it('leaves a weight Word has no slot for as a reference', async () => {
    // Any face will do for the 300: what is under test is that the slot rule
    // leaves it out, whatever its bytes say.
    const result = await embed([data(REGULAR, 400), data(MEDIUM, 300)]);

    expect(result.parts).toEqual(['word/fonts/font1.odttf']);
    const dropped = coded(result.warnings, 'FONT_EMBED_WEIGHT_DROPPED');
    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toContain('"Life Sans" weight 300');
    expect(dropped[0].message).toContain('"Life Sans Light"');
  }, 60_000);

  it('never embeds a safe family referenced beside it', async () => {
    const result = await embed([data(REGULAR, 400)], {
      children: [
        {
          name: 'paragraph',
          props: { text: 'Safe.', font: { family: 'Arial' } },
        },
      ],
    });

    expect(result.parts).toEqual(['word/fonts/font1.odttf']);
    expect(result.fontTable).not.toMatch(
      /<w:font w:name="Arial">(?:(?!<\/w:font>).)*<w:embed/
    );
  }, 60_000);

  describe('licence bits (OS/2.fsType)', () => {
    it('skips a restricted face, and with it the whole embedding', async () => {
      const result = await embed([data(withFsType(REGULAR, 0x0002), 400)]);

      expect(coded(result.warnings, 'FONT_EMBED_SKIPPED_LICENSE')).toHaveLength(
        1
      );
      // Nothing embeds, so docx.js is not handed a `fonts` key at all.
      expect(result.parts).toEqual([]);
      expect(result.settings).not.toContain('<w:embedTrueTypeFonts');
      expect(coded(result.warnings, 'FONT_MODE_EMBED')[0].message).toContain(
        'Life Sans: not embedded'
      );
    }, 60_000);

    it('embeds a preview & print face and says Word opens it read-only', async () => {
      const preview = withFsType(REGULAR, 0x0004);
      const result = await embed([data(preview, 400)]);

      expect(result.parts).toEqual(['word/fonts/font1.odttf']);
      expect((await result.embeds())[0].font).toEqual(preview);
      expect(coded(result.warnings, 'FONT_EMBED_READ_ONLY')).toHaveLength(1);
    }, 60_000);

    it('embeds an editable face without a licence warning', async () => {
      const result = await embed([data(withFsType(REGULAR, 0x0008), 400)]);

      expect(result.parts).toEqual(['word/fonts/font1.odttf']);
      expect(
        result.warnings.filter((w) =>
          /^FONT_EMBED_(READ_ONLY|SKIPPED_LICENSE)$/.test(
            String(w.context?.code)
          )
        )
      ).toEqual([]);
    }, 60_000);
  });

  it('falls back to custom on the office-open renderer, and says so', async () => {
    const result = await embed([data(REGULAR, 400)], {
      renderer: 'office-open',
    });

    expect(
      coded(result.warnings, 'FONT_EMBED_UNSUPPORTED_RENDERER')
    ).toHaveLength(1);
    expect(result.parts).toEqual([]);
    expect(coded(result.warnings, 'FONT_MODE_EMBED')).toEqual([]);
  }, 60_000);

  it('lays a contents field out in the embedded face', async () => {
    const children = [
      { name: 'toc', props: { title: 'Contents' } },
      {
        name: 'heading',
        props: { level: 1, text: 'Chapter', font: { family: 'Life Sans' } },
      },
    ];
    const result = await embed([data(REGULAR, 400), data(BOLD, 700)], {
      children,
    });

    expect(coded(result.warnings, 'W_DOCX_PAGE_NUMBERS_UNAVAILABLE')).toEqual(
      []
    );
    // `docx/layout` reads the widths of an embedded family from its file, so
    // nothing had to be guessed and Word is not asked to update the fields.
    // The same document in custom mode has no file to read and keeps asking.
    expect(result.settings).not.toContain('w:updateFields');
  }, 60_000);
});
