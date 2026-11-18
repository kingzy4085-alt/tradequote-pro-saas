import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_DAYS, dayDiff, daysAgo, followUpMailto, followUpsDue, lastFollowedUp, quoteHealth, winRateSince, withFollowUpNote } from '@/lib/followups';
import type { PipelineCard } from '@/lib/pipeline';

const TODAY = '2026-11-11';
const card = (over: Partial<PipelineCard>): PipelineCard => ({ id: '1', kind: 'proposals', title: 'Panel upgrade', client: 'Cargill', amount: 1000, status: 'Sent', date: null, updated_at: '2026-11-01T15:00:00Z', ...over });

describe('dates', () => {
  it('counts whole days between dates and timestamps without drifting across a year end or leap day', () => {
    expect(dayDiff('2026-11-01', TODAY)).toBe(10);
    expect(dayDiff('2026-11-01T23:59:59Z', TODAY)).toBe(10);
    expect(dayDiff('2027-12-31', '2028-03-01')).toBe(61);
    expect(dayDiff(TODAY, '2026-11-01')).toBe(-10);
    expect(dayDiff(null, TODAY)).toBeNull();
    expect(dayDiff('not a date', TODAY)).toBeNull();
    expect(daysAgo('2027-01-02', 5)).toBe('2026-12-28');
  });
});

describe('follow-ups due', () => {
  it('lists sent quotes waiting the full period, longest first, and nothing else', () => {
    const due = followUpsDue(
      [
        card({ id: 'fresh', updated_at: daysAgo(TODAY, FOLLOW_UP_DAYS - 1) }),
        card({ id: 'edge', updated_at: daysAgo(TODAY, FOLLOW_UP_DAYS) }),
        card({ id: 'old', updated_at: daysAgo(TODAY, 20) }),
        card({ id: 'draft', status: 'Draft', updated_at: daysAgo(TODAY, 30) }),
        card({ id: 'won', status: 'Accepted', updated_at: daysAgo(TODAY, 30) }),
        card({ id: 'est', kind: 'estimates', status: 'Submitted', updated_at: daysAgo(TODAY, 9) }),
      ],
      TODAY
    );
    expect(due.map((f) => f.card.id)).toEqual(['old', 'est', 'edge']);
    expect(due[0].daysWaiting).toBe(20);
  });

  it('a quote chased recently drops off until the period passes again', () => {
    const waiting = { updated_at: daysAgo(TODAY, 30) };
    expect(followUpsDue([card({ ...waiting, notes: `Followed up ${daysAgo(TODAY, 2)}\nCalled Dana` })], TODAY)).toEqual([]);
    const again = followUpsDue([card({ ...waiting, notes: `Followed up ${daysAgo(TODAY, FOLLOW_UP_DAYS)}` })], TODAY);
    expect(again).toHaveLength(1);
    expect(again[0].lastFollowedUp).toBe(daysAgo(TODAY, FOLLOW_UP_DAYS));
  });

  it('reads the latest follow-up date from the notes and ignores look-alikes', () => {
    expect(lastFollowedUp(null)).toBeNull();
    expect(lastFollowedUp('Client asked if we followed up 2026-01-01')).toBeNull();
    expect(lastFollowedUp('Followed up 2026-10-01\r\nFollowed up 2026-11-03\nFollowed up 2026-13-99x')).toBe('2026-11-03');
  });

  it('writes the follow-up as the first line and keeps what was there', () => {
    expect(withFollowUpNote('', TODAY)).toBe(`Followed up ${TODAY}`);
    expect(withFollowUpNote('  Wants a revised price  ', TODAY)).toBe(`Followed up ${TODAY}\nWants a revised price`);
    expect(lastFollowedUp(withFollowUpNote('Followed up 2026-10-01', TODAY))).toBe(TODAY);
    expect(withFollowUpNote('x'.repeat(20_000), TODAY).length).toBeLessThanOrEqual(10_000);
  });
});

describe('quote health', () => {
  it('only rates quotes that are out with a client', () => {
    expect(quoteHealth(card({ status: 'Draft' }), TODAY)).toBeNull();
    expect(quoteHealth(card({ status: 'Accepted' }), TODAY)).toBeNull();
  });

  it('is hot when fresh or about to expire, warm when waiting, cold when stale or expired', () => {
    expect(quoteHealth(card({ updated_at: daysAgo(TODAY, 1) }), TODAY)?.label).toBe('Hot');
    expect(quoteHealth(card({ updated_at: daysAgo(TODAY, 7) }), TODAY)?.label).toBe('Warm');
    expect(quoteHealth(card({ updated_at: daysAgo(TODAY, 7), date: '2026-11-13' }), TODAY)?.label).toBe('Hot');
    expect(quoteHealth(card({ updated_at: daysAgo(TODAY, 14) }), TODAY)?.label).toBe('Cold');
    expect(quoteHealth(card({ updated_at: daysAgo(TODAY, 1), date: '2026-11-10' }), TODAY)).toMatchObject({ label: 'Cold', reason: expect.stringContaining('has passed') });
  });

  it('always says why in words', () => {
    for (const days of [0, 1, 6, 30]) expect(quoteHealth(card({ updated_at: daysAgo(TODAY, days) }), TODAY)!.reason).toMatch(/^Sent /);
  });
});

describe('follow-up email link', () => {
  it('writes a polite email to a real address, and nothing for a bad one', () => {
    const href = followUpMailto(card({}), ' dana@cargill.example ', 'Alpha Electric')!;
    expect(href.startsWith('mailto:dana@cargill.example?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('Following up: Panel upgrade');
    expect(decodeURIComponent(href)).toContain('Alpha Electric');
    expect(followUpMailto(card({}), null, 'Alpha')).toBeNull();
    expect(followUpMailto(card({}), 'not an email', 'Alpha')).toBeNull();
  });

  it('cannot be turned into extra recipients or headers by what is typed in the client record', () => {
    expect(followUpMailto(card({}), 'a@b.ca,evil@x.ca', 'Alpha')).toBeNull();
    expect(followUpMailto(card({}), 'a@b.ca?bcc=evil@x.ca', 'Alpha')).toBeNull();
    const href = followUpMailto(card({ title: 'Job&bcc=evil@x.ca' }), 'a@b.ca', 'Alpha')!;
    expect(href.split('?')[1].split('&').map((p) => p.split('=')[0])).toEqual(['subject', 'body']);
  });
});

describe('win rate', () => {
  it('counts only quotes decided since the date, and is unknown when none were', () => {
    const rows = [
      { kind: 'proposals' as const, status: 'Accepted', updated_at: '2026-10-20T00:00:00Z' },
      { kind: 'estimates' as const, status: 'Lost', updated_at: '2026-10-25T00:00:00Z' },
      { kind: 'estimates' as const, status: 'Won', updated_at: '2026-11-01T00:00:00Z' },
      { kind: 'proposals' as const, status: 'Declined', updated_at: '2026-01-01T00:00:00Z' },
      { kind: 'proposals' as const, status: 'Sent', updated_at: '2026-11-05T00:00:00Z' },
    ];
    expect(winRateSince(rows, '2026-10-01')).toEqual({ rate: 67, won: 2, decided: 3 });
    expect(winRateSince(rows, '2026-12-01')).toEqual({ rate: null, won: 0, decided: 0 });
  });
});
