import { describe, it, expect } from "vitest";
import {
  formatDayAndTime,
  formatElapsed,
  formatFullDateTime,
  formatRelativeTime,
} from "../../src/utils/formatRelativeTime";

/** "Now" for every case: 2026-10-13 at 14:30 local time. */
const NOW = new Date(2026, 9, 13, 14, 30, 0);

/**
 * Builds an ISO timestamp a given time before `NOW`.
 * @param milliseconds - How long before `NOW`
 * @returns The ISO string the API would send
 */
function isoBeforeNow(milliseconds: number): string {
  return new Date(NOW.getTime() - milliseconds).toISOString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("formatRelativeTime", () => {
  it("says just now for anything under 45 seconds, and for a moment in the future", () => {
    expect(formatRelativeTime(isoBeforeNow(10 * SECOND), NOW)).toBe("just now");
    expect(formatRelativeTime(isoBeforeNow(-5 * MINUTE), NOW)).toBe("just now");
  });

  it("counts whole minutes under an hour, never below one", () => {
    expect(formatRelativeTime(isoBeforeNow(50 * SECOND), NOW)).toBe("1 min ago");
    expect(formatRelativeTime(isoBeforeNow(24 * MINUTE + 40 * SECOND), NOW)).toBe("24 min ago");
    expect(formatRelativeTime(isoBeforeNow(59 * MINUTE + 59 * SECOND), NOW)).toBe("59 min ago");
  });

  it("counts whole hours within the day", () => {
    expect(formatRelativeTime(isoBeforeNow(3 * HOUR + 20 * MINUTE), NOW)).toBe("3 h ago");
  });

  it("counts hours for under a day even across midnight", () => {
    const justAfterMidnight = new Date(2026, 9, 13, 0, 30, 0);
    const lateYesterday = new Date(2026, 9, 12, 23, 0, 0).toISOString();
    expect(formatRelativeTime(lateYesterday, justAfterMidnight)).toBe("1 h ago");
  });

  it("says yesterday for the day before, a day or more ago", () => {
    const yesterdayMorning = new Date(2026, 9, 12, 9, 0, 0).toISOString();
    expect(formatRelativeTime(yesterdayMorning, NOW)).toBe("yesterday");
  });

  it("writes the short date for anything older, with the year only when it differs", () => {
    const tenthOfOctober = new Date(2026, 9, 10, 9, 0, 0);
    expect(formatRelativeTime(tenthOfOctober.toISOString(), NOW)).toBe(
      tenthOfOctober.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    const lastYear = new Date(2025, 9, 10, 9, 0, 0);
    expect(formatRelativeTime(lastYear.toISOString(), NOW)).toBe(
      lastYear.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    );
  });
});

describe("formatDayAndTime", () => {
  /**
   * Writes a time of day the way the helper does.
   * @param date - The moment
   * @returns e.g. "11:29"
   */
  const timeOf = (date: Date): string =>
    date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  it("says today with the time for a moment earlier today", () => {
    const thisMorning = new Date(2026, 9, 13, 11, 29, 0);
    expect(formatDayAndTime(thisMorning.toISOString(), NOW)).toBe(`today ${timeOf(thisMorning)}`);
  });

  it("says yesterday with the time for the day before", () => {
    const yesterdayEvening = new Date(2026, 9, 12, 18, 2, 0);
    expect(formatDayAndTime(yesterdayEvening.toISOString(), NOW)).toBe(`yesterday ${timeOf(yesterdayEvening)}`);
  });

  it("writes the short date with the time for anything older", () => {
    const tenthOfOctober = new Date(2026, 9, 10, 9, 5, 0);
    const shortDate = tenthOfOctober.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    expect(formatDayAndTime(tenthOfOctober.toISOString(), NOW)).toBe(`${shortDate} ${timeOf(tenthOfOctober)}`);
  });
});

describe("formatFullDateTime", () => {
  it("writes the exact moment in the viewer's locale", () => {
    const moment = new Date(2026, 9, 13, 9, 2, 11);
    expect(formatFullDateTime(moment.toISOString())).toBe(moment.toLocaleString());
  });
});

describe("formatElapsed", () => {
  it("writes minutes and zero-padded seconds", () => {
    expect(formatElapsed(7 * SECOND)).toBe("0:07");
    expect(formatElapsed(2 * MINUTE + 14 * SECOND + 900)).toBe("2:14");
    expect(formatElapsed(10 * MINUTE)).toBe("10:00");
  });

  it("adds hours once it passes an hour", () => {
    expect(formatElapsed(HOUR + 2 * MINUTE + 3 * SECOND)).toBe("1:02:03");
  });

  it("reads 0:00 for a negative duration", () => {
    expect(formatElapsed(-5 * SECOND)).toBe("0:00");
  });
});
