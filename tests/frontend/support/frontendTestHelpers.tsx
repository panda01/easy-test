import { type ReactElement, type ReactNode } from "react";
import { render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  type InitialEntry,
} from "react-router-dom";
import { expect, vi, type Mock } from "vitest";
import { type ActionScriptRunRecord } from "../../../src/hooks/useActionScriptRuns";
import {
  type ActionScriptRecord,
  type ActionScriptRefinementRecord,
} from "../../../src/hooks/useActionScripts";
import { type CrawledPageRecord } from "../../../src/hooks/useCrawledPage";
import {
  type CrawledPageSummaryRecord,
  type CrawlRunWithPagesRecord,
} from "../../../src/hooks/useCrawlRunProgress";
import { type CrawlRunRecord } from "../../../src/hooks/useCrawlRuns";
import { type CredentialRecord } from "../../../src/hooks/useCredentials";
import {
  type ScriptModelCatalog,
  type ScriptModelOption,
} from "../../../src/hooks/useScriptModels";
import { type ScreenshotRunRecord } from "../../../src/hooks/useScreenshotRuns";
import {
  type NewestActionScriptRecord,
  type WebsiteItemRecord,
} from "../../../src/hooks/useWebsiteItems";
import {
  type WebsiteRecord,
  type WebsiteSummaryRecord,
  type WebsiteWithSummaryRecord,
} from "../../../src/hooks/useWebsites";
import {
  ACTION_KIND,
  USE_CASE_KIND,
  type WebsiteItemKind,
} from "../../../src/utils/websiteItemKinds";

/*
 * Shared building blocks for the frontend specs. This file is not a spec (it
 * does not end in `.test.tsx`), so vitest only loads it through the specs that
 * import it.
 */

// === fetch stubbing ===

/** A canned JSON reply for one stubbed API route. */
export interface StubbedJsonReply {
  /** The HTTP status the stubbed response reports. */
  status: number;
  /** What `response.json()` resolves to; ignored for a 204. */
  body?: unknown;
}

/**
 * What a stubbed route answers with: a canned JSON reply, or a function that
 * produces the response itself (a deferred promise, a rejection, a body that
 * is not JSON, ...).
 */
export type StubbedRouteReply = StubbedJsonReply | (() => Promise<Response>);

/**
 * The routes a fetch stub answers, keyed by `"<METHOD> <url>"`, e.g.
 * `"GET /api/websites"`. The table is read on every call, so a test may add or
 * replace entries after installing the stub.
 */
export type StubbedRouteTable = Partial<Record<string, StubbedRouteReply>>;

/** The `vi.fn` installed as `globalThis.fetch`. */
export type FetchStub = Mock<typeof fetch>;

/**
 * Builds a fetch Response stand-in whose `json()` is a spy, so a test can
 * also assert that a 204 is never parsed.
 * @param status - The HTTP status to report; `ok` is derived from it
 * @param body - What `json()` resolves to (a 204's `json()` rejects instead)
 * @returns A Response-shaped object with `ok`, `status`, and a spied `json`
 */
export function buildJsonResponse(status: number, body?: unknown): Response {
  const statusIsSuccessful = status >= 200 && status < 300;
  const responseHasNoContent = status === 204;
  const readJsonBody = vi.fn((): Promise<unknown> => {
    if (responseHasNoContent) {
      return Promise.reject(new SyntaxError("Unexpected end of JSON input"));
    }
    return Promise.resolve(body);
  });
  return { ok: statusIsSuccessful, status, json: readJsonBody } as unknown as Response;
}

/**
 * Builds a fetch Response stand-in whose body is not JSON, like an HTML error
 * page from a proxy: `json()` rejects with a SyntaxError.
 * @param status - The HTTP status to report
 * @returns A Response-shaped object whose `json` rejects
 */
export function buildUnparseableResponse(status: number): Response {
  const statusIsSuccessful = status >= 200 && status < 300;
  const readJsonBody = vi.fn(
    (): Promise<unknown> => Promise.reject(new SyntaxError("Unexpected token '<'")),
  );
  return { ok: statusIsSuccessful, status, json: readJsonBody } as unknown as Response;
}

/**
 * Reads the url out of whatever was passed to fetch. The app always passes a
 * string, but the stub handles every input fetch accepts.
 * @param input - The first argument fetch was called with
 * @returns The requested url as a string
 */
function readRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Replaces `globalThis.fetch` with a `vi.fn` that answers by method + url from
 * `routeTable`. A request with no matching entry rejects with
 * "Unexpected fetch: <METHOD> <url>", which surfaces in the UI's error alert
 * and fails the test instead of passing silently.
 * @param routeTable - Replies keyed by `"<METHOD> <url>"`
 * @returns The installed stub, for asserting on its calls
 */
export function stubFetchRoutes(routeTable: StubbedRouteTable): FetchStub {
  const fetchStub = vi.fn<typeof fetch>((input, init) => {
    const requestMethod = init?.method ?? "GET";
    const routeKey = `${requestMethod} ${readRequestUrl(input)}`;
    const reply = routeTable[routeKey];
    const routeIsStubbed = reply !== undefined;
    if (!routeIsStubbed) {
      return Promise.reject(new Error(`Unexpected fetch: ${routeKey}`));
    }
    const replyIsAFunction = typeof reply === "function";
    if (replyIsAFunction) return reply();
    return Promise.resolve(buildJsonResponse(reply.status, reply.body));
  });
  globalThis.fetch = fetchStub;
  return fetchStub;
}

/**
 * Counts how many requests a fetch stub received for one method + url.
 * @param fetchStub - The stub installed by `stubFetchRoutes`
 * @param method - The HTTP method to count, e.g. "DELETE"
 * @param url - The exact url to count
 * @returns The number of matching calls
 */
export function countRequests(fetchStub: FetchStub, method: string, url: string): number {
  const matchingCalls = fetchStub.mock.calls.filter(([input, init]) => {
    const callMethod = init?.method ?? "GET";
    return callMethod === method && readRequestUrl(input) === url;
  });
  return matchingCalls.length;
}

/**
 * Makes `window.matchMedia` (which jsdom lacks) answer as a window `widthPx`
 * wide would, so `useIsNarrowerThan` - MUI's `useMediaQuery` - picks the
 * phone or the desktop layout. Only `min-width` / `max-width` queries are
 * read, which is all the theme's breakpoints produce. Without this stand-in
 * the hook reports false: the desktop layout.
 * @param widthPx - The window width to answer for, e.g. 390 for a phone
 * @returns A function that removes the stand-in again
 */
export function stubWindowWidth(widthPx: number): () => void {
  /**
   * Answers one media query for the stubbed width.
   * @param query - The media query, e.g. "(max-width:899.95px)"
   * @returns A media query list that never changes
   */
  const matchMediaStub = (query: string): MediaQueryList => {
    const maxWidthMatch = /max-width:\s*([\d.]+)px/.exec(query);
    const minWidthMatch = /min-width:\s*([\d.]+)px/.exec(query);
    const fitsMaxWidth = maxWidthMatch === null || widthPx <= Number(maxWidthMatch[1]);
    const fitsMinWidth = minWidthMatch === null || widthPx >= Number(minWidthMatch[1]);
    return {
      matches: fitsMaxWidth && fitsMinWidth,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    };
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMediaStub });
  return () => {
    Reflect.deleteProperty(window, "matchMedia");
  };
}

/** A promise plus the functions that settle it, for holding a request in flight. */
export interface Deferred<TValue> {
  /** The pending promise. */
  promise: Promise<TValue>;
  /** Fulfils `promise` with a value. */
  resolve: (value: TValue) => void;
  /** Rejects `promise` with a reason. */
  reject: (reason: unknown) => void;
}

/**
 * Creates a promise that settles only when the test says so. Lets a test
 * observe an in-flight state, or land a response after unmount / after a url
 * change to exercise a hook's `cancelled` guard.
 * @returns The pending promise and its resolve / reject functions
 */
