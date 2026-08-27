import { PrismaClient, UserSex } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { clearSchedule, generateSchedule } from "./generate-schedule";
import {
  CLASS_COUNT,
  PARENT_COUNT,
  STUDENT_COUNT,
  SUBJECT_NAMES,
  TEACHER_COUNT,
  buildWeeklyTimetable,
  subjectForTeacher,
  teacherId,
} from "./timetable";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Wipes everything so `prisma db seed` can be re-run against a live database.
 * TRUNCATE ... RESTART IDENTITY resets the autoincrement sequences too, which
 * plain deletes do not — without it a second seed would produce grade and
 * subject ids that no longer start at 1.
 */
const clearAll = async () => {
  await clearSchedule(prisma);
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "Student", "Parent", "Class", "Teacher", "Subject", "Grade", "Admin", "_SubjectToTeacher" RESTART IDENTITY CASCADE`
  );
};

async function main() {
  await clearAll();

  // ADMIN
  await prisma.admin.createMany({
    data: [
      { id: "admin1", username: "admin1" },
      { id: "admin2", username: "admin2" },
    ],
  });

  // GRADE
  const gradeIds: number[] = [];
  for (let i = 1; i <= CLASS_COUNT; i++) {
    const grade = await prisma.grade.create({ data: { level: i } });
    gradeIds.push(grade.id);
  }

  // SUBJECT
  for (const name of SUBJECT_NAMES) {
    await prisma.subject.create({ data: { name } });
  }

  // CLASS
  for (let i = 1; i <= CLASS_COUNT; i++) {
    await prisma.class.create({
      data: {
        name: `${i}A`,
        gradeId: gradeIds[i - 1],
        capacity: 15 + (i % 6),
      },
    });
  }

  // TEACHER
  //
  // A teacher's subject comes from the timetable rather than being guessed, so
  // every lesson is taught by someone who actually teaches that subject.
  const timetable = buildWeeklyTimetable();

  const [classes, subjects, grades] = await Promise.all([
    prisma.class.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    prisma.subject.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    prisma.grade.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
  ]);

  for (let i = 1; i <= TEACHER_COUNT; i++) {
    const id = teacherId(i);

    await prisma.teacher.create({
      data: {
        id,
        username: id,
        name: `TName${i}`,
        surname: `TSurname${i}`,
        email: `teacher${i}@example.com`,
        phone: `123-456-789${i}`,
        address: `Address${i}`,
        bloodType: "A+",
        sex: i % 2 === 0 ? UserSex.MALE : UserSex.FEMALE,
        subjects: { connect: [{ id: subjects[subjectForTeacher(i)].id }] },
        birthday: new Date(
          new Date().setFullYear(new Date().getFullYear() - 30)
        ),
      },
    });
  }

  // CLASS SUPERVISORS
  //
  // Teacher.classes is the inverse of Class.supervisor — a one-to-many, not a
  // many-to-many — so each class gets exactly one supervisor, chosen from the
  // teachers who actually teach it and not already supervising another class.
  const taken = new Set<string>();

  for (const [classIndex, klass] of classes.entries()) {
    const candidates = timetable
      .filter((slot) => slot.classIndex === classIndex)
      .map((slot) => teacherId(slot.teacherNumber));

    const supervisorId =
      candidates.find((candidate) => !taken.has(candidate)) ?? candidates[0];
    if (!supervisorId) continue;

    taken.add(supervisorId);
    await prisma.class.update({
      where: { id: klass.id },
      data: { supervisorId },
    });
  }

  // PARENT
  for (let i = 1; i <= PARENT_COUNT; i++) {
    await prisma.parent.create({
      data: {
        id: `parentId${i}`,
        username: `parentId${i}`,
        name: `PName ${i}`,
        surname: `PSurname ${i}`,
        email: `parent${i}@example.com`,
        phone: `123-456-789${i}`,
        address: `Address${i}`,
      },
    });
  }

  // STUDENT
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    const classIndex = i % CLASS_COUNT;

    await prisma.student.create({
      data: {
        id: `student${i}`,
        username: `student${i}`,
        name: `SName${i}`,
        surname: `SSurname ${i}`,
        email: `student${i}@example.com`,
        phone: `987-654-321${i}`,
        address: `Address${i}`,
        bloodType: "O-",
        sex: i % 2 === 0 ? UserSex.MALE : UserSex.FEMALE,
        parentId: `parentId${Math.ceil(i / 2) % PARENT_COUNT || PARENT_COUNT}`,
        gradeId: grades[classIndex].id,
        classId: classes[classIndex].id,
        birthday: new Date(
          new Date().setFullYear(new Date().getFullYear() - 10)
        ),
      },
    });
  }

  // LESSONS, ATTENDANCE, EXAMS, ASSIGNMENTS, RESULTS, EVENTS, ANNOUNCEMENTS
  await generateSchedule(prisma);

  console.log("Seeding completed successfully.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
