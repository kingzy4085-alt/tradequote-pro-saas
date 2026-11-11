import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CalendarView from '@/app/(app)/calendar/calendar-view';
import {
  CALENDAR_SOURCES,
  addDays,
  addMonths,
  calendarHref,
  dateOnly,
  isDate,
  itemsOnDay,
  monthWeeks,
  parseCalendarParams,
  rangeLabel,
  startOfWeek,
  stepDate,
  toItems,
  viewRange,
  visibleSources,
  weekDays,
  weekday,
} from '@/lib/calendar';
import { getModule } from '@/lib/modules';

const source = (key: string) => CALENDAR_SOURCES.find((s) => s.key === key)!;

describe('calendar date math', () => {
  it('accepts only real days', () => {
    expect(isDate('2026-11-11')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-2-3')).toBe(false);
    expect(isDate(undefined)).toBe(false);
    expect(dateOnly('2026-11-11T23:30:00-08:00')).toBe('2026-11-11');
    expect(dateOnly('soon')).toBeNull();
  });

  it('moves by days across month ends, leap days and clock changes without drifting', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // clocks go back
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // clocks go forward
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(weekday('2026-11-11')).toBe(3);
    expect(startOfWeek('2026-11-11')).toBe('2026-11-08');
    expect(startOfWeek('2026-11-08')).toBe('2026-11-08');
    expect(weekDays('2026-11-11')).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  });

  it('moves by months and clamps to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(stepDate('week', '2026-11-11', -1)).toBe('2026-11-04');
    expect(stepDate('month', '2026-11-11', 1)).toBe('2026-12-11');
  });

  it('lays a month out in whole weeks and bounds each view', () => {
    const weeks = monthWeeks('2026-11-11');
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks[4][6]).toBe('2026-12-05');
    expect(monthWeeks('2026-08-15')).toHaveLength(6);
    expect(monthWeeks('2026-02-10')).toHaveLength(4);
    expect(weeks.every((week) => week.length === 7 && weekday(week[0]) === 0)).toBe(true);
    expect(viewRange('month', '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-12-05' });
    expect(viewRange('week', '2026-11-11')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(rangeLabel('month', '2026-11-11')).toBe('November 2026');
    expect(rangeLabel('week', '2026-11-11')).toBe('Nov 8 to Nov 14, 2026');
    expect(rangeLabel('week', '2026-12-30')).toBe('Dec 27, 2026 to Jan 2, 2027');
  });

  it('reads the view and day from the URL and falls back safely', () => {
    expect(parseCalendarParams({}, '2026-11-11')).toEqual({ view: 'month', date: '2026-11-11' });
    expect(parseCalendarParams({ view: 'week', date: '2026-12-01' }, '2026-11-11')).toEqual({ view: 'week', date: '2026-12-01' });
    expect(parseCalendarParams({ view: 'year', date: '2026-13-01' }, '2026-11-11')).toEqual({ view: 'month', date: '2026-11-11' });
    expect(parseCalendarParams({ view: ['week', 'month'], date: ['2026-12-01'] }, '2026-11-11')).toEqual({ view: 'week', date: '2026-12-01' });
    expect(calendarHref('week', '2026-12-01')).toBe('/calendar?view=week&date=2026-12-01');
  });
});

