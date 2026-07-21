import { describe, expect, it } from 'vitest';
import { activityLine, activityTone } from './activity';

describe('activityLine (M25b audit log)', () => {
  it('renders participant lifecycle with target + role detail', () => {
    expect(activityLine({ type: 'PARTICIPANT_ADDED', ts: 't', actor: 'lena', target: 'ivy', detail: { roleInCase: 'contributor' } }))
      .toBe('lena added ivy as contributor');
    expect(activityLine({ type: 'PARTICIPANT_ROLE_CHANGED', ts: 't', actor: 'lena', target: 'ivy', detail: { from: 'viewer', to: 'contributor' } }))
      .toBe("lena changed ivy's role: viewer → contributor");
    expect(activityLine({ type: 'PARTICIPANT_REMOVED', ts: 't', actor: 'root', target: 'ivy' }))
      .toBe('root removed ivy from the team');
  });

  it('renders category and evidence management events', () => {
    expect(activityLine({ type: 'CATEGORY_DELETED', ts: 't', actor: 'lena', detail: { name: 'Zip' } }))
      .toBe('lena deleted category "Zip"');
    expect(activityLine({ type: 'FLAG_CHANGED', ts: 't', actor: 'ivy', detail: { from: null, to: 'PROCESSED' } }))
      .toBe('ivy flagged evidence: PROCESSED');
    expect(activityLine({ type: 'FLAG_CHANGED', ts: 't', actor: 'ivy', detail: { from: 'PROCESSED', to: null } }))
      .toBe('ivy cleared the evidence flag');
    expect(activityLine({ type: 'EVIDENCE_DETAILS_UPDATED', ts: 't', actor: 'ivy', detail: { fields: ['label', 'seizedAt'] } }))
      .toBe('ivy updated evidence details (label, seizedAt)');
  });

  it('never drops an unknown type and defaults the actor', () => {
    expect(activityLine({ type: 'SOMETHING_NEW', ts: 't' })).toBe('someone: SOMETHING_NEW');
    expect(activityTone({ type: 'SOMETHING_NEW', ts: 't' })).toBe('accent');
  });
});
