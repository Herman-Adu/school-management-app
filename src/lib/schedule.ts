// Pure date helpers for the school timetable.
//
// This module deliberately has no imports: it is pulled in by both the client
// calendar and the Prisma seed scripts, so it must not drag in Clerk (which
// `@/lib/utils` does at module scope) or the generated Prisma client.

export const SCHOOL_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

export type SchoolDay = (typeof SCHOOL_DAYS)[number];

/** Hours a lesson can start at. Lunch is the 11:00 gap. */
export const PERIOD_START_HOURS = [8, 9, 10, 12, 13] as const;

export const PERIOD_LENGTH_MINUTES = 60;

/** Bounds of the visible day in the big calendar. */
export const SCHOOL_DAY_START_HOUR = 8;
export const SCHOOL_DAY_END_HOUR = 17;

export type CalendarEvent = { title: string; start: Date; end: Date };

/** Monday = 0 ... Friday = 4. Returns null for Saturday and Sunday. */
export const weekdayOffset = (date: Date): number | null => {
  const day = date.getDay();
  return day >= 1 && day <= 5 ? day - 1 : null;
};

export const isSchoolDay = (date: Date): boolean => weekdayOffset(date) !== null;

export const dayToOffset = (day: SchoolDay): number => SCHOOL_DAYS.indexOf(day);

export const offsetToDay = (offset: number): SchoolDay => SCHOOL_DAYS[offset];

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const addWeeks = (date: Date, weeks: number): Date =>
  addDays(date, weeks * 7);

/** Monday 00:00 of the week containing `date`. Never mutates `date`. */
export const getWeekStart = (date: Date): Date => {
  const result = new Date(date);
  const dayOfWeek = result.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  result.setDate(result.getDate() - daysSinceMonday);
  result.setHours(0, 0, 0, 0);
  return result;
};

/** Monday 00:00 through Sunday 23:59:59.999 of the week containing `date`. */
export const getWeekRange = (date: Date): { start: Date; end: Date } => {
  const start = getWeekStart(date);
  const end = addDays(start, 7);
  end.setMilliseconds(-1);
  return { start, end };
};

/** Every Monday from the week of `from` through the week of `to`, inclusive. */
export const eachWeekStart = (from: Date, to: Date): Date[] => {
  const last = getWeekStart(to);
  const weeks: Date[] = [];
  for (
    let week = getWeekStart(from);
    week.getTime() <= last.getTime();
    week = addWeeks(week, 1)
  ) {
    weeks.push(week);
  }
  return weeks;
};

/** A date on `weekStart`'s week, on the given weekday, at the given time. */
export const atWeekday = (
  weekStart: Date,
  offset: number,
  hours: number,
  minutes = 0
): Date => {
  const result = addDays(getWeekStart(weekStart), offset);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

/**
 * Shift each event onto the same weekday of `weekStart`, preserving its
 * time of day. Weekend events are dropped — the timetable is Monday to Friday.
 */
export const projectScheduleOntoWeek = <T extends CalendarEvent>(
  events: T[],
  weekStart: Date
): T[] => {
  const monday = getWeekStart(weekStart);

  return events.flatMap((event) => {
    const offset = weekdayOffset(event.start);
    if (offset === null) return [];

    const start = addDays(monday, offset);
    start.setHours(
      event.start.getHours(),
      event.start.getMinutes(),
      event.start.getSeconds(),
      0
    );

    const end = new Date(start);
    end.setHours(
      event.end.getHours(),
      event.end.getMinutes(),
      event.end.getSeconds(),
      0
    );

    return [{ ...event, start, end }];
  });
};

export const adjustScheduleToCurrentWeek = <T extends CalendarEvent>(
  events: T[]
): T[] => projectScheduleOntoWeek(events, getWeekStart(new Date()));
