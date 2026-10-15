import { useEffect, useState } from "react";

/** How often a ticking clock updates, in ms: once a second, for stopwatch text. */
const DEFAULT_TICK_INTERVAL_MS = 1000;

/**
 * The current time, for text that reads off a clock (a running crawl's
 * "2:14"). While `isTicking` is true the component re-renders every
 * `tickIntervalMs` with a fresh time; while it is false the time stays where
 * it was, so a finished crawl stops re-rendering.
 * @param isTicking - True while the clock should keep moving
 * @param tickIntervalMs - How often to update, in ms (default once a second)
 * @returns The current time, as of the last tick
 */
export function useNow(isTicking: boolean, tickIntervalMs = DEFAULT_TICK_INTERVAL_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isTicking) return undefined;
    // Catch up at once: the time may be stale from before the clock stopped.
    setNow(new Date());
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, tickIntervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isTicking, tickIntervalMs]);

  return now;
}
