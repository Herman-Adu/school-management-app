// Links seeded demo records to real Clerk accounts.
//
//   npm run db:link
//
// Reads the Clerk user ids from .env (which is gitignored) so they never need
// to be typed on a command line or pasted anywhere public:
//
//   CLERK_ADMIN_ID=user_...
//   CLERK_TEACHER_ID=user_...
//   CLERK_STUDENT_ID=user_...
//   CLERK_PARENT_ID=user_...
//
// Optionally choose which seeded rows to take over. Defaults shown:
//
//   LINK_TEACHER=teacher6
//   LINK_STUDENT=student8
//   LINK_ADMIN=admin1
//   LINK_PARENT=            # defaults to the linked student's own parent
//
// Every foreign key pointing at Teacher.id, Student.id and Parent.id is
// ON UPDATE CASCADE, so lessons, attendance, results, supervised classes and
// subject links all follow the rename automatically.
//
// Any role whose CLERK_*_ID is unset is skipped. Re-running is safe.

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Role = "admin" | "teacher" | "student" | "parent";

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const CLERK_ID_VARS = [
  "CLERK_ADMIN_ID",
  "CLERK_TEACHER_ID",
  "CLERK_STUDENT_ID",
  "CLERK_PARENT_ID",
] as const;

/**
 * Strips Clerk user ids out of text before it is printed. A failing Prisma
 * query can echo the offending value back in its error message, which would
 * otherwise put the id in the terminal despite the rest of this script being
 * careful never to print it.
 */
const redact = (text: string): string =>
  CLERK_ID_VARS.reduce((acc, name) => {
    const value = env(name);
    return value ? acc.split(value).join(`<${name}>`) : acc;
  }, text);

// The four Prisma delegates have incompatible argument types, so rather than
// casting them to a common shape they each get a tiny adapter. Verbose, but it
// stays fully type-checked.
type Model = {
  exists: (id: string) => Promise<boolean>;
  rename: (fromId: string, toId: string) => Promise<void>;
};

const models: Record<Role, Model> = {
  admin: {
    exists: async (id) =>
      (await prisma.admin.findUnique({ where: { id }, select: { id: true } })) !==
      null,
    rename: async (fromId, toId) => {
      await prisma.admin.update({ where: { id: fromId }, data: { id: toId } });
    },
  },
  teacher: {
    exists: async (id) =>
      (await prisma.teacher.findUnique({
        where: { id },
        select: { id: true },
      })) !== null,
    rename: async (fromId, toId) => {
      await prisma.teacher.update({ where: { id: fromId }, data: { id: toId } });
    },
  },
  student: {
    exists: async (id) =>
      (await prisma.student.findUnique({
        where: { id },
        select: { id: true },
      })) !== null,
    rename: async (fromId, toId) => {
      await prisma.student.update({ where: { id: fromId }, data: { id: toId } });
    },
  },
  parent: {
    exists: async (id) =>
      (await prisma.parent.findUnique({
        where: { id },
        select: { id: true },
      })) !== null,
    rename: async (fromId, toId) => {
      await prisma.parent.update({ where: { id: fromId }, data: { id: toId } });
    },
  },
};

/**
 * Links one seeded row to a Clerk account.
 *
 * `toId` is a real Clerk user id and is NEVER printed — output refers to the
 * environment variable it came from instead. That keeps the ids out of terminal
 * scrollback, CI logs and anywhere output gets pasted.
 */
const link = async (role: Role, fromId: string, toId: string, from: string) => {
  const model = models[role];

  if (fromId === toId) {
    console.log(`  ${role.padEnd(8)} already linked (${from})`);
    return;
  }

  const [source, existingTarget] = await Promise.all([
    model.exists(fromId),
    model.exists(toId),
  ]);

  if (existingTarget && !source) {
    console.log(`  ${role.padEnd(8)} already linked (${from})`);
    return;
  }

  if (existingTarget) {
    console.log(
      `  ${role.padEnd(8)} SKIP - a different ${role} already has ${from}`
    );
    return;
  }

  if (!source) {
    console.log(
      `  ${role.padEnd(8)} SKIP - no ${role} with id "${fromId}" ` +
        `(already linked to another Clerk id?)`
    );
    return;
  }

  await model.rename(fromId, toId);
  console.log(`  ${role.padEnd(8)} ${fromId} -> ${from}`);
};

async function main() {
  const clerk = {
    admin: env("CLERK_ADMIN_ID"),
    teacher: env("CLERK_TEACHER_ID"),
    student: env("CLERK_STUDENT_ID"),
    parent: env("CLERK_PARENT_ID"),
  };

  if (!Object.values(clerk).some(Boolean)) {
    throw new Error(
      "No CLERK_*_ID variables found in .env — add at least one of " +
        "CLERK_ADMIN_ID, CLERK_TEACHER_ID, CLERK_STUDENT_ID, CLERK_PARENT_ID."
    );
  }

  const targets = {
    admin: env("LINK_ADMIN") ?? "admin1",
    teacher: env("LINK_TEACHER") ?? "teacher6",
    student: env("LINK_STUDENT") ?? "student8",
  };

  // Resolve the parent before anything is renamed, so "the student's parent"
  // still refers to the row we expect. Match the already-linked id too, so a
  // second run resolves the same student rather than reporting it missing.
  const student = await prisma.student.findFirst({
    where: {
      OR: [
        { id: targets.student },
        ...(clerk.student ? [{ id: clerk.student }] : []),
      ],
    },
    select: { parentId: true, classId: true },
  });

  const parentTarget = env("LINK_PARENT") ?? student?.parentId;

  console.log("Linking seeded records to Clerk accounts:\n");

  if (clerk.admin)
    await link("admin", targets.admin, clerk.admin, "CLERK_ADMIN_ID");
  if (clerk.teacher)
    await link("teacher", targets.teacher, clerk.teacher, "CLERK_TEACHER_ID");
  if (clerk.student)
    await link("student", targets.student, clerk.student, "CLERK_STUDENT_ID");

  if (clerk.parent) {
    if (parentTarget) {
      await link("parent", parentTarget, clerk.parent, "CLERK_PARENT_ID");
    } else {
      console.log(
        `  parent   SKIP - could not resolve a parent ` +
          `(set LINK_PARENT, or check LINK_STUDENT="${targets.student}" exists)`
      );
    }
  }

  // Coherence check: the teacher dashboard is only interesting if the linked
  // teacher actually teaches the linked student's class.
  if (clerk.teacher && clerk.student && student) {
    const shared = await prisma.lesson.count({
      where: { teacherId: clerk.teacher, classId: student.classId },
    });
    const klass = await prisma.class.findUnique({
      where: { id: student.classId },
      select: { name: true },
    });

    console.log(
      shared > 0
        ? `\nLinked teacher teaches ${klass?.name} (${shared} lessons) — ` +
            `their dashboard overlaps the linked student's.`
        : `\nNote: the linked teacher does not teach ${klass?.name}, so the ` +
            `two dashboards show different timetables. That is fine — set ` +
            `LINK_TEACHER to a teacher of ${klass?.name} if you want them to match.`
    );
  }

  console.log(
    "\nDone. `npm run db:refresh` preserves these links; " +
      "`npm run db:seed` wipes them and you would run this again."
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(
      redact(e instanceof Error ? (e.stack ?? e.message) : String(e))
    );
    await prisma.$disconnect();
    process.exit(1);
  });
