import { describe, it, expect, vi } from 'vitest';
import { resolveGridPosition, resolveComponentGridPosition, DEFAULT_GRID_CONFIG } from './grid';

describe('resolveGridPosition', () => {
  const slideW = 10;
  const slideH = 7.5;

  it('resolves top-left cell with defaults', () => {
    const result = resolveGridPosition(
      { column: 0, row: 0 },
      undefined,
      slideW,
      slideH
    );
    // availableW = 10 - 0.5 - 0.5 = 9.0
    // availableH = 7.5 - 0.5 - 0.5 = 6.5
    // trackW = (9.0 - 11*0.2) / 12 = (9.0 - 2.2) / 12 = 6.8/12 ≈ 0.5667
    // trackH = (6.5 - 5*0.2) / 6 = (6.5 - 1.0) / 6 = 5.5/6 ≈ 0.9167
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0.5);
    expect(result.w).toBeCloseTo(6.8 / 12);
    expect(result.h).toBeCloseTo(5.5 / 6);
  });

  it('resolves full-width spanning (12 cols)', () => {
    const result = resolveGridPosition(
      { column: 0, row: 0, columnSpan: 12 },
      undefined,
      slideW,
      slideH
    );
    // w = 12 * trackW + 11 * gutter.col = 12*(6.8/12) + 11*0.2 = 6.8 + 2.2 = 9.0
    expect(result.w).toBeCloseTo(9.0);
  });

  it('resolves with custom grid config', () => {
    const config = { columns: 4, rows: 3, margin: 1, gutter: 0.5 };
    const result = resolveGridPosition(
      { column: 1, row: 1, columnSpan: 2, rowSpan: 2 },
      config,
      slideW,
      slideH
    );
    // availableW = 10 - 1 - 1 = 8
    // availableH = 7.5 - 1 - 1 = 5.5
    // trackW = (8 - 3*0.5) / 4 = 6.5/4 = 1.625
    // trackH = (5.5 - 2*0.5) / 3 = 4.5/3 = 1.5
    // x = 1 + 1*(1.625 + 0.5) = 1 + 2.125 = 3.125
    // y = 1 + 1*(1.5 + 0.5) = 1 + 2 = 3
    // w = 2*1.625 + 1*0.5 = 3.75
    // h = 2*1.5 + 1*0.5 = 3.5
    expect(result.x).toBeCloseTo(3.125);
    expect(result.y).toBeCloseTo(3);
    expect(result.w).toBeCloseTo(3.75);
    expect(result.h).toBeCloseTo(3.5);
  });

  it('resolves with per-side margin and per-axis gutter', () => {
    const config = {
      columns: 6,
      rows: 4,
      margin: { top: 0.75, right: 0.5, bottom: 0.5, left: 0.5 },
      gutter: { column: 0.3, row: 0.2 },
    };
    const result = resolveGridPosition(
      { column: 0, row: 0 },
      config,
      slideW,
      slideH
    );
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0.75);
  });

  it('clamps out-of-bounds positions', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveGridPosition(
      { column: 15, row: 10 },
      undefined,
      slideW,
      slideH
    );
    expect(warnSpy).toHaveBeenCalled();
    // Clamped to col=11, row=5 (last valid)
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});

describe('resolveComponentGridPosition', () => {
  it('passes through component without grid', () => {
    const component = { name: 'text', props: { text: 'hello', x: 1 } };
    const result = resolveComponentGridPosition(component, undefined, 10, 7.5);
    expect(result).toBe(component);
  });

  it('resolves grid and sets x/y/w/h', () => {
    const component = {
      name: 'text',
      props: { text: 'hello', grid: { column: 0, row: 0, columnSpan: 12 } },
    };
    const result = resolveComponentGridPosition(component, undefined, 10, 7.5);
    expect(result.props.grid).toBeUndefined();
    expect(result.props.x).toBeCloseTo(0.5);
    expect(result.props.y).toBeCloseTo(0.5);
    expect(result.props.w).toBeCloseTo(9.0);
  });

  it('explicit x/y/w/h override grid-computed values', () => {
    const component = {
      name: 'text',
      props: { text: 'hello', h: 2, grid: { column: 0, row: 0 } },
    };
    const result = resolveComponentGridPosition(component, undefined, 10, 7.5);
    expect(result.props.h).toBe(2); // explicit override
    expect(result.props.x).toBeCloseTo(0.5); // from grid
  });
});
