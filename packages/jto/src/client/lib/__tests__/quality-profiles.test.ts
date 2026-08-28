import { describe, it, expect, vi } from 'vitest';

// The module reads FORMAT at import time, so the format has to be fixed before
// the import rather than after it.
vi.mock('../env', async () => {
  const actual = await vi.importActual<typeof import('../env')>('../env');
  return { ...actual, FORMAT: 'pptx' };
});

const { buildQualityOptions, isProfileForFormat, storedProfileId } =
  await import('../quality-profiles');

describe('buildQualityOptions', () => {
  it('omits the key entirely when nothing was chosen', () => {
    expect(buildQualityOptions(undefined, 'none')).toBeUndefined();
    expect(buildQualityOptions(undefined, undefined)).toBeUndefined();
  });

  it('scopes a chosen profile to the running format', () => {
    expect(buildQualityOptions('executive-presentation', 'none')).toEqual({
      profile: { id: 'executive-presentation', formats: ['pptx'] },
    });
  });

  it('drops a profile belonging to the other format', () => {
    // Settings persist to one localStorage key shared by both playgrounds, so
    // a docx id genuinely arrives here. Sending it would pass the server's
    // compatibility check — the client stamps the formats itself — and then
    // silently analyse on defaults while reporting the profile as active.
    expect(buildQualityOptions('executive-report', 'none')).toBeUndefined();
    expect(buildQualityOptions('legal-appendix', 'warning')).toEqual({
      policy: { gate: 'warning' },
    });
  });

  it('sends a real gate and never sends "none"', () => {
    expect(buildQualityOptions(undefined, 'warning')).toEqual({
      policy: { gate: 'warning' },
    });
    expect(buildQualityOptions(undefined, 'none')).toBeUndefined();
    expect(buildQualityOptions(undefined, 'nonsense')).toBeUndefined();
  });
});

describe('isProfileForFormat / storedProfileId', () => {
  it('accepts only ids this format ships', () => {
    expect(isProfileForFormat('technical-presentation')).toBe(true);
    expect(isProfileForFormat('technical-report')).toBe(false);
    expect(isProfileForFormat(undefined)).toBe(false);
  });

  it('reads the entry for this format and ignores the other one', () => {
    expect(
      storedProfileId({
        docx: 'executive-report',
        pptx: 'executive-presentation',
      })
    ).toBe('executive-presentation');
    // The docx playground's choice must not leak in as this format's profile.
    expect(storedProfileId({ docx: 'executive-report' })).toBeUndefined();
    expect(storedProfileId(undefined)).toBeUndefined();
  });
});
