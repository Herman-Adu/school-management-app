import prisma from "@/lib/prisma";
import BigCalendar from "./BigCalender";
import { getWeekRange } from "@/lib/schedule";
import { Prisma } from "../../generated/prisma/client";

const BigCalendarContainer = async ({
  type,
  id,
}: {
  type: "teacherId" | "classId";
  id: string | number;
}) => {
  const owner: Prisma.LessonWhereInput =
    type === "teacherId"
      ? { teacherId: id as string }
      : { classId: id as number };

  const fetchWeek = (start: Date, end: Date) =>
    prisma.lesson.findMany({
      where: { ...owner, startTime: { gte: start, lte: end } },
      orderBy: { startTime: "asc" },
      select: { name: true, startTime: true, endTime: true },
    });

  const thisWeek = getWeekRange(new Date());
  let lessons = await fetchWeek(thisWeek.start, thisWeek.end);

  // Outside the materialised window (an old database, or a date past the seeded
  // range) fall back to the nearest week that does have lessons, so the
  // calendar still shows a timetable instead of nothing.
  if (lessons.length === 0) {
    const nearest = await prisma.lesson.findFirst({
      where: owner,
      orderBy: { startTime: "desc" },
      select: { startTime: true },
    });

    if (nearest) {
      const fallback = getWeekRange(nearest.startTime);
      lessons = await fetchWeek(fallback.start, fallback.end);
    }
  }

  const data = lessons.map((lesson) => ({
    title: lesson.name,
    start: lesson.startTime,
    end: lesson.endTime,
  }));

  return (
    <div className="">
      <BigCalendar data={data} />
    </div>
  );
};

export default BigCalendarContainer;