describe('calendar items', () => {
  it('every source names a real module and real date columns', () => {
    for (const s of CALENDAR_SOURCES) {
      const mod = getModule(s.module);
      expect(mod, s.module).toBeDefined();
      const keys = mod!.fields.map((f) => f.key);
      expect(keys, `${s.module}.${s.start}`).toContain(s.start);
      if (s.end) expect(keys).toContain(s.end);
      for (const status of s.skipStatuses ?? []) expect(mod!.statuses).toContain(status);
    }
    expect(new Set(CALENDAR_SOURCES.map((s) => s.key)).size).toBe(CALENDAR_SOURCES.length);
  });

  it('shows a role only what its modules let it read', () => {
    expect(visibleSources('owner').map((s) => s.key)).toEqual(CALENDAR_SOURCES.map((s) => s.key));
    const crew = visibleSources('electrician');
    expect(crew.map((s) => s.key)).toContain('crew');
    for (const s of crew) expect(getModule(s.module)!.read).toBeLessThanOrEqual(1);
    expect(crew.map((s) => s.key)).not.toContain('invoice');
  });

  it('turns rows into linked items and spreads a booking over its days', () => {
    const crew = toItems(source('crew'), [
      { id: 'a', title: ' Crew A ', status: 'Scheduled', start_date: '2026-11-10', end_date: '2026-11-12' },
      { id: 'b', title: 'Crew B', status: 'Cancelled', start_date: '2026-11-10', end_date: '2026-11-12' },
      { id: 'c', title: '', status: 'On Site', start_date: '2026-11-11', end_date: '2026-11-01' },
      { id: 'd', title: 'No date', status: 'Scheduled', start_date: null, end_date: '2026-11-12' },
    ]);
    expect(crew.map((i) => i.key)).toEqual(['crew:a', 'crew:c']);
    expect(crew[0]).toMatchObject({ title: 'Crew A', start: '2026-11-10', end: '2026-11-12', href: '/crew-schedule' });
    expect(crew[1]).toMatchObject({ title: 'Untitled', start: '2026-11-11', end: '2026-11-11' });

    const project = { id: 'p', title: 'Mill', status: 'Active', start_date: '2026-11-11', end_date: '2026-12-20' };
    const items = [...crew, ...toItems(source('project-end'), [project]), ...toItems(source('project-start'), [project]), ...toItems(source('invoice'), [{ id: 'i', title: 'INV-1', status: 'Sent', due_date: '2026-11-11' }])];
    expect(items.find((i) => i.key === 'project-start:p')!.href).toBe('/projects/p');
    expect(items.find((i) => i.key === 'invoice:i')!.href).toBe('/invoices/i');
    expect(itemsOnDay(items, '2026-11-11').map((i) => i.key)).toEqual(['crew:a', 'crew:c', 'project-start:p', 'invoice:i']);
    expect(itemsOnDay(items, '2026-11-12').map((i) => i.key)).toEqual(['crew:a']);
    expect(itemsOnDay(items, '2026-11-13')).toEqual([]);
    expect(itemsOnDay(items, '2026-12-20').map((i) => i.key)).toEqual(['project-end:p']);
  });
});

describe('calendar page', () => {
  const sources = visibleSources('owner');
  const items = [
    ...toItems(source('crew'), [{ id: 'a', title: 'Crew A', status: 'Scheduled', start_date: '2026-11-10', end_date: '2026-11-12' }]),
    ...toItems(source('bid'), Array.from({ length: 5 }, (_, n) => ({ id: `e${n}`, title: `Bid ${n}`, status: 'Draft', bid_due: '2026-11-20' }))),
  ];
  const render = (view: 'month' | 'week', date = '2026-11-11') => renderToStaticMarkup(createElement(CalendarView, { view, date, today: '2026-11-11', sources, items }));
  const links = (html: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);

  it('names every colour in words and links each item to its record', () => {
    const html = render('month');
    for (const s of sources) expect(html).toContain(s.label);
    expect(html).toContain('Crew:</span> Crew A');
    expect(html).toContain('href="/estimates/e0"');
    expect(html).toContain('+ 2 more');
    expect(html).toContain('href="/calendar?view=week&amp;date=2026-11-20"');
    expect(html).toContain('href="/calendar?view=month&amp;date=2026-12-11"');
    expect(html).toContain('aria-current="page"');
  });

  it('lists the selected week for phones with 48px targets', () => {
    const html = render('month');
    const phone = html.slice(html.indexOf('lg:hidden'), html.indexOf('hidden lg:block'));
    expect(phone).toContain('Week of Nov 8 to Nov 14, 2026');
    expect(phone).toContain('Wed, Nov 11 · Today');
    expect(phone).toContain('Nothing scheduled.');
    expect(phone).toContain('Nov 10 to Nov 12');
    // On a phone, Previous and Next step a week even in the month view.
    expect(phone).toContain('href="/calendar?view=month&amp;date=2026-11-04"');
    const tappable = links(phone);
    expect(tappable.length).toBeGreaterThan(5);
    for (const a of tappable) expect(a).toContain('min-h-[48px]');
  });

  it('shows every item of a day in the week view', () => {
    const html = render('week', '2026-11-20');
    expect(html).not.toContain('more</a>');
    expect(html).toContain('Bid 4');
  });
});
