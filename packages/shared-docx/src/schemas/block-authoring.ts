import { createBlockAuthoringSchema } from '@json-to-office/shared';
import { docxComponentDefinitionName, DOCX_RENDERER_IDS } from './renderer';

type Schema = Record<string, any>;

/** Enrich every DOCX root in the exported schema, including plugin profiles. */
export function addDocxBlockAuthoringSchemas(schema: Schema): void {
  const definitions = schema.definitions ?? {};
  const bodies = new Map<string, Schema>();
  for (const renderer of DOCX_RENDERER_IDS) {
    const name = docxComponentDefinitionName(renderer);
    if (definitions[name])
      bodies.set(
        renderer,
        createBlockAuthoringSchema(definitions, name, ['docx', 'section'])
      );
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const value = node as Schema;
    if (value.properties?.name?.const === 'docx') {
      const body = bodies.get(value.properties.renderer?.const);
      const blocks =
        value.properties.props?.properties?.blocks?.patternProperties;
      if (body && blocks)
        for (const block of Object.values(blocks) as Schema[]) {
          block.properties.body.items = body;
          for (const part of ['header', 'footer'])
            block.properties.section.properties[part].items = body;
        }
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
}
