/** The parts of a screenshot run its one-line outcome is built from. */
export interface ScreenshotRunOutcomeFields {
  /** True only when the page loaded with an HTTP status below 400. */
  succeeded: boolean;
  /** The page's HTTP status, or null when there was no response. */
  httpStatus: number | null;
}

/**
 * Summarizes how a screenshot run went, for a status line or a list row, e.g.
 * "Succeeded · HTTP 200", "Failed · HTTP 404", or "Failed · No response" (a
 * DNS error, refused connection, or timeout).
 * @param run - Whether the run succeeded and the HTTP status it got
 * @returns The outcome followed by the HTTP status, or "No response"
 */
export function describeScreenshotRunOutcome(run: ScreenshotRunOutcomeFields): string {
  const outcome = run.succeeded ? "Succeeded" : "Failed";
  const pageGaveNoResponse = run.httpStatus === null;
  const responseText = pageGaveNoResponse ? "No response" : `HTTP ${String(run.httpStatus)}`;
  return `${outcome} · ${responseText}`;
}

/**
 * Formats a run's navigation time in seconds with one decimal, e.g. "1.2 s".
 * @param durationMs - The duration in milliseconds
 * @returns The duration in seconds, rounded to one decimal place
 */
export function formatRunDuration(durationMs: number): string {
  const durationSeconds = durationMs / 1000;
  return `${durationSeconds.toFixed(1)} s`;
}
