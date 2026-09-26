import { describe, expect, it } from 'vitest';
import { formatTs, isDisposed } from './format';

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

describe('isDisposed', () => {
  it('treats DISPOSED and the legacy REMOVED value alike, nothing else', () => {
    expect(isDisposed('DISPOSED')).toBe(true);
    expect(isDisposed('REMOVED')).toBe(true);
    expect(isDisposed('ACTIVE')).toBe(false);
    expect(isDisposed(undefined)).toBe(false);
  });
});
