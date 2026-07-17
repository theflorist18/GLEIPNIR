import { describe, expect, it } from 'vitest';
import { suggestLabel } from './IngestPage';

describe('suggestLabel', () => {
  it('starts at ITEM-001 for an empty case', () => {
    expect(suggestLabel([])).toBe('ITEM-001');
  });

  it('increments past the highest ITEM-NNN, ignoring other label formats', () => {
    expect(suggestLabel(['ITEM-001', 'ITEM-007', 'EXHIBIT-9', null, undefined, 'item-3'])).toBe('ITEM-008');
  });

  it('pads to three digits and keeps counting past 999', () => {
    expect(suggestLabel(['ITEM-099'])).toBe('ITEM-100');
    expect(suggestLabel(['ITEM-1000'])).toBe('ITEM-1001');
  });
});
