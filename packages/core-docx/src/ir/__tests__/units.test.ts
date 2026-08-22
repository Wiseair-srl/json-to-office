import { describe, expect, it } from 'vitest';
import {
  blockId,
  headerFooterBlockId,
  inchesToTwips,
  irColor,
  pixelsToEmu,
  pixelsToTwips,
  pointsToEighthPoints,
  pointsToHalfPoints,
  pointsToTwips,
  resolveLengthTwips,
  sha256Hex,
  twipsToEmu,
  twipsToPixels,
} from '../units';

describe('unit conversions', () => {
  it('converts points to twips', () => {
    expect(pointsToTwips(12)).toBe(240);
    expect(pointsToTwips(0)).toBe(0);
    expect(pointsToTwips(0.5)).toBe(10);
  });

  it('converts points to half-points', () => {
    expect(pointsToHalfPoints(11)).toBe(22);
    expect(pointsToHalfPoints(10.5)).toBe(21);
  });

  it('converts points to eighths of a point', () => {
    expect(pointsToEighthPoints(1)).toBe(8);
    expect(pointsToEighthPoints(0.5)).toBe(4);
  });

  it('converts inches to twips', () => {
    expect(inchesToTwips(1)).toBe(1440);
    expect(inchesToTwips(0.5)).toBe(720);
  });

  it('converts twips to EMU', () => {
    expect(twipsToEmu(1440)).toBe(914400);
    expect(twipsToEmu(20)).toBe(12700);
  });

  it('converts pixels at 96 DPI', () => {
    expect(pixelsToEmu(96)).toBe(914400);
    expect(pixelsToTwips(96)).toBe(1440);
    expect(twipsToPixels(1440)).toBe(96);
  });

  it('rounds every conversion to an integer', () => {
    for (const value of [
      pointsToTwips(1.03),
      pixelsToEmu(3.7),
      twipsToEmu(7),
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('resolveLengthTwips', () => {
  it('passes a number through, rounded', () => {
    expect(resolveLengthTwips(720, 9360)).toBe(720);
    expect(resolveLengthTwips(720.4, 9360)).toBe(720);
  });

  it('resolves a percentage against the container', () => {
    expect(resolveLengthTwips('50%', 9360)).toBe(4680);
    expect(resolveLengthTwips('100%', 9360)).toBe(9360);
    expect(resolveLengthTwips('0%', 9360)).toBe(0);
  });

  it('accepts a bare numeric string', () => {
    expect(resolveLengthTwips('1440', 9360)).toBe(1440);
  });

  it('resolves an unparseable value to zero rather than throwing', () => {
    expect(resolveLengthTwips('wide', 9360)).toBe(0);
    expect(resolveLengthTwips('%', 9360)).toBe(0);
  });
});

describe('irColor', () => {
  it('normalises to bare uppercase hex', () => {
    expect(irColor('#aabbcc')).toEqual({ hex: 'AABBCC' });
    expect(irColor('AABBCC')).toEqual({ hex: 'AABBCC' });
    expect(irColor('#FFFFFF')).toEqual({ hex: 'FFFFFF' });
  });
});

describe('identity helpers', () => {
  it('hashes bytes to lowercase hex sha-256', () => {
    const hash = sha256Hex(new Uint8Array([1, 2, 3]));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(hash);
    expect(sha256Hex(new Uint8Array([3, 2, 1]))).not.toBe(hash);
  });

  it('derives block ids from position, not a counter', () => {
    expect(blockId(0, [3])).toBe('s0.b3');
    expect(blockId(1, [0, 2, 1])).toBe('s1.b0.b2.b1');
    // Same position, same id — which is what makes concurrent generations agree.
    expect(blockId(0, [3])).toBe(blockId(0, [3]));
  });

  it('derives header and footer block ids from the part id', () => {
    expect(headerFooterBlockId('header:s0:default', [1])).toBe(
      'header:s0:default.b1'
    );
  });
});
