import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ASSET_UNREADABLE } from '../../rendering/capabilities';
import { assertImageDecodes, imageIntegrityDefect, pngCrc32 } from '../node';

/** A 4x2 RGBA PNG that decodes. */
const VALID_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR42mOIrt34HxkzoAsAAE/xFEFoJgXRAAAAAElFTkSuQmCC';

/** The block matrix's old image, corrupt on purpose: bad CRCs and deflate. */
const CORRUPT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const bytes = (base64: string) => Buffer.from(base64, 'base64');

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(body));
  return Buffer.concat([head, body, crc]);
}

/** A PNG with valid CRCs around whatever IDAT payload is given. */
function png(width: number, height: number, idat: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    bytes(VALID_PNG).subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('imageIntegrityDefect', () => {
  it('passes a PNG that decodes', () => {
    expect(imageIntegrityDefect(bytes(VALID_PNG))).toBeUndefined();
  });

  it('names a chunk whose CRC is wrong', () => {
    expect(imageIntegrityDefect(bytes(CORRUPT_PNG))).toMatch(
      /IHDR chunk fails its CRC/
    );
  });

  it('catches a PNG cut off before IEND', () => {
    const whole = bytes(VALID_PNG);
    expect(imageIntegrityDefect(whole.subarray(0, whole.length - 12))).toMatch(
      /no IEND/
    );
    expect(imageIntegrityDefect(whole.subarray(0, whole.length - 5))).toMatch(
      /truncated/
    );
  });

  it('catches pixel data that does not inflate, even with good CRCs', () => {
    expect(
      imageIntegrityDefect(png(4, 2, Buffer.from('not deflate at all')))
    ).toMatch(/does not decompress/);
  });

  it('catches pixel data that inflates far past what the header promises', () => {
    expect(
      imageIntegrityDefect(png(4, 2, deflateSync(Buffer.alloc(1 << 20))))
    ).toMatch(/does not decompress/);
  });

  it('checks a JPEG for its end-of-image marker', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
    expect(imageIntegrityDefect(jpeg)).toBeUndefined();
    expect(
      imageIntegrityDefect(Buffer.concat([jpeg, Buffer.from([0, 0])]))
    ).toBeUndefined();
    expect(imageIntegrityDefect(jpeg.subarray(0, 6))).toMatch(/JPEG/);
  });

  it('does not judge formats it does not know', () => {
    expect(imageIntegrityDefect(Buffer.from('<svg/>'))).toBeUndefined();
    expect(imageIntegrityDefect(Buffer.from('GIF89a'))).toBeUndefined();
  });
});

describe('assertImageDecodes', () => {
  it('throws ASSET_UNREADABLE naming the source', () => {
    let caught: unknown;
    try {
      assertImageDecodes(bytes(CORRUPT_PNG), 'images/logo.png');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe(ASSET_UNREADABLE);
    expect((caught as Error & { source: string }).source).toBe(
      'images/logo.png'
    );
    expect((caught as Error).message).toMatch(
      /images\/logo\.png: PNG IHDR chunk fails its CRC check/
    );
  });

  it('returns quietly for a good image', () => {
    expect(() =>
      assertImageDecodes(bytes(VALID_PNG), 'logo.png')
    ).not.toThrow();
  });
});
