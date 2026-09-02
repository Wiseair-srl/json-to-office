import { describe, expect, it } from 'vitest';
import type { TextFile } from '../types';
import { getDocumentFormSchema, isNewDocumentName } from '../validation';
import { pluginDocumentName } from '../../store/documents-store';

const file = (name: string) => ({ name }) as unknown as TextFile;

function validate(
  mode: 'create' | 'update',
  name: string,
  documents: ReturnType<typeof file>[],
  {
    plugin = false,
    selectedName,
  }: { plugin?: boolean; selectedName?: string } = {}
) {
  return getDocumentFormSchema(
    mode,
    (v) => isNewDocumentName(v, documents, selectedName),
    undefined,
    plugin ? pluginDocumentName : undefined
  ).validate({ name });
}

describe('document form name validation', () => {
  const documents = [file('kpi.component.ts'), file('report.docx.json')];

  it('rejects a plugin name that collides once its suffix is added', () => {
    // `kpi` is stored as `kpi.component.ts`, which is taken.
    const result = validate('create', 'kpi', documents, { plugin: true });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({
      path: 'name',
      message: 'Document with this name already exists',
    });
  });

  it('accepts a plugin name that is free after normalization', () => {
    expect(
      validate('create', 'tile', documents, { plugin: true }).success
    ).toBe(true);
  });

  it('lets a rename keep the file its own normalized name', () => {
    expect(
      validate('update', 'kpi', documents, {
        plugin: true,
        selectedName: 'kpi.component.ts',
      }).success
    ).toBe(true);
  });

  it('leaves non-plugin names alone', () => {
    expect(validate('create', 'kpi', documents).success).toBe(true);
  });
});
