// Materialises the timetable and everything hanging off it (attendance, exams,
// assignments, results, events, announcements) across a window centred on the
// run date.
//
// Used by `seed.ts` for a fresh database and by `refresh.ts` to re-anchor an
// existing one, so the two always produce identically shaped data.

import type { Day, PrismaClient } from "../generated/prisma/client";
import {
  PERIOD_LENGTH_MINUTES,
  addDays,
  addWeeks,
  atWeekday,
  getWeekStart,
  offsetToDay,
} from "../src/lib/schedule";
import {
  ASSIGNMENT_WEEKS,
  ATTENDANCE_WEEKS_BACK,
  EXAM_WEEK_OFFSETS,
  buildWeeklyTimetable,
  createRandom,
  scheduleWeeks,
} from "./timetable";

const BATCH_SIZE = 1000;

const inBatches = async <T>(
  rows: T[],
  write: (batch: T[]) => Promise<unknown>
): Promise<void> => {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await write(rows.slice(i, i + BATCH_SIZE));
  }
};

const endOfPeriod = (start: Date): Date => {
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + PERIOD_LENGTH_MINUTES);
  return end;
};

type LessonRef = {
  id: number;
  classId: number;
  subjectId: number;
  startTime: Date;
};

/**
 * Removes everything the schedule generator owns, leaving people, classes,
 * grades and subjects untouched. TRUNCATE rather than deleteMany so the
 * autoincrement sequences restart and ids stay stable across re-runs.
 */
