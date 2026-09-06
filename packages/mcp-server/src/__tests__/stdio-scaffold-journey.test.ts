/**
 * #339's acceptance, over a real stdio transport.
 *
 * The scaffold lifecycle as an agent meets it: the resources that describe
 * what can be scaffolded, one call that opens a draft workspace with a fill
 * map, validation that calls the draft a draft, generation that refuses it by
 * pointer, a conditional patch that fills every pointer, a stale one that is
 * refused and recovered from, the same document generation-ready and
 * generated — and, after the agent loses its handle, the way back through
 * `jto_workspace_list`.
 *
 * Written to know as little as it can: no pointer is spelled here, every one
 * comes out of the fill map or a diagnostic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { BlueprintFillEntry } from '@json-to-office/shared';

import { contentFor } from './fixtures/scaffold.js';
import {
  callTool,
  openSession,
  type StdioSession,
} from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 120_000;

let session: StdioSession;
let handle: string;
let fillMap: BlueprintFillEntry[];

async function readJson(uri: string): Promise<any> {
  const read = await session.client.readResource({ uri });
  const [entry] = read.contents as [{ text?: string }];
  return JSON.parse(entry.text ?? '');
}

beforeAll(async () => {
  session = await openSession();
}, CONNECT_TIMEOUT_MS);

afterAll(async () => {
  await session?.close();
});

describe('scaffolding a client report over stdio', () => {
  it(
    'publishes the blueprints and the block references it scaffolds from, agreeing with discovery',
    async () => {
      const blueprints = await readJson('jto://blueprints');
      const docx = blueprints.formats.find((f: any) => f.format === 'docx');
      expect(docx.blueprints.map((b: any) => b.id)).toEqual(['client-report']);
      const [plan] = docx.blueprints;
      // The full plan, not the summary: variants carry their sections.
      expect(Object.keys(plan.variants)).toEqual(['data-heavy', 'narrative']);
      expect(plan.variants['data-heavy'].children.length).toBeGreaterThan(1);

      const discovered = (await callTool(session, 'jto_discover', {
        format: 'docx',
        includeStarters: false,
      })) as any;
      expect(discovered.formats[0].blueprints.map((b: any) => b.id)).toEqual([
        'client-report',
      ]);
      expect(JSON.stringify(discovered.formats[0].blueprints)).not.toContain(
        '"children"'
      );

      const blocks = await readJson('jto://blocks');
      expect(blocks.purpose).toBe('authoring-reference');
      const names = new Set(blocks.blocks.map((b: any) => b.name));
      for (const block of ['cover', 'section-opener', 'running-head'])
        expect(names.has(block), block).toBe(true);
    },
    STEP_TIMEOUT_MS
  );

  it(
    'opens a draft workspace at revision 1 with a fill map that resolves there',
    async () => {
      const out = (await callTool(session, 'jto_scaffold', {
        blueprint: 'client-report',
        variant: 'narrative',
        brief: { client: 'Acme Holdings', confidentiality: 'Confidential' },
      })) as any;
      expect(out.ok).toBe(true);
      expect(out.workspace.revision).toBe(1);
      expect(out.blueprint).toMatchObject({
        id: 'client-report',
        variant: 'narrative',
        profile: 'client-report',
      });
      expect(out.filled).toBeGreaterThan(0);
      handle = out.workspace.handle;
      fillMap = out.fillMap;
      expect(fillMap.length).toBeGreaterThan(20);

      const inspected = (await callTool(session, 'jto_workspace_inspect', {
        handle,
        paths: fillMap.map((entry) => entry.path),
      })) as any;
      expect(inspected.missingPaths).toEqual([]);
      for (const entry of fillMap)
        expect(inspected.projection[entry.path], entry.path).toBe(entry.marker);
    },
    STEP_TIMEOUT_MS
  );

  it(
    'validates as a draft — markers advisory, not generation-ready — and is refused by generation at every marker',
    async () => {
      const validated = (await callTool(session, 'jto_validate', {
        format: 'docx',
        handle,
      })) as any;
      expect(validated.ok).toBe(true);
      expect(validated.generationReady).toBe(false);
      expect(validated.scaffoldMarkers).toBe(fillMap.length);
      expect(validated.profileId).toBe('client-report');
      expect(new Set(validated.diagnostics.map((d: any) => d.code))).toEqual(
        new Set(['W_QUALITY_SCAFFOLD_MARKER'])
      );

      const refused = (await callTool(session, 'jto_generate', {
        format: 'docx',
        handle,
      })) as any;
      expect(refused.ok).toBe(false);
      expect(refused.artifact).toBeUndefined();
      const addressed = new Set<string>(
        refused.diagnostics.flatMap((d: any) => [
          d.path,
          ...((d.context?.paths ?? []) as string[]).slice(1),
        ])
      );
      expect(addressed).toEqual(new Set(fillMap.map((entry) => entry.path)));
      for (const d of refused.diagnostics)
        expect(d.code).toBe('E_SCAFFOLD_MARKER');
    },
    STEP_TIMEOUT_MS
  );

  it(
    'fills every pointer with one conditional patch, refuses the stale one, and recovers from it',
    async () => {
      const operations = fillMap.map((entry) => ({
        op: 'replace',
        path: entry.path,
        value: contentFor(entry),
      }));
      const patched = (await callTool(session, 'jto_workspace_patch', {
        handle,
        baseRevision: 1,
        operations,
      })) as any;
      expect(patched.ok).toBe(true);
      expect(patched.workspace.revision).toBe(2);

      const stale = (await callTool(session, 'jto_workspace_patch', {
        handle,
        baseRevision: 1,
        operations,
      })) as any;
      expect(stale.ok).toBe(false);
      expect(stale.diagnostics[0].code).toBe('E_STALE_REVISION');

      const pinned = (await callTool(session, 'jto_workspace_inspect', {
        handle,
        revision: 1,
        paths: [fillMap[0].path],
      })) as any;
      expect(pinned.ok).toBe(false);
      expect(pinned.diagnostics[0].code).toBe('E_STALE_REVISION');

      // Recovery is a read of where the document actually is, then a write
      // conditioned on that — and the fill-map pointer still addresses the
      // same slot at the new revision.
      const current = (await callTool(session, 'jto_workspace_inspect', {
        handle,
        paths: [fillMap[0].path],
      })) as any;
      expect(current.workspace.revision).toBe(2);
      expect(current.projection[fillMap[0].path]).toBe(contentFor(fillMap[0]));
      const recovered = (await callTool(session, 'jto_workspace_patch', {
        handle,
        baseRevision: current.workspace.revision,
        operations: [
          { op: 'test', path: fillMap[0].path, value: contentFor(fillMap[0]) },
          { op: 'replace', path: fillMap[0].path, value: 'Recovered.' },
        ],
      })) as any;
      expect(recovered.ok).toBe(true);
      expect(recovered.workspace.revision).toBe(3);
    },
    STEP_TIMEOUT_MS
  );

  it(
    'is generation-ready with no marker left, and generates',
    async () => {
      const ready = (await callTool(session, 'jto_validate', {
        format: 'docx',
        handle,
      })) as any;
      expect(ready.ok).toBe(true);
      expect(ready.generationReady).toBe(true);
      expect(ready.scaffoldMarkers).toBe(0);
      expect(
        ready.diagnostics.filter((d: any) => d.severity !== 'info')
      ).toEqual([]);

      const generated = (await callTool(session, 'jto_generate', {
        format: 'docx',
        handle,
      })) as any;
      expect(generated.ok).toBe(true);
      expect(generated.artifact.path).toMatch(/\.docx$/);
      expect(generated.source).toEqual({
        origin: 'workspace',
        handle,
        revision: 3,
      });
    },
    STEP_TIMEOUT_MS
  );

  it(
    'hands the handle back to an agent that lost it',
    async () => {
      const listed = (await callTool(session, 'jto_workspace_list', {})) as any;
      const found = listed.workspaces.find((w: any) => w.handle === handle);
      expect(found).toMatchObject({ format: 'docx', revision: 3 });

      const closed = (await callTool(session, 'jto_workspace_close', {
        handle,
      })) as any;
      expect(closed.closed).toBe(true);
      const gone = (await callTool(session, 'jto_validate', {
        format: 'docx',
        handle,
      })) as any;
      expect(gone.ok).toBe(false);
      expect(gone.diagnostics[0].code).toBe('E_UNKNOWN_HANDLE');
    },
    STEP_TIMEOUT_MS
  );
});