export function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise: (value: TValue) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<TValue>((resolveOuter, rejectOuter) => {
    resolvePromise = resolveOuter;
    rejectPromise = rejectOuter;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

/**
 * Builds a fetch result that has already failed with `reason`, which may be a
 * non-Error value (fetch is not guaranteed to reject with an Error). Call it
 * inside a route reply so the rejection is handled as soon as it exists.
 * @param reason - What the request rejects with
 * @returns A promise rejected with `reason`
 */
export function createRejectedFetch(reason: unknown): Promise<Response> {
  const failedRequest = createDeferred<Response>();
  failedRequest.reject(reason);
  return failedRequest.promise;
}

// === record fixtures ===

/**
 * Builds a website as the API returns it, with sensible defaults.
 * @param overrides - Fields to replace in the default website
 * @returns A complete website record
 */
export function buildWebsiteRecord(overrides: Partial<WebsiteRecord> = {}): WebsiteRecord {
  return {
    id: "website-1",
    url: "https://example.com",
    name: "Example",
    description: "The example site",
    networkIdleTimeoutMs: 5000,
    screenshotMinimumWaitMs: 1,
    loginUrl: "https://example.com/login",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-03T03:04:05.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds a website's dashboard summary as the website LIST returns it: by
 * default no actions, no runs, and never crawled.
 * @param overrides - Fields to replace in the default summary
 * @returns A complete website summary record
 */
export function buildWebsiteSummaryRecord(
  overrides: Partial<WebsiteSummaryRecord> = {},
): WebsiteSummaryRecord {
  return {
    actionCount: 0,
    passedActionCount: 0,
    failedActionCount: 0,
    notRunActionCount: 0,
    latestRunAt: null,
    latestCrawlRun: null,
    ...overrides,
  };
}

/**
 * Builds a website as the website LIST returns it: `buildWebsiteRecord` plus
 * its dashboard summary.
 * @param overrides - Fields to replace in the default website
 * @param summaryOverrides - Fields to replace in the default summary
 * @returns A complete website-with-summary record
 */
export function buildWebsiteWithSummaryRecord(
  overrides: Partial<WebsiteRecord> = {},
  summaryOverrides: Partial<WebsiteSummaryRecord> = {},
): WebsiteWithSummaryRecord {
  return { ...buildWebsiteRecord(overrides), summary: buildWebsiteSummaryRecord(summaryOverrides) };
}

/**
 * Builds an action's newest version as the action LIST returns it: by
 * default version 1, generated from the default action's text (so it is not
 * out of date), and not run yet.
 * @param overrides - Fields to replace in the default newest version
 * @returns A complete newest-version record
 */
export function buildNewestActionScriptRecord(
  overrides: Partial<NewestActionScriptRecord> = {},
): NewestActionScriptRecord {
  return {
    id: "script-1",
    versionNumber: 1,
    actionTitle: "Log in",
    actionDescription: "Sign in with a valid account",
    credentialId: null,
    latestRun: null,
    ...overrides,
  };
}

/**
 * Builds a use case or action as the API returns it, with sensible defaults.
 * @param overrides - Fields to replace in the default item
 * @returns A complete website item record
 */
export function buildWebsiteItemRecord(
  overrides: Partial<WebsiteItemRecord> = {},
): WebsiteItemRecord {
  return {
    id: "item-1",
    websiteId: "website-1",
    title: "Log in",
    description: "Sign in with a valid account",
    createdAt: "2026-02-02T03:04:05.000Z",
    updatedAt: "2026-02-03T03:04:05.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds a screenshot run as the API returns it: by default a successful
 * HTTP 200 visit of website-1 that captured a screenshot.
 * @param overrides - Fields to replace in the default run
 * @returns A complete screenshot run record
 */
export function buildScreenshotRunRecord(
  overrides: Partial<ScreenshotRunRecord> = {},
): ScreenshotRunRecord {
  return {
    id: "screenshot-run-1",
    websiteId: "website-1",
    requestedUrl: "https://example.com",
    succeeded: true,
    httpStatus: 200,
    errorMessage: null,
    screenshotFileName: "website-1/screenshot-run-1.png",
    durationMs: 1234,
    createdAt: "2026-03-02T03:04:05.000Z",
    updatedAt: "2026-03-02T03:04:05.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds a crawl run (without pages) as the API returns it: by default a
 * finished crawl of website-1 that visited 3 pages.
 * @param overrides - Fields to replace in the default run
 * @returns The crawl run record
 */
export function buildCrawlRunRecord(overrides: Partial<CrawlRunRecord> = {}): CrawlRunRecord {
  return {
    id: "crawl-run-1",
    websiteId: "website-1",
    credentialId: null,
    isLoggedIn: false,
    credential: null,
    buttonMode: "linksOnly",
    startUrl: "https://example.com/",
    status: "finished",
    pageLimit: 50,
    visitedPageCount: 3,
    waitingUrlCount: 0,
    errorMessage: null,
    loginFailureScreenshotFileName: null,
    durationMs: 6400,
    finishedAt: "2026-03-04T05:06:13.000Z",
    createdAt: "2026-03-04T05:06:07.000Z",
    updatedAt: "2026-03-04T05:06:13.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds a website credential as the API returns it (never with a password):
 * by default "Admin" on website-1, logging in at its /login page with the
 * fields found automatically.
 * @param overrides - Fields to replace in the default credential
 * @returns The credential record
 */
export function buildCredentialRecord(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: "credential-1",
    websiteId: "website-1",
    name: "Admin",
    description: "The admin account",
    username: "admin@example.com",
    loginUrl: "https://example.com/login",
    usernameSelector: null,
    passwordSelector: null,
    submitSelector: null,
    hasPassword: true,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds a crawled page summary as the run's page list returns it: by
 * default the start page of crawl-run-1, loaded with HTTP 200.
 * @param overrides - Fields to replace in the default page
 * @returns The page summary record
 */
export function buildCrawledPageSummaryRecord(
  overrides: Partial<CrawledPageSummaryRecord> = {},
): CrawledPageSummaryRecord {
  return {
    id: "crawled-page-1",
    crawlRunId: "crawl-run-1",
    websiteId: "website-1",
    parentPageId: null,
    url: "https://example.com/",
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    wasRedirected: false,
    foundByButtonText: null,
    visitOrder: 0,
    depth: 0,
    succeeded: true,
    httpStatus: 200,
    errorMessage: null,
    title: "Example",
    durationMs: 900,
    createdAt: "2026-03-04T05:06:08.000Z",
    updatedAt: "2026-03-04T05:06:08.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds a full crawled page (snapshot and links included), by default the
 * default summary with a one-line snapshot and no links.
 * @param overrides - Fields to replace in the default page
 * @returns The full page record
 */
export function buildCrawledPageRecord(
  overrides: Partial<CrawledPageRecord> = {},
): CrawledPageRecord {
  return {
    ...buildCrawledPageSummaryRecord(),
    ariaSnapshot: '- heading "Example" [level=1]',
    linkedUrls: [],
    buttonUrls: [],
    ...overrides,
  };
}

/**
 * Builds a crawl run with its pages, as the run endpoint returns it: by
 * default the default run with no pages.
 * @param overrides - Fields to replace in the default run, `pages` included
 * @returns The crawl run with its pages
 */
export function buildCrawlRunWithPagesRecord(
  overrides: Partial<CrawlRunWithPagesRecord> = {},
): CrawlRunWithPagesRecord {
  return { ...buildCrawlRunRecord(), pages: [], ...overrides };
}

/**
 * Builds an action plan version as the API returns it: by default a
 * generated, logged-out plan for action item-1 of website-1, with one
 * assumption, two steps, one page given to Claude, and no runs yet.
 * @param overrides - Fields to replace in the default script
 * @returns A complete action script record
 */
export function buildActionScriptRecord(
  overrides: Partial<ActionScriptRecord> = {},
): ActionScriptRecord {
  return {
    id: "script-1",
    websiteId: "website-1",
    actionId: "item-1",
    websiteName: "Example",
    startUrl: "https://example.com",
    actionTitle: "Log in",
    actionDescription: "Sign in with a valid account",
    credentialId: null,
    credentialName: null,
    summary: "Opens the site and signs in.",
    assumptions: ["The sign-in button is labelled Sign in"],
    plan: {
      name: "Log in",
      startUrl: "https://example.com/",
      steps: [
        { action: "click", target: { role: "link", name: "Sign in" }, value: null },
        { action: "expectVisible", target: { role: "heading", name: "Welcome" }, value: null },
      ],
    },
    contextPageUrls: ["https://example.com/"],
    modelId: "claude-opus-5-5",
    effort: "high",
    editedFromActionScriptId: null,
    refinement: null,
    latestRun: null,
    createdAt: "2026-04-02T03:04:05.000Z",
    updatedAt: "2026-04-02T03:04:05.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds the refinement record a refined version carries, as the API returns
 * it: by default script-2 refined from script-1's run script-run-1, which
 * failed at step 2 with a failing page snapshot captured, with a note, the
 * screenshot sent, and some token usage.
 * @param overrides - Fields to replace in the default refinement
 * @returns A complete action script refinement record
 */
export function buildActionScriptRefinementRecord(
  overrides: Partial<ActionScriptRefinementRecord> = {},
): ActionScriptRefinementRecord {
  return {
    id: "refinement-1",
    websiteId: "website-1",
    actionId: "item-1",
    sourceActionScriptId: "script-1",
    actionScriptRunId: "script-run-1",
    refinedActionScriptId: "script-2",
    note: "The link is called Profile now",
    inputTokens: 2408,
    outputTokens: 989,
    cacheReadInputTokens: 9519,
    cacheCreationInputTokens: 1292,
    screenshotWasSent: true,
    createdAt: "2026-04-04T03:04:05.000Z",
    updatedAt: "2026-04-04T03:04:05.000Z",
    deletedAt: null,
    actionScriptRun: {
      id: "script-run-1",
      errorMessage: 'Step 2 (Click link "Account"): Timeout 10000ms exceeded.',
      failedStepNumber: 2,
      timedOut: false,
      failingPageAriaSnapshot: '- link "Profile"',
    },
    ...overrides,
  };
}

/**
 * Builds an action script run as the API returns it: by default a passing
 * run of script-1 with a two-line step log and no failure screenshot.
 * @param overrides - Fields to replace in the default run
 * @returns A complete action script run record
 */
export function buildActionScriptRunRecord(
  overrides: Partial<ActionScriptRunRecord> = {},
): ActionScriptRunRecord {
  return {
    id: "script-run-1",
    websiteId: "website-1",
    actionId: "item-1",
    actionScriptId: "script-1",
    succeeded: true,
    timedOut: false,
    errorMessage: null,
    failedStepNumber: null,
    credentialName: null,
    output: "▶ Open the site\n✔ Use case completed\n",
    outputWasTruncated: false,
    failureScreenshotFileName: null,
    failingPageUrl: null,
    failingPageAriaSnapshot: null,
    durationMs: 4321,
    createdAt: "2026-04-03T03:04:05.000Z",
    updatedAt: "2026-04-03T03:04:05.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Builds one model as `GET /api/script-models` describes it: by default
 * Claude Opus 5.5 with every effort level and the Opus 4.8 fallback.
 * @param overrides - Fields to replace in the default model
 * @returns A complete script model option
 */
export function buildScriptModelOption(
  overrides: Partial<ScriptModelOption> = {},
): ScriptModelOption {
  return {
    id: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    fallbackModel: { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
    ...overrides,
  };
}

/**
 * Builds the model catalog `GET /api/script-models` answers with: by default
 * three models - Claude Opus 5.5 (all levels, Opus 4.8 fallback), Claude Opus
 * 4.6 (no xhigh, no fallback), and Claude Haiku 4.5 (no effort setting) -
 * starting on Opus 5.5 at high.
 * @param overrides - Fields to replace in the default catalog
 * @returns A complete model catalog
 */
export function buildScriptModelCatalog(
  overrides: Partial<ScriptModelCatalog> = {},
): ScriptModelCatalog {
  return {
    models: [
      buildScriptModelOption(),
      buildScriptModelOption({
        id: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        effortLevels: ["low", "medium", "high", "max"],
        fallbackModel: null,
      }),
      buildScriptModelOption({
        id: "claude-haiku-4-5-20251001",
        displayName: "Claude Haiku 4.5",
        effortLevels: [],
        supportsAdaptiveThinking: false,
        fallbackModel: null,
      }),
    ],
    defaultModelId: "claude-opus-5-5",
    defaultEffort: "high",
    ...overrides,
  };
}

// === item kinds ===

/**
 * One item kind with the literal text and URL segment the UI is expected to
 * use for it, so the specs check the kind config instead of echoing it.
 */
export interface ItemKindTestCase {
  /** The kind passed to the page or component under test. */
  itemKind: WebsiteItemKind;
  /** The expected URL segment: "use-cases" or "actions". */
  segment: string;
  /** The expected lowercase singular: "use case" or "action". */
  singularLabel: string;
  /** The expected capitalized singular: "Use case" or "Action". */
  singularTitle: string;
  /** The "... not found" text the server answers for an unknown item. */
  notFoundText: string;
}

/** The use case and action variants, for `describe.each`. */
export const ITEM_KIND_TEST_CASES: ItemKindTestCase[] = [
  {
    itemKind: USE_CASE_KIND,
    segment: "use-cases",
    singularLabel: "use case",
    singularTitle: "Use case",
    notFoundText: "Use case not found",
  },
  {
    itemKind: ACTION_KIND,
    segment: "actions",
    singularLabel: "action",
    singularTitle: "Action",
    notFoundText: "Action not found",
  },
];

// === routing ===

/**
 * Shows where the router currently is, so a test can assert where navigation
 * landed and HOW it got there: "PUSH", "REPLACE", or "POP" (a history
 * go(-1)). Its "Probe: go back" button steps back one entry, which reveals
 * the entry underneath.
 * @returns The probe's readouts and its back button
 */
export function LocationProbe(): ReactElement {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const locationState: unknown = location.state;

  /** Steps back one history entry, like the browser's Back button. */
  const handleBackClick = (): void => {
    void navigate(-1);
  };

  return (
    <div>
      <p data-testid="probe-pathname">{location.pathname}</p>
      <p data-testid="probe-state">{JSON.stringify(locationState ?? null)}</p>
      <p data-testid="probe-navigation-type">{navigationType}</p>
      <button type="button" onClick={handleBackClick}>
        Probe: go back
      </button>
    </div>
  );
}

/** Where a `MemoryRouter` starts: its history entries and the current one. */
export interface RouterStart {
  /** The history stack, oldest first; strings or `{ pathname, state }` objects. */
  initialEntries: InitialEntry[];
  /** Which entry is current; defaults to the last one. */
  initialIndex?: number;
}

/**
 * Renders the given routes inside a `MemoryRouter`, plus a catch-all route
 * that renders `LocationProbe`. Any navigation away from the page under test
 * therefore lands on the probe, which reports the new path, its state, and
 * the navigation type.
 * @param pageRoutes - `<Route>` elements using the real patterns from App.tsx
 * @param routerStart - The initial history entries and current index
 * @returns The Testing Library render result
 */
export function renderPageRoutes(pageRoutes: ReactNode, routerStart: RouterStart): RenderResult {
  return render(
    <MemoryRouter initialEntries={routerStart.initialEntries} initialIndex={routerStart.initialIndex}>
      <Routes>
        {pageRoutes}
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** What the probe reports after a navigation has landed. */
export interface ProbeReading {
  /** The current pathname. */
  pathname: string;
  /** The current entry's state, JSON-encoded ("null" when there is none). */
  state: string;
  /** How the router got here: "PUSH", "REPLACE", or "POP". */
  navigationType: string;
}

/**
 * Waits for the `LocationProbe` to show `expectedPathname` and returns
 * everything it reports.
 * @param expectedPathname - The pathname navigation should land on
 * @returns The probe's pathname, state, and navigation type
 */
export async function readProbeAfterLanding(expectedPathname: string): Promise<ProbeReading> {
  await waitFor(() => {
    expect(screen.getByTestId("probe-pathname").textContent).toBe(expectedPathname);
  });
  return {
    pathname: screen.getByTestId("probe-pathname").textContent,
    state: screen.getByTestId("probe-state").textContent,
    navigationType: screen.getByTestId("probe-navigation-type").textContent,
  };
}

// === page structure ===

/** One rendered breadcrumb: its text, and its href when it is a link. */
export interface RenderedBreadcrumb {
  /** The crumb's visible text. */
  label: string;
  /** The link target, or null for the plain-text current page. */
  href: string | null;
}

/**
 * Reads the page's breadcrumb trail (the `Breadcrumb` navigation landmark)
 * in order, skipping the decorative separators.
 * @returns Each crumb's label and href (null for the plain-text last crumb)
 */
export function readBreadcrumbTrail(): RenderedBreadcrumb[] {
  const breadcrumbNavigation = screen.getByRole("navigation", { name: "Breadcrumb" });
  const crumbItems = within(breadcrumbNavigation).getAllByRole("listitem");
  return crumbItems.map((crumbItem) => {
    const crumbLink = within(crumbItem).queryByRole("link");
    return {
      label: crumbItem.textContent,
      href: crumbLink === null ? null : crumbLink.getAttribute("href"),
    };
  });
}
