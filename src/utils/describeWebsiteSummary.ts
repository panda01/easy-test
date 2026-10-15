import { describeActionCount } from "./describeActionStatus";
import { formatCount } from "./formatCount";
import { formatRelativeTime } from "./formatRelativeTime";
import {
  type WebsiteLatestCrawlRunRecord,
  type WebsiteWithSummaryRecord,
} from "../hooks/useWebsites";

/**
 * Words a website's newest crawl for the dashboard's "Last crawl" column:
 * - none: "Never crawled";
 * - running: "Crawl running · 12 of 50";
 * - failed or interrupted: "Crawl failed · 2 h ago" / "Crawl interrupted · 2 h ago";
 * - otherwise (finished, or stopped at a limit): "46 pages · 2 h ago".
 * @param latestCrawlRun - The website's newest crawl, or null
 * @param now - The current moment, for the relative time
 * @returns The crawl line
 */
export function describeLatestCrawl(
  latestCrawlRun: WebsiteLatestCrawlRunRecord | null,
  now: Date,
): string {
  if (latestCrawlRun === null) {
    return "Never crawled";
  }
  const { status, visitedPageCount, pageLimit, createdAt, finishedAt } = latestCrawlRun;
  if (status === "running") {
    return `Crawl running · ${String(visitedPageCount)} of ${String(pageLimit)}`;
  }
  const endedText = formatRelativeTime(finishedAt ?? createdAt, now);
  if (status === "failed") {
    return `Crawl failed · ${endedText}`;
  }
  if (status === "interrupted") {
    return `Crawl interrupted · ${endedText}`;
  }
  return `${formatCount(visitedPageCount, "page", "pages")} · ${endedText}`;
}

/**
 * Finds when any website's scripts last ran.
 * @param websites - The websites with their summaries
 * @returns The newest `latestRunAt` among them, or null when no script has run
 */
function findNewestRunAt(websites: readonly WebsiteWithSummaryRecord[]): string | null {
  let newestRunAt: string | null = null;
  for (const website of websites) {
    const { latestRunAt } = website.summary;
    const thisRunIsNewer =
      latestRunAt !== null && (newestRunAt === null || Date.parse(latestRunAt) > Date.parse(newestRunAt));
    if (thisRunIsNewer) {
      newestRunAt = latestRunAt;
    }
  }
  return newestRunAt;
}

/**
 * Words the dashboard's totals line: "4 sites · 16 actions", plus " · last
 * run 12 min ago" when asked for and some script has run.
 * @param websites - The websites with their summaries
 * @param now - The current moment, for the relative time
 * @param includesLatestRun - True to add when a script last ran (the desktop line); false for the shorter mobile line
 * @returns The totals line
 */
export function describeDashboardTotals(
  websites: readonly WebsiteWithSummaryRecord[],
  now: Date,
  includesLatestRun: boolean,
): string {
  const totalActionCount = websites.reduce(
    (actionCountSoFar, website) => actionCountSoFar + website.summary.actionCount,
    0,
  );
  const totalsText = `${formatCount(websites.length, "site", "sites")} · ${describeActionCount(totalActionCount)}`;
  const newestRunAt = findNewestRunAt(websites);
  const latestRunIsShown = includesLatestRun && newestRunAt !== null;
  return latestRunIsShown
    ? `${totalsText} · last run ${formatRelativeTime(newestRunAt, now)}`
    : totalsText;
}
