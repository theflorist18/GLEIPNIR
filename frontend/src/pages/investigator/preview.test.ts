import { describe, expect, it } from 'vitest';
import { previewKind } from './EvidenceDetailPage';

describe('previewKind', () => {
  it('maps the simple file types to their renderer', () => {
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('image/jpeg')).toBe('image');
    expect(previewKind('video/mp4')).toBe('video');
    expect(previewKind('audio/mpeg')).toBe('audio');
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('text/plain')).toBe('text');
    expect(previewKind('text/csv')).toBe('text');
    expect(previewKind('application/json')).toBe('text');
  });

  it('refuses everything else — no renderer means download-only', () => {
    expect(previewKind('application/octet-stream')).toBeNull();
    expect(previewKind('application/zip')).toBeNull();
    expect(previewKind(null)).toBeNull();
    expect(previewKind(undefined)).toBeNull();
    expect(previewKind('')).toBeNull();
  });
});
