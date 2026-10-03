import {
  createCrawlRunForWebsite,
  finishCrawlRun,
  markRunningCrawlRunsInterrupted,
  recordCrawledPage,
  type CrawlRun,
  type CrawledPageInput,
  type CrawlProgress,
  type Website,
} from "./dbService.js";
import { CRAWL_PAGE_LIMIT, crawlWebsite } from "./crawlerService.js";
import { measureElapsedMs } from "./playwrightService.js";
import { describeError } from "../utils/describeError.js";

/**
 * The websites with a crawl running in THIS process. Checked and updated
 * synchronously - before any `await` - so two requests that arrive together
 * cannot both start a crawl: Node runs one request's synchronous code to the
 * end before the other's.
 */
const websiteIdsBeingCrawled = new Set<string>();

/** Why a run whose browser closed mid-crawl was interrupted. */
const BROWSER_CLOSED_MESSAGE =
  "The browser closed mid-crawl - most likely the server restarted.";

/** What `startCrawlRun` did. */
export type CrawlRunStart =
  | {
      /** False: a crawl of this website is already running, so nothing was started. */
      crawlStarted: false;
    }
  | {
      /** True: the run was created and the crawl is working in the background. */
      crawlStarted: true;
      /** The new run, as created (`status: "running"`). */
      crawlRun: CrawlRun;
      /** Resolves once the background crawl has ended and been recorded; never rejects. */
      crawlCompletion: Promise<void>;
    };

/**
 * Records a crawl that broke as `failed`. If even that write fails (e.g. the
 * database went away), the failure is logged instead: this runs in the
 * background, where a rejection would be unhandled and crash the server.
 * @param crawlRun - The run that broke
 * @param crawlStartedAt - The `performance.now()` reading taken when the crawl began
 * @param crawlError - Why the crawl broke
 * @returns Resolves once the failure is recorded or logged
 */
async function recordCrawlFailure(
  crawlRun: CrawlRun,
  crawlStartedAt: number,
  crawlError: unknown,
): Promise<void> {
  try {
    await finishCrawlRun(crawlRun.websiteId, crawlRun.id, {
      status: "failed",
      waitingUrlCount: 0,
      errorMessage: describeError(crawlError),
      durationMs: measureElapsedMs(crawlStartedAt),
    });
  } catch (recordError: unknown) {
    console.error(
      `[crawl] crawl run ${crawlRun.id} failed (${describeError(crawlError)}) and could not be marked failed: ${describeError(recordError)}`,
    );
  }
}

/**
 * Runs one crawl to the end in the background and records it: each page as
 * it is visited, then how the crawl ended.
 *
 * NEVER rejects - every failure becomes a `failed` run (or a log line) -
 * because nothing awaits it in production. When the run was deleted with its
 * website mid-crawl, nothing more is written. When the browser closed
 * mid-crawl (a server restart: Playwright closes it on SIGTERM), the run is
 * finished as `interrupted` right away, before the process exits. The website's id is released
 * from `websiteIdsBeingCrawled` when it ends, whatever happened.
 * @param website - The website being crawled
 * @param crawlRun - Its run, created `running`
 * @returns Resolves once the crawl has ended and been recorded
 */
async function runCrawlInBackground(website: Website, crawlRun: CrawlRun): Promise<void> {
  const crawlStartedAt = performance.now();

  /**
   * Saves one visited page on this run.
   * @param visitedPage - What visiting the page produced
   * @param progress - The run's counters after this page
   * @returns The saved page's id, or null when the run is no longer active
   */
  const recordVisitedPage = async (
    visitedPage: CrawledPageInput,
    progress: CrawlProgress,
  ): Promise<string | null> => {
    const recordedPage = await recordCrawledPage(website.id, crawlRun.id, progress, visitedPage);
    return recordedPage?.id ?? null;
  };

  try {
    const crawlOutcome = await crawlWebsite(
      website.url,
      {
        networkIdleTimeoutMs: website.networkIdleTimeoutMs,
        screenshotMinimumWaitMs: website.screenshotMinimumWaitMs,
      },
      recordVisitedPage,
    );
    const { stopReason } = crawlOutcome;
    const runWasDeleted = stopReason === "stoppedBecauseRunWasDeleted";
    if (runWasDeleted) {
      return;
    }
    const browserClosed = stopReason === "stoppedBecauseBrowserClosed";
    await finishCrawlRun(website.id, crawlRun.id, {
      // The crawler's other stop reasons are spelled exactly like the statuses.
      status: browserClosed ? "interrupted" : stopReason,
      waitingUrlCount: crawlOutcome.waitingUrlCount,
      errorMessage: browserClosed ? BROWSER_CLOSED_MESSAGE : null,
      durationMs: measureElapsedMs(crawlStartedAt),
    });
  } catch (crawlError: unknown) {
    await recordCrawlFailure(crawlRun, crawlStartedAt, crawlError);
  } finally {
    websiteIdsBeingCrawled.delete(website.id);
  }
}

/**
 * Starts crawling a website in the background, unless a crawl of it is
 * already running in this process.
 *
 * The website's id is claimed synchronously, before anything is awaited, so
 * two simultaneous requests cannot both start one. The run is then created
 * (`status: "running"`, page limit `CRAWL_PAGE_LIMIT`) and the crawl starts
 * WITHOUT being awaited: the caller answers at once, and the UI polls the run
 * for progress.
 * @param website - The active website to crawl
 * @returns Whether a crawl was started; when it was, the new run and a promise for the crawl's end (for tests - production ignores it)
 * @throws When the run cannot be created (the claim is released first)
 */
export async function startCrawlRun(website: Website): Promise<CrawlRunStart> {
  const crawlIsAlreadyRunning = websiteIdsBeingCrawled.has(website.id);
  if (crawlIsAlreadyRunning) {
    return { crawlStarted: false };
  }
  websiteIdsBeingCrawled.add(website.id);

  let crawlRun: CrawlRun;
  try {
    crawlRun = await createCrawlRunForWebsite(website.id, {
      startUrl: website.url,
      pageLimit: CRAWL_PAGE_LIMIT,
    });
  } catch (error: unknown) {
    websiteIdsBeingCrawled.delete(website.id);
    throw error;
  }

  const crawlCompletion = runCrawlInBackground(website, crawlRun);
  return { crawlStarted: true, crawlRun, crawlCompletion };
}

/**
 * Marks every run left `running` by a previous server process as
 * `interrupted`. A crawl only runs inside the server process, so at boot
 * every `running` run was cut off by a restart (`tsx watch` restarts on every
 * server edit).
 *
 * `server.ts` awaits this BEFORE it starts listening, so it can never flip a
 * run this process just started. Never rejects: a failure is logged, and the
 * server still starts.
 * @returns Resolves once the runs are marked or the failure is logged
 */
export async function markUnfinishedCrawlRunsInterrupted(): Promise<void> {
  try {
    const interruptedRunCount = await markRunningCrawlRunsInterrupted();
    const someRunsWereInterrupted = interruptedRunCount > 0;
    if (someRunsWereInterrupted) {
      console.log(`[crawl] marked ${interruptedRunCount} unfinished crawl run(s) interrupted`);
    }
  } catch (error: unknown) {
    console.error(`[crawl] could not mark unfinished crawl runs interrupted: ${describeError(error)}`);
  }
}
