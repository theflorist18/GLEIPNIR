import { describe, expect, it } from 'vitest';
import type { CoCEvent } from '../types';
import { trailRows } from './AuditTrailTimeline';

const ev = (op: string, actor: string, action: string | null, ts: string): CoCEvent =>
  ({ op, actor, ts, eventId: `${op}-${ts}`, detail: action ? { action } : {} }) as unknown as CoCEvent;

describe('trailRows — collapsing consecutive views', () => {
  const trail = [
    ev('CREATE', 'ivy', null, '2026-09-24T08:00:00Z'),
    ev('ACCESS', 'ivy', 'view', '2026-09-24T08:01:00Z'),
    ev('ACCESS', 'ivy', 'view', '2026-09-24T08:02:00Z'),
    ev('ACCESS', 'ivy', 'view', '2026-09-24T08:03:00Z'),
    ev('ACCESS', 'lena', 'view', '2026-09-24T08:04:00Z'), // other actor: new run
    ev('ACCESS', 'lena', 'download', '2026-09-24T08:05:00Z'), // not a view: never folded
    ev('ACCESS', 'lena', 'view', '2026-09-24T08:06:00Z'),
    ev('REMOVE', 'lena', null, '2026-09-24T08:07:00Z'), // pre-M26 tag
  ];

  it('folds same-actor view runs into one row with a count and the first → last range', () => {
    const rows = trailRows(trail, true);
    expect(rows.map((r) => `${r.op}:${r.actor}:${r.detail}×${r.count}`)).toEqual([
      'CREATE:ivy:×1', 'ACCESS:ivy:view×3', 'ACCESS:lena:view×1', 'ACCESS:lena:download×1',
      'ACCESS:lena:view×1', 'DISPOSE:lena:×1',
    ]);
    expect(rows[1].firstTs).toBe('2026-09-24T08:01:00Z');
    expect(rows[1].ts).toBe('2026-09-24T08:03:00Z');
    expect(rows[5].legacy).toBe(true);
  });

  it('keeps one row per event when collapsing is off', () => {
    expect(trailRows(trail, false)).toHaveLength(trail.length);
  });
});
