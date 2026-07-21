import { describe, expect, it } from 'vitest';
import { formatDate, formatTs } from './format';

describe('formatTs', () => {
  it('renders a fixed UTC datetime', () => {
    expect(formatTs('2026-07-21T08:02:54.455Z')).toBe('2026-07-21 08:02:54 UTC');
  });
  it('is timezone-stable regardless of the offset in the input', () => {
    // 09:30+01:00 == 08:30 UTC
    expect(formatTs('2026-07-15T09:30:00+01:00')).toBe('2026-07-15 08:30:00 UTC');
  });
  it('returns an em dash for empty input', () => {
    expect(formatTs(null)).toBe('—');
    expect(formatTs(undefined)).toBe('—');
    expect(formatTs('')).toBe('—');
  });
  it('falls back to the raw value for unparseable input (never throws)', () => {
    expect(formatTs('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDate', () => {
  it('renders a UTC date only', () => {
    expect(formatDate('2026-07-21T23:59:59.999Z')).toBe('2026-07-21');
  });
});
