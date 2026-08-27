// Re-anchors the schedule to today without touching people.
//
//   npm run db:refresh
//
// Run this whenever the dashboard starts looking empty — months from now the
// seeded window will have drifted into the past, and this pulls it back around
// the current date so every week has lessons, attendance, events and
// announcements again for both teachers and students.

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { clearSchedule, generateSchedule } from "./generate-schedule";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const studentCount = await prisma.student.count();
  if (studentCount === 0) {
    throw new Error(
      "No students found — run `npx prisma db seed` first, then refresh."
    );
  }

  await clearSchedule(prisma);
  await generateSchedule(prisma);

  console.log("Schedule refreshed around today.");
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
