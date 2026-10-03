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
import { type ActionScriptRecord } from "../../../src/hooks/useActionScripts";
import { type ScreenshotRunRecord } from "../../../src/hooks/useScreenshotRuns";
import { type WebsiteItemRecord } from "../../../src/hooks/useWebsiteItems";
import { type WebsiteRecord } from "../../../src/hooks/useWebsites";
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
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-03T03:04:05.000Z",
    deletedAt: null,
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
 * Builds an action script version as the API returns it: by default a clean
 * script for action item-1 of website-1, with one assumption.
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
    summary: "Opens the site and signs in.",
    assumptions: ["The sign-in button is labelled Sign in"],
    code: "import { chromium } from 'playwright';\n// script-1 steps\n",
    ruleViolations: [],
    modelId: "claude-opus-5-5",
    createdAt: "2026-04-02T03:04:05.000Z",
    updatedAt: "2026-04-02T03:04:05.000Z",
    deletedAt: null,
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
    exitCode: 0,
    exitSignal: null,
    timedOut: false,
    output: "▶ Open the site\n✔ Use case completed\n",
    outputWasTruncated: false,
    failureScreenshotFileName: null,
    durationMs: 4321,
    createdAt: "2026-04-03T03:04:05.000Z",
    updatedAt: "2026-04-03T03:04:05.000Z",
    deletedAt: null,
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