export const clearSchedule = async (prisma: PrismaClient): Promise<void> => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "Result", "Attendance", "Exam", "Assignment", "Lesson", "Event", "Announcement" RESTART IDENTITY CASCADE`
  );
};

export const generateSchedule = async (
  prisma: PrismaClient,
  anchor: Date = new Date()
): Promise<void> => {
  const random = createRandom(20260817);
  const thisWeek = getWeekStart(anchor);
  const weeks = scheduleWeeks(anchor);
  const timetable = buildWeeklyTimetable();

  const [classes, subjects, students, teachers] = await Promise.all([
    prisma.class.findMany({
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    }),
    prisma.subject.findMany({
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    }),
    prisma.student.findMany({ select: { id: true, classId: true } }),
    prisma.teacher.findMany({
      select: { id: true, username: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (classes.length === 0 || subjects.length === 0 || teachers.length === 0) {
    throw new Error(
      "No classes, subjects or teachers found — run `npx prisma db seed` before generating a schedule."
    );
  }

  // Teachers are resolved by username, not by rebuilding "teacher{n}" ids.
  // `npm run db:link` re-points a teacher's id at a Clerk user id, and a
  // regenerated timetable must follow that rename rather than reintroducing the
  // old id and violating the foreign key. Usernames are left alone by linking,
  // so they stay a stable handle.
  const teacherIdByNumber = new Map<number, string>();
  teachers.forEach((teacher, index) => {
    const match = /^teacher(\d+)$/.exec(teacher.username);
    teacherIdByNumber.set(match ? Number(match[1]) : index + 1, teacher.id);
  });

  const resolveTeacher = (teacherNumber: number): string => {
    const id =
      teacherIdByNumber.get(teacherNumber) ??
      teachers[(teacherNumber - 1) % teachers.length]?.id;

    if (!id) {
      throw new Error(`No teacher available for timetable slot ${teacherNumber}.`);
    }
    return id;
  };

  const className = new Map(classes.map((c) => [c.id, c.name]));
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  const studentsByClass = new Map<number, string[]>();
  for (const student of students) {
    const bucket = studentsByClass.get(student.classId) ?? [];
    bucket.push(student.id);
    studentsByClass.set(student.classId, bucket);
  }

  // LESSONS — one full timetable per week across the whole window.
  const lessonsByWeek = new Map<number, LessonRef[]>();
  const lessonClassId = new Map<number, number>();

  for (const week of weeks) {
    const rows = timetable.map((slot) => {
      const startTime = atWeekday(week, slot.dayOffset, slot.startHour);
      const subject = subjects[slot.subjectIndex % subjects.length];
      const klass = classes[slot.classIndex % classes.length];

      return {
        name: `${subject.name} (${klass.name})`,
        day: offsetToDay(slot.dayOffset) as Day,
        startTime,
        endTime: endOfPeriod(startTime),
        subjectId: subject.id,
        classId: klass.id,
        teacherId: resolveTeacher(slot.teacherNumber),
      };
    });

    const created = await prisma.lesson.createManyAndReturn({
      data: rows,
      select: { id: true, classId: true, subjectId: true, startTime: true },
    });

    lessonsByWeek.set(week.getTime(), created);
    for (const lesson of created) lessonClassId.set(lesson.id, lesson.classId);
  }

  const lessonsInWeek = (offset: number): LessonRef[] =>
    lessonsByWeek.get(addWeeks(thisWeek, offset).getTime()) ?? [];

  // ATTENDANCE — recent weeks only. The chart reads from this Monday, so a
  // short history is enough and keeps the row count sane.
  //
  // The whole of the current week is filled in, including days that have not
  // happened yet: seeding only up to "now" leaves the chart showing a single
  // bar on a Monday morning, which is honest but useless as a dashboard.
  const attendanceRows: {
    date: Date;
    present: boolean;
    studentId: string;
    lessonId: number;
  }[] = [];

  for (let offset = -ATTENDANCE_WEEKS_BACK; offset <= 0; offset++) {
    for (const lesson of lessonsInWeek(offset)) {
      for (const studentId of studentsByClass.get(lesson.classId) ?? []) {
        attendanceRows.push({
          date: lesson.startTime,
          present: random.chance(0.9),
          studentId,
          lessonId: lesson.id,
        });
      }
    }
  }

  await inBatches(attendanceRows, (data) =>
    prisma.attendance.createMany({ data })
  );

  // EXAMS — three subjects per class in each exam week, pinned to real lessons.
  const examRows: {
    title: string;
    startTime: Date;
    endTime: Date;
    lessonId: number;
  }[] = [];

  for (const offset of EXAM_WEEK_OFFSETS) {
    for (const klass of classes) {
      const seen = new Set<number>();

      for (const lesson of lessonsInWeek(offset)) {
        if (lesson.classId !== klass.id) continue;
        if (seen.size >= 3) break;
        if (seen.has(lesson.subjectId)) continue;
        seen.add(lesson.subjectId);

        examRows.push({
          title: `${subjectName.get(lesson.subjectId)} Exam - ${klass.name}`,
          startTime: lesson.startTime,
          endTime: endOfPeriod(lesson.startTime),
          lessonId: lesson.id,
        });
      }
    }
  }

  const exams = await prisma.exam.createManyAndReturn({
    data: examRows,
    select: { id: true, lessonId: true, startTime: true },
  });

  // ASSIGNMENTS — a rolling band either side of today, due a week after set.
  const assignmentRows: {
    title: string;
    startDate: Date;
    dueDate: Date;
    lessonId: number;
  }[] = [];

  for (let offset = -ASSIGNMENT_WEEKS; offset <= ASSIGNMENT_WEEKS; offset++) {
    for (const klass of classes) {
      const classLessons = lessonsInWeek(offset).filter(
        (lesson) => lesson.classId === klass.id
      );
      if (classLessons.length === 0) continue;

      const chosen = new Set<number>();
      while (chosen.size < Math.min(2, classLessons.length)) {
        chosen.add(random.int(0, classLessons.length - 1));
      }

      for (const index of chosen) {
        const lesson = classLessons[index];
        const dueDate = addDays(lesson.startTime, 7);
        dueDate.setHours(23, 59, 0, 0);

        assignmentRows.push({
          title: `${subjectName.get(lesson.subjectId)} Assignment - ${
            klass.name
          }`,
          startDate: lesson.startTime,
          dueDate,
          lessonId: lesson.id,
        });
      }
    }
  }

  const assignments = await prisma.assignment.createManyAndReturn({
    data: assignmentRows,
    select: { id: true, lessonId: true, dueDate: true },
  });

  // RESULTS — only for work that is actually behind us.
  const resultRows: {
    score: number;
    studentId: string;
    examId?: number;
    assignmentId?: number;
  }[] = [];

  for (const exam of exams) {
    if (exam.startTime > anchor) continue;
    const classId = lessonClassId.get(exam.lessonId);
    for (const studentId of studentsByClass.get(classId!) ?? []) {
      resultRows.push({ score: random.int(45, 100), studentId, examId: exam.id });
    }
  }

  for (const assignment of assignments) {
    if (assignment.dueDate > anchor) continue;
    const classId = lessonClassId.get(assignment.lessonId);
    for (const studentId of studentsByClass.get(classId!) ?? []) {
      resultRows.push({
        score: random.int(50, 100),
        studentId,
        assignmentId: assignment.id,
      });
    }
  }

  await inBatches(resultRows, (data) => prisma.result.createMany({ data }));

  // EVENTS — three a week across the window so the event calendar has
  // something to show on most days you click.
  const eventTitles = [
    "Parents Evening",
    "Sports Practice",
    "Science Fair",
    "School Assembly",
    "Field Trip",
    "Drama Rehearsal",
    "Careers Talk",
    "Charity Bake Sale",
  ];

  const eventRows: {
    title: string;
    description: string;
    startTime: Date;
    endTime: Date;
    classId: number | null;
  }[] = [];

  for (const week of weeks) {
    const days = new Set<number>();
    while (days.size < 3) days.add(random.int(0, 4));

    for (const dayOffset of days) {
      const title = random.pick(eventTitles);
      const startTime = atWeekday(week, dayOffset, random.int(9, 15));
      const endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);

      eventRows.push({
        title,
        description: `${title} for the week beginning ${week.toDateString()}.`,
        startTime,
        endTime,
        // Roughly a third are school-wide rather than class-specific.
        classId: random.chance(0.35) ? null : random.pick(classes).id,
      });
    }
  }

  await inBatches(eventRows, (data) => prisma.event.createMany({ data }));

  // ANNOUNCEMENTS — one per week, posted Monday morning.
  const announcementRows = weeks.map((week, index) => ({
    title: `Week ${index + 1} Notice`,
    description: `Reminders and updates for the week beginning ${week.toDateString()}.`,
    date: atWeekday(week, 0, 9),
    classId: random.chance(0.4) ? null : random.pick(classes).id,
  }));

  await inBatches(announcementRows, (data) =>
    prisma.announcement.createMany({ data })
  );

  console.log(
    [
      `Schedule generated for ${weeks.length} weeks ` +
        `(${weeks[0].toDateString()} - ${weeks[weeks.length - 1].toDateString()})`,
      `  lessons:       ${weeks.length * timetable.length}`,
      `  attendance:    ${attendanceRows.length}`,
      `  exams:         ${exams.length}`,
      `  assignments:   ${assignments.length}`,
      `  results:       ${resultRows.length}`,
      `  events:        ${eventRows.length}`,
      `  announcements: ${announcementRows.length}`,
    ].join("\n")
  );
};
