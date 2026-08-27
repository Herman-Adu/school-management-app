"use client";

import { Calendar, momentLocalizer, View, Views } from "react-big-calendar";
import moment from "moment";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { useMemo, useState } from "react";
import {
  SCHOOL_DAY_END_HOUR,
  SCHOOL_DAY_START_HOUR,
  getWeekStart,
  projectScheduleOntoWeek,
} from "@/lib/schedule";

const localizer = momentLocalizer(moment);

const BigCalendar = ({
  data,
}: {
  data: { title: string; start: Date; end: Date }[];
}) => {
  const [view, setView] = useState<View>(Views.WORK_WEEK);
  const [date, setDate] = useState<Date>(() => new Date());

  // The timetable repeats every week, so navigating projects the week we were
  // given onto the week being viewed rather than refetching. Weeks either side
  // of the seeded window stay populated as a result.
  const events = useMemo(
    () => projectScheduleOntoWeek(data, getWeekStart(date)),
    [data, date]
  );

  const { min, max } = useMemo(() => {
    const min = new Date(date);
    min.setHours(SCHOOL_DAY_START_HOUR, 0, 0, 0);

    const max = new Date(date);
    max.setHours(SCHOOL_DAY_END_HOUR, 0, 0, 0);

    return { min, max };
  }, [date]);

  return (
    <Calendar
      localizer={localizer}
      events={events}
      startAccessor="start"
      endAccessor="end"
      views={["work_week", "day"]}
      view={view}
      date={date}
      onNavigate={setDate}
      onView={setView}
      style={{ height: "98%" }}
      min={min}
      max={max}
    />
  );
};

export default BigCalendar;
