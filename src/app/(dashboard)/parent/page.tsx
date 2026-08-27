import Announcements from "@/components/Announcements";
import BigCalendarContainer from "@/components/BigCalendarContainer";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

const ParentPage = async () => {
  const { userId } = auth();

  // A parent sees the timetable of the class their child is in.
  const child = await prisma.student.findFirst({
    where: { parentId: userId! },
    select: { name: true, surname: true, classId: true },
  });

  return (
    <div className="flex-1 p-4 flex gap-4 flex-col xl:flex-row">
      {/* LEFT */}
      <div className="w-full xl:w-2/3">
        <div className="h-full bg-white p-4 rounded-md">
          <h1 className="text-xl font-semibold">
            {child ? `Schedule (${child.name} ${child.surname})` : "Schedule"}
          </h1>
          {child ? (
            <BigCalendarContainer type="classId" id={child.classId} />
          ) : (
            <p className="mt-4 text-sm text-gray-400">
              No students are linked to this account yet.
            </p>
          )}
        </div>
      </div>
      {/* RIGHT */}
      <div className="w-full xl:w-1/3 flex flex-col gap-8">
        <Announcements />
      </div>
    </div>
  );
};

export default ParentPage;
