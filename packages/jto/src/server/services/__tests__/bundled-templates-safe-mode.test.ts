import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { inlineTemplateMedia } from '../template-media-inliner';
import { assertSafeOutboundSources } from '../../security/outbound-source-policy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../client/public/templates'
);
const RENDER_YAML = path.resolve(__dirname, '../../../../../../render.yaml');

/**
 * The hosted playgrounds run OUTBOUND_SOURCE_MODE=safe, where every bundled
 * template must pass `assertSafeOutboundSources` after the sourceName ->
 * inlineTemplateMedia step (format.ts) — with only the hosts render.yaml
 * actually allowlists. The vermilion template shipped `kind:'file'` font
 * sources that 400'd every remote generation because nothing asserted this.
 */
function productionAllowlist(): string[] {
  const yaml = fs.readFileSync(RENDER_YAML, 'utf8');
  const values = [
    ...yaml.matchAll(
      /key:\s*OUTBOUND_HOST_ALLOWLIST\s*\n\s*value:\s*'?([^'\n]+)'?/g
    ),
  ].map((m) => m[1].trim());
  expect(values.length).toBeGreaterThan(0);
  // Every service must agree, or a template could pass on one deployment and
  // 400 on another.
  expect(new Set(values).size).toBe(1);
  return values[0].split(',').map((h) => h.trim());
}

const POLICY = { mode: 'safe' as const, allowedHosts: productionAllowlist() };

const templateFiles = fs
  .readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith('.docx.json') || f.endsWith('.pptx.json'))
  .sort();

describe('bundled playground templates in safe mode', () => {
  it('ships at least the known stock templates', () => {
    expect(templateFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(templateFiles)(
    '%s survives inlining + safe-mode source validation',
    async (file) => {
      const json = JSON.parse(
        fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8')
      );
      const inlined = await inlineTemplateMedia(json, TEMPLATE_DIR);
      expect(() =>
        assertSafeOutboundSources(inlined, POLICY, 'jsonDefinition')
      ).not.toThrow();
    }
  );

  it('the vermilion fonts are what the inlining step neutralizes', async () => {
    // Guards against this suite going vacuous: the raw template must actually
    // trip the policy, and inlining must be the thing that fixes it.
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(TEMPLATE_DIR, 'vermilion-annual-report.docx.json'),
        'utf8'
      )
    );
    expect(() =>
      assertSafeOutboundSources(raw, POLICY, 'jsonDefinition')
    ).toThrow(/local file sources are disabled/);

    const inlined = (await inlineTemplateMedia(raw, TEMPLATE_DIR)) as {
      props: { fontRegistry: { sources: { kind: string }[] }[] };
    };
    for (const entry of inlined.props.fontRegistry) {
      for (const source of entry.sources) {
        expect(source.kind).not.toBe('file');
      }
    }
  });
});
