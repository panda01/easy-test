const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/** Anything this recent (or a moment in the future, from clock skew) reads "just now". */
const JUST_NOW_LIMIT_MS = 45 * MILLISECONDS_PER_SECOND;

/**
 * Tells whether two moments fall on the same local calendar day.
 * @param firstDate - One moment
 * @param secondDate - The other moment
 * @returns True when both are on the same day in the viewer's time zone
 */
function isSameCalendarDay(firstDate: Date, secondDate: Date): boolean {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

/**
 * Tells whether a moment fell on the local calendar day before another.
 * @param date - The earlier moment
 * @param now - The moment it is compared with
 * @returns True when `date` is on the day before `now`'s day
 */
function isTheDayBefore(date: Date, now: Date): boolean {
  const theDayBeforeNow = new Date(now);
  theDayBeforeNow.setDate(now.getDate() - 1);
  return isSameCalendarDay(date, theDayBeforeNow);
}

/**
 * Writes a calendar date the short way the mockups do: "Oct 10", with the
 * year added only when it is not the current one ("Oct 10, 2025").
 * @param date - The date to write
 * @param now - The current moment, to decide whether the year is needed
 * @returns The short date
 */
function formatShortDate(date: Date, now: Date): string {
  const dateIsInAnotherYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(dateIsInAnotherYear ? { year: "numeric" } : {}),
  });
}

/**
 * Writes a time of day on the 24-hour clock, e.g. "11:29".
 * @param date - The moment to write
 * @returns The time of day
 */
function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/**
 * Says how long ago something happened, the way the mockups do: "just now",
 * "24 min ago", "3 h ago", "yesterday", then the date ("Oct 10"). Pair it
 * with `formatFullDateTime` as a hover title so the exact time is one hover
 * away.
 * @param isoDate - When it happened, as the API sends it (an ISO string)
 * @param now - The current moment
 * @returns The relative time
 */
export function formatRelativeTime(isoDate: string, now: Date): string {
  const date = new Date(isoDate);
  const elapsedMs = now.getTime() - date.getTime();
  if (elapsedMs < JUST_NOW_LIMIT_MS) {
    return "just now";
  }
  if (elapsedMs < MILLISECONDS_PER_HOUR) {
    const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / MILLISECONDS_PER_MINUTE));
    return `${String(elapsedMinutes)} min ago`;
  }
  const happenedToday = isSameCalendarDay(date, now);
  const happenedWithinADay = elapsedMs < MILLISECONDS_PER_DAY;
  if (happenedToday || happenedWithinADay) {
    const elapsedHours = Math.floor(elapsedMs / MILLISECONDS_PER_HOUR);
    return `${String(elapsedHours)} h ago`;
  }
  if (isTheDayBefore(date, now)) {
    return "yesterday";
  }
  return formatShortDate(date, now);
}

/**
 * Writes the day and time something started, for a title like
 * "Crawl · today 11:29": "today 11:29", "yesterday 18:02", or "Oct 10 11:29".
 * @param isoDate - When it happened, as the API sends it (an ISO string)
 * @param now - The current moment
 * @returns The day and the time of day
 */
export function formatDayAndTime(isoDate: string, now: Date): string {
  const date = new Date(isoDate);
  const timeText = formatTimeOfDay(date);
  if (isSameCalendarDay(date, now)) {
    return `today ${timeText}`;
  }
  if (isTheDayBefore(date, now)) {
    return `yesterday ${timeText}`;
  }
  return `${formatShortDate(date, now)} ${timeText}`;
}

/**
 * Writes the exact date and time in the viewer's locale, for hover titles.
 * @param isoDate - The moment, as the API sends it (an ISO string)
 * @returns e.g. "10/13/2026, 9:02:11 AM"
 */
export function formatFullDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString();
}

/**
 * Writes a running time on a stopwatch: "0:07", "2:14", or "1:02:03" once it
 * passes an hour. A negative duration (clock skew) reads "0:00".
 * @param durationMs - The time elapsed, in milliseconds
 * @returns The stopwatch text
 */
export function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / MILLISECONDS_PER_SECOND));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondsText = String(seconds).padStart(2, "0");
  const durationReachesAnHour = hours > 0;
  if (durationReachesAnHour) {
    return `${String(hours)}:${String(minutes).padStart(2, "0")}:${secondsText}`;
  }
  return `${String(minutes)}:${secondsText}`;
}
