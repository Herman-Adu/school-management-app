import { auth } from "@clerk/nextjs/server";

const { userId, sessionClaims } = auth();
export const role = (sessionClaims?.metadata as { role: string }).role;
export const currentUserId = userId;

// The schedule maths lives in @/lib/schedule so that client components can use
// it — this module calls auth() at import time and is therefore server-only.
export {
  adjustScheduleToCurrentWeek,
  projectScheduleOntoWeek,
  getWeekStart,
  getWeekRange,
} from "./schedule";
