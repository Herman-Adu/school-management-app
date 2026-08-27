// Pure timetable construction — no database access, no randomness that isn't
// seeded. Shared by `seed.ts` and `refresh.ts` so the two can never drift.

import {
  PERIOD_START_HOURS,
  SCHOOL_DAYS,
  addWeeks,
  eachWeekStart,
  getWeekStart,
} from "../src/lib/schedule";

export const CLASS_COUNT = 6;
export const SUBJECT_COUNT = 10;
export const TEACHER_COUNT = 15;
export const STUDENT_COUNT = 50;
export const PARENT_COUNT = 25;

/** How far either side of the run date the schedule is materialised. */
export const WEEKS_BACK = 52;
export const WEEKS_FORWARD = 52;

/** Weeks of attendance history to generate, counting back from this week. */
export const ATTENDANCE_WEEKS_BACK = 4;

/** Weeks either side of today that carry assignments. */
export const ASSIGNMENT_WEEKS = 6;

/** Week offsets, relative to this week, that carry exams. */
export const EXAM_WEEK_OFFSETS = [-8, -4, 4, 8];

export const SUBJECT_NAMES = [
  "Mathematics",
  "Science",
  "English",
  "History",
  "Geography",
  "Physics",
  "Chemistry",
  "Biology",
  "Computer Science",
  "Art",
];

// Slots are expressed as *indices*, not database ids. Autoincrement sequences
// do not reset when rows are deleted, so a re-seeded database will not have
// grades and subjects starting at 1 — callers resolve these indices against the
// rows they actually read back.
export type TimetableSlot = {
  /** 0-based index into the classes, ordered by id. */
  classIndex: number;
  /** 0 = Monday ... 4 = Friday. */
  dayOffset: number;
  startHour: number;
  /** 0-based index into the subjects, ordered by id. */
  subjectIndex: number;
  /** e.g. 3, meaning the teacher with id "teacher3". */
  teacherNumber: number;
};

export const teacherId = (teacherNumber: number): string =>
  `teacher${teacherNumber}`;

/** The single subject a teacher takes, as a 0-based subject index. */
export const subjectForTeacher = (teacherNumber: number): number =>
  (teacherNumber - 1) % SUBJECT_COUNT;

/**
 * Teachers who can take a subject. Subjects 0-4 have two teachers each and
 * subjects 5-9 have one.
 */
const teachersForSubject = (subjectIndex: number): number[] => {
  const teachers: number[] = [];
  for (let n = 1; n <= TEACHER_COUNT; n++) {
    if (subjectForTeacher(n) === subjectIndex) teachers.push(n);
  }
  return teachers;
};

/**
 * One week of lessons for the whole school: every class, every weekday, every
 * period.
 *
 * The subject for a slot is offset by the class index, so at any given
 * (day, period) the six classes are studying six *different* subjects. Since a
 * teacher only ever teaches one subject, that makes double-booking a teacher
 * structurally impossible rather than something we have to check for.
 */
export const buildWeeklyTimetable = (): TimetableSlot[] => {
  const slots: TimetableSlot[] = [];

  for (let classIndex = 0; classIndex < CLASS_COUNT; classIndex++) {
    for (let dayOffset = 0; dayOffset < SCHOOL_DAYS.length; dayOffset++) {
      PERIOD_START_HOURS.forEach((startHour, periodIndex) => {
        const slotIndex = dayOffset * PERIOD_START_HOURS.length + periodIndex;
        const subjectIndex = (slotIndex + classIndex) % SUBJECT_COUNT;
        const candidates = teachersForSubject(subjectIndex);

        slots.push({
          classIndex,
          dayOffset,
          startHour,
          subjectIndex,
          teacherNumber: candidates[classIndex % candidates.length],
        });
      });
    }
  }

  return slots;
};

/**
 * Every Monday in the materialised window, centred on the week containing
 * `anchor`. Every week is a teaching week: no holiday gaps, so the dashboard
 * is never empty whenever you happen to open it.
 */
export const scheduleWeeks = (anchor: Date = new Date()): Date[] => {
  const thisWeek = getWeekStart(anchor);
  return eachWeekStart(
    addWeeks(thisWeek, -WEEKS_BACK),
    addWeeks(thisWeek, WEEKS_FORWARD)
  );
};

export const scheduleWindow = (
  anchor: Date = new Date()
): { start: Date; end: Date } => {
  const weeks = scheduleWeeks(anchor);
  return { start: weeks[0], end: addWeeks(weeks[weeks.length - 1], 1) };
};

/** Deterministic PRNG, so re-running the seed produces the same database. */
export const createRandom = (seed: number) => {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Integer in [min, max]. */
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
  };
};
