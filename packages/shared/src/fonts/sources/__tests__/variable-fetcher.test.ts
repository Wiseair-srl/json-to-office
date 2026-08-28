import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fetchVariableFontSource } from '../variable-fetcher';

const FIXTURE = path.resolve(
  __dirname,
  '../../../../../core-docx/src/styles/fonts/life-sans/LifeSans-Medium.ttf'
);

function fetcherReturning(body: Buffer): typeof fetch {
  return (async () =>
    new Response(new Uint8Array(body), { status: 200 })) as typeof fetch;
}

describe('fetchVariableFontSource format gate', () => {
  it('rejects unknown formats before instancing', async () => {
    const junk = Buffer.alloc(2048, 7);
    const res = await fetchVariableFontSource({
      url: 'https://cdn.jsdelivr.net/gh/probe/junk.bin',
      weight: 700,
      italic: false,
      familyLabel: 'Probe',
      fetcher: fetcherReturning(junk),
    });
    expect(res.source).toBeUndefined();
    expect(res.warnings?.[0]).toMatch(/unexpected font format: unknown/);
  });

  it('rejects disallowed hosts', async () => {
    const res = await fetchVariableFontSource({
      url: 'https://evil.example.com/font.ttf',
      weight: 400,
      italic: false,
      familyLabel: 'Probe',
      fetcher: fetcherReturning(Buffer.alloc(2048)),
    });
    expect(res.source).toBeUndefined();
    expect(res.warnings?.[0]).toMatch(/allowlist/);
  });

  it('lets woff2 sources through to the instancer', async () => {
    // Garbage with a wOF2 magic: must clear the format gate (rsms/inter
    // ships its italic variable master only as woff2) and fail later, at
    // decompression/instancing — not with a format rejection.
    const woff2Garbage = Buffer.concat([
      Buffer.from('wOF2'),
      Buffer.alloc(2048, 7),
    ]);
    const res = await fetchVariableFontSource({
      url: 'https://cdn.jsdelivr.net/gh/probe/garbage.woff2',
      weight: 700,
      italic: true,
      familyLabel: 'Probe',
      fetcher: fetcherReturning(woff2Garbage),
    });
    expect(res.source).toBeUndefined();
    expect(res.warnings?.[0]).toMatch(/instancing/);
    expect(res.warnings?.[0]).not.toMatch(/unexpected font format/);
  });

  it('lets ttf sources through to the instancer', async () => {
    // A real static TTF clears the gate; pinning `wght` on a font with no
    // fvar then fails at the instancing stage with a warning, not a throw.
    const staticTtf = readFileSync(FIXTURE);
    const res = await fetchVariableFontSource({
      url: 'https://cdn.jsdelivr.net/gh/probe/static.ttf',
      weight: 700,
      italic: false,
      familyLabel: 'Probe',
      fetcher: fetcherReturning(staticTtf),
    });
    expect(res.source).toBeUndefined();
    expect(res.warnings?.[0]).toMatch(/instancing/);
  });
});
