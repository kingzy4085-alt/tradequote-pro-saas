import Link from 'next/link';
import {
  WEEKDAYS,
  addDays,
  calendarHref,
  dayLabel,
  itemsOnDay,
  monthWeeks,
  rangeLabel,
  shortDay,
  startOfMonth,
  stepDate,
  weekDays,
  type CalendarItem,
  type CalendarSource,
  type CalendarView as View,
} from '@/lib/calendar';

// Colour per source. Every item also carries the source's short name, so colour is never the only cue.
const SWATCH: Record<string, string> = {
  crew: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'project-start': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'project-end': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  bid: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  proposal: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  task: 'bg-slate-500/20 text-slate-200 border-slate-500/40',
  invoice: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
};
const swatch = (key: string) => SWATCH[key] ?? SWATCH.task;

// Most items a month cell lists before it points at the week.
const PER_CELL = 3;

const NAV = 'inline-flex items-center justify-center min-h-[48px] lg:min-h-0 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200';
const NAV_ON = 'inline-flex items-center justify-center min-h-[48px] lg:min-h-0 px-4 py-2 rounded-lg text-sm font-semibold border border-amber-500 bg-amber-500 text-slate-950';

export interface CalendarViewProps {
  view: View;
  date: string;
  today: string;
  sources: CalendarSource[];
  items: CalendarItem[];
}

function Steps({ view, date, today, unit }: { view: View; date: string; today: string; unit: View }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={calendarHref(view, stepDate(unit, date, -1))} className={NAV} aria-label={`Previous ${unit}`}>
        Previous
      </Link>
      <Link href={calendarHref(view, today)} className={NAV}>
        Today
      </Link>
      <Link href={calendarHref(view, stepDate(unit, date, 1))} className={NAV} aria-label={`Next ${unit}`}>
        Next
      </Link>
    </div>
  );
}

function Legend({ sources }: { sources: CalendarSource[] }) {
  return (
    <ul className="flex flex-wrap gap-2 mb-4" aria-label="What the colours mean">
      {sources.map((source) => (
        <li key={source.key} className={`px-2 py-1 rounded border text-xs font-medium ${swatch(source.key)}`}>
          {source.short === source.label ? source.label : `${source.short}: ${source.label}`}
        </li>
      ))}
    </ul>
  );
}

function Chip({ item, source }: { item: CalendarItem; source?: CalendarSource }) {
  const label = source?.label ?? 'Item';
  return (
    <Link
      href={item.href}
      title={`${label}: ${item.title}${item.status ? ` (${item.status})` : ''}`}
      className={`block truncate px-1.5 py-1 rounded border text-xs hover:brightness-125 ${swatch(item.source)}`}
    >
      <span className="font-semibold">{source?.short ?? label}:</span> {item.title}
    </Link>
  );
}

function Grid({ view, date, today, sources, items }: CalendarViewProps) {
  const weeks = view === 'week' ? [weekDays(date)] : monthWeeks(date);
  const month = startOfMonth(date).slice(0, 7);
  const byKey = new Map(sources.map((source) => [source.key, source]));
  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden">
      <div className="grid grid-cols-7 bg-slate-900 border-b border-slate-800">
        {WEEKDAYS.map((name) => (
          <div key={name} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {name}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-slate-800 last:border-b-0">
          {week.map((day) => {
            const all = itemsOnDay(items, day);
            const shown = view === 'week' ? all : all.slice(0, PER_CELL);
            const outside = view === 'month' && day.slice(0, 7) !== month;
            return (
              <div key={day} className={`min-w-0 p-1.5 border-r border-slate-800 last:border-r-0 ${view === 'week' ? 'min-h-[320px]' : 'min-h-[120px]'} ${outside ? 'bg-slate-950/60' : 'bg-slate-900/40'}`}>
                <div className="mb-1 flex items-center gap-1 text-xs">
                  <span className={day === today ? 'px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-bold' : outside ? 'px-1.5 py-0.5 text-slate-600' : 'px-1.5 py-0.5 text-slate-300 font-semibold'}>
                    {day.endsWith('-01') || view === 'week' ? shortDay(day) : Number(day.slice(8))}
                  </span>
                  {day === today && <span className="text-amber-400 font-semibold">Today</span>}
                </div>
                <div className="space-y-1">
                  {shown.map((item) => (
                    <Chip key={item.key} item={item} source={byKey.get(item.source)} />
                  ))}
                  {all.length > shown.length && (
                    <Link href={calendarHref('week', day)} className="block px-1.5 py-1 text-xs font-semibold text-amber-400 hover:text-amber-300">
                      + {all.length - shown.length} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Agenda({ date, today, sources, items }: CalendarViewProps) {
  const byKey = new Map(sources.map((source) => [source.key, source]));
  return (
    <div className="space-y-4">
      {weekDays(date).map((day) => {
        const all = itemsOnDay(items, day);
        return (
          <section key={day} aria-label={dayLabel(day)}>
            <h2 className={`mb-2 text-sm font-semibold ${day === today ? 'text-amber-400' : 'text-slate-300'}`}>
              {dayLabel(day)}
              {day === today ? ' · Today' : ''}
            </h2>
            {all.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {all.map((item) => {
                  const source = byKey.get(item.source);
                  return (
                    <li key={item.key}>
                      <Link href={item.href} className={`flex flex-col justify-center min-h-[48px] lg:min-h-0 px-3 py-2 rounded-lg border ${swatch(item.source)}`}>
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {source?.label ?? 'Item'}
                          {item.end !== item.start ? ` · ${shortDay(item.start)} to ${shortDay(item.end)}` : ''}
                        </span>
                        <span className="text-sm text-slate-100 break-words">{item.title}</span>
                        {item.status && <span className="text-xs text-slate-400">{item.status}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A grid on a desk, and the selected week as a list on phones and tablets. */
export default function CalendarView(props: CalendarViewProps) {
  const { view, date, today, sources } = props;
  return (
    <>
      {/* Phones and tablets: one week at a time. */}
      <div className="lg:hidden">
        <div className="mb-4 space-y-3">
          <p className="text-lg font-semibold text-slate-100">Week of {rangeLabel('week', date)}</p>
          <Steps view={view} date={date} today={today} unit="week" />
        </div>
        <Legend sources={sources} />
        <Agenda {...props} />
      </div>

      {/* Desk: the month or week grid. */}
      <div className="hidden lg:block">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <Steps view={view} date={date} today={today} unit={view} />
            <p className="text-lg font-semibold text-slate-100">{rangeLabel(view, date)}</p>
          </div>
          <div className="flex items-center gap-2" role="group" aria-label="Calendar view">
            <Link href={calendarHref('month', date)} className={view === 'month' ? NAV_ON : NAV} aria-current={view === 'month' ? 'page' : undefined}>
              Month
            </Link>
            <Link href={calendarHref('week', date)} className={view === 'week' ? NAV_ON : NAV} aria-current={view === 'week' ? 'page' : undefined}>
              Week
            </Link>
          </div>
        </div>
        <Legend sources={sources} />
        <Grid {...props} />
      </div>
    </>
  );
}

/** Last day the page needs loaded: the grid's range always covers the phone's week. */
export const lastDayOf = (from: string, days: number) => addDays(from, days - 1);
