import { describe, it, expect } from 'vitest';
import { isStaleQualityTicket, nextQualityTicket } from '../quality-sequence';
import type { QualityState } from '../../store/output-store';

const state = (seq: number): QualityState => ({
  findings: [],
  counts: { error: 0, warning: 0, info: 0 },
  documentName: 'report.docx.json',
  seq,
  source: 'validate',
  analyzedAt: 0,
});

describe('quality ordering tickets', () => {
  it('hands out strictly increasing tickets', () => {
    const a = nextQualityTicket();
    const b = nextQualityTicket();
    expect(b).toBeGreaterThan(a);
  });

  it('rejects a result older than what is already committed', () => {
    const slow = nextQualityTicket();
    const fast = nextQualityTicket();
    // The fast analysis landed first; the slow build resolving afterwards must
    // not reinstate findings for text the editor no longer holds.
    expect(isStaleQualityTicket(state(fast), slow)).toBe(true);
    expect(isStaleQualityTicket(state(slow), fast)).toBe(false);
  });

  it('treats an empty slice as nothing to be stale against', () => {
    expect(isStaleQualityTicket(null, nextQualityTicket())).toBe(false);
    expect(isStaleQualityTicket(undefined, nextQualityTicket())).toBe(false);
  });

  it('lets a result replace one of its own ticket', () => {
    const ticket = nextQualityTicket();
    expect(isStaleQualityTicket(state(ticket), ticket)).toBe(false);
  });
});
