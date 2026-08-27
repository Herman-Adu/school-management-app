import Announcements from "@/components/Announcements";
import BigCalendarContainer from "@/components/BigCalendarContainer";
import EventCalendar from "@/components/EventCalendar";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

const StudentPage = async () => {
  const { userId } = auth();

  // Clerk's userId has to match a Student.id for this to resolve. Seeded
  // students use ids like "student1", so a Clerk account that was not created
  // alongside its Student row will legitimately find nothing here.
  const studentClass = await prisma.class.findFirst({
    where: { students: { some: { id: userId! } } },
    select: { id: true, name: true },
  });

  return (
    <div className="p-4 flex gap-4 flex-col xl:flex-row">
      {/* LEFT */}
      <div className="w-full xl:w-2/3">
        <div className="h-full bg-white p-4 rounded-md">
          <h1 className="text-xl font-semibold">
            {studentClass ? `Schedule (${studentClass.name})` : "Schedule"}
          </h1>
          {studentClass ? (
            <BigCalendarContainer type="classId" id={studentClass.id} />
          ) : (
            <p className="mt-4 text-sm text-gray-400">
              This account is not linked to a student record, so there is no
              class schedule to show.
            </p>
          )}
        </div>
      </div>
      {/* RIGHT */}
      <div className="w-full xl:w-1/3 flex flex-col gap-8">
        <EventCalendar />
        <Announcements />
      </div>
    </div>
  );
};

export default StudentPage;
