/**
 * The playground report the block tests read their definitions from, parsed
 * once; every helper hands out a copy.
 */
import { readFileSync } from 'node:fs';

export const EXAMPLE = JSON.parse(
  readFileSync(
    new URL(
      '../../../../jto/src/client/public/templates/client-report-blocks.docx.json',
      import.meta.url
    ),
    'utf8'
  )
);
export const example = () => structuredClone(EXAMPLE);
/** The example's first invocation of a block, with its real content. */
export const invocation = (ref: string) => {
  for (const section of EXAMPLE.children)
    for (const child of section.children)
      if (child.name === 'block' && child.props.ref === ref)
        return structuredClone(child);
  throw new Error(`no ${ref} invocation in the example`);
};
/** A one-section document on `theme` holding the given invocations. */
export const on = (theme: string, ...blocks: unknown[]) => {
  const doc = example();
  doc.props.theme = theme;
  doc.children = [{ name: 'section', children: blocks }];
  return doc;
};
/** An invocation of `ref` with the given slots. */
export const block = (ref: string, slots: Record<string, unknown>) => ({
  name: 'block',
  props: { ref, slots },
});
export const section = (...children: unknown[]) => ({
  name: 'section',
  children,
});
export const para = (text: string) => ({ name: 'paragraph', props: { text } });
