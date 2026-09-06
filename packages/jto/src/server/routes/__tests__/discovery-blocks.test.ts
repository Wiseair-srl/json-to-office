/**
 * `/discovery/blocks` is the reference catalog the playground's editor
 * completes and inserts from: every block definition of every discovered
 * document of the running format, with a working invocation and the
 * definitions it depends on. Two things must hold for an inserted snippet to
 * leave nothing unresolved: the example agrees with its definition, and the
 * definition plus its dependencies validate on their own in a fresh document.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { discoveryRouter } from '../discovery';
import { Container } from '../../container';
import { DocxFormatAdapter, PptxFormatAdapter } from '@json-to-office/jto-cli';
import type { BlockReference } from '@json-to-office/shared';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { validateDocument } from '@json-to-office/shared-docx';

// Discovery resolves the workspace root from cwd, so the shipped playground
// templates under packages/jto/src/client/public/templates are found.

async function catalog(
  adapter: DocxFormatAdapter | PptxFormatAdapter
): Promise<BlockReference[]> {
  Container.initialize(adapter);
  const app = new Hono();
  app.route('/discovery', discoveryRouter as any);
  const res = await app.request('/discovery/blocks');
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    success: boolean;
    data: BlockReference[];
  };
  expect(body.success).toBe(true);
  return body.data;
}

/** The definition and its dependencies, as the editor inserts them. */
function definitionsFor(reference: BlockReference, all: BlockReference[]) {
  return Object.fromEntries(
    [...reference.dependencies, reference.name].map((name) => [
      name,
      all.find(
        (entry) => entry.template === reference.template && entry.name === name
      )!.definition,
    ])
  );
}

describe('/api/discovery/blocks', () => {
  describe('pptx', () => {
    let references: BlockReference[] = [];
    beforeAll(async () => {
      references = await catalog(new PptxFormatAdapter());
    });

    it('lists the shipped deck’s action-chart with its own invocation', () => {
      const actionChart = references.find(
        (entry) =>
          entry.name === 'action-chart' &&
          entry.template === 'consulting-deck-blocks'
      )!;
      expect(actionChart).toBeDefined();
      expect(actionChart.format).toBe('pptx');
      expect(actionChart.definitionPointer).toBe('/props/blocks/action-chart');
      expect(actionChart.description).toContain('action title');
      expect(actionChart.example.props.slots?.title).toContain('Revenue');
      expect(actionChart.dependencies).toEqual([]);
      expect(Object.keys(actionChart.slotsSchema.properties as object)).toEqual(
        ['title', 'tracker', 'chart', 'takeaway', 'source']
      );
    });

    it('covers every block of every shipped deck, and each snippet validates on its own', () => {
      const shipped = references.filter((entry) =>
        [
          'consulting-deck-blocks',
          'data-report-presentation',
          'management-plan',
          'minimalist-pitch-deck',
        ].includes(entry.template)
      );
      expect(shipped.map((entry) => entry.name)).toEqual(
        expect.arrayContaining([
          'action-chart',
          'chrome-ink',
          'chrome-paper',
          'grid',
          'veil-bottom-right',
        ])
      );
      for (const reference of shipped) {
        const document = {
          name: 'pptx',
          props: {
            slideWidth: 13.333,
            slideHeight: 7.5,
            blocks: definitionsFor(reference, references),
          },
          children: [{ name: 'slide', children: [reference.example] }],
        };
        expect(
          validatePresentationDocument(document).errors,
          `${reference.template}/${reference.name}`
        ).toEqual([]);
      }
    });
  });

  describe('docx', () => {
    it('serves the report blocks with section effects placed where they validate', async () => {
      const references = await catalog(new DocxFormatAdapter());
      const cover = references.find(
        (entry) =>
          entry.name === 'cover' && entry.template === 'client-report-blocks'
      )!;
      expect(cover).toBeDefined();
      expect(cover.format).toBe('docx');
      const document = {
        name: 'docx',
        props: { blocks: definitionsFor(cover, references) },
        children: [{ name: 'section', children: [cover.example] }],
      };
      expect(validateDocument(document).errors).toEqual([]);
    });
  });
});
