/**
 * The deep-validation walk visits the embedded-component positions declared on
 * `STANDARD_COMPONENTS_REGISTRY` entries (`embeddedComponents`). The live
 * whole-document schema wires the same positions through each entry's
 * `createPropsSchema` factory. Nothing ties the two together structurally, so
 * this test does: it probes every factory with a marker schema, records where
 * the marker lands, and asserts the declaration matches exactly.
 *
 * A factory position without a declaration is a walk blind spot (issue #292's
 * fail-open class); a declaration without a factory position is a walk over
 * ground the schema does not own. Both fail here.
 */
import { describe, it, expect } from 'vitest';
import { Type, type TSchema } from '@sinclair/typebox';
import { STANDARD_COMPONENTS_REGISTRY } from '../schemas/component-registry';

/** A discovered embedding position: where the marker landed in the factory. */
interface DiscoveredRegion {
  path: readonly string[];
  arity: 'component' | 'component-array';
}

const MARKER = Type.Object({}, { $id: '__embedded_component_marker__' });

/**
 * Walk a props schema for the marker, recording each position. `*` stands for
 * every element of an array. A marker directly under an array's `items` is the
 * array-of-components arity, anchored at the array itself.
 */
function discoverRegions(schema: TSchema): DiscoveredRegion[] {
  const found: DiscoveredRegion[] = [];
  const seen = new Set<TSchema>();

  const visit = (node: TSchema, path: readonly string[]): void => {
    if (!node || typeof node !== 'object') return;
    if (node === MARKER) {
      found.push({ path, arity: 'component' });
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    const union = (node as { anyOf?: TSchema[] }).anyOf;
    if (Array.isArray(union)) {
      for (const branch of union) visit(branch, path);
    }

    const items = (node as { items?: TSchema }).items;
    if (items) {
      if (items === MARKER) {
        found.push({ path, arity: 'component-array' });
      } else {
        visit(items, [...path, '*']);
      }
    }

    const properties = (node as { properties?: Record<string, TSchema> })
      .properties;
    if (properties) {
      for (const [key, child] of Object.entries(properties)) {
        visit(child, [...path, key]);
      }
    }
  };

  visit(schema, []);
  return found;
}

const sortKey = (r: DiscoveredRegion) => r.path.join('/');

describe('embeddedComponents declarations match the live schema factories', () => {
  it.each(STANDARD_COMPONENTS_REGISTRY.map((c) => [c.name, c] as const))(
    '%s',
    (_name, component) => {
      const discovered = component.createPropsSchema
        ? discoverRegions(component.createPropsSchema(MARKER))
        : [];

      const declared = (component.embeddedComponents ?? []).map((r) => ({
        path: r.path,
        arity: r.arity,
      }));

      expect(
        [...declared].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      ).toEqual(
        [...discovered].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      );
    }
  );

  it('covers the two factories that exist today (sanity)', () => {
    const withFactories = STANDARD_COMPONENTS_REGISTRY.filter(
      (c) => c.createPropsSchema
    ).map((c) => c.name);
    expect(withFactories.sort()).toEqual(['section', 'table']);
  });
});
