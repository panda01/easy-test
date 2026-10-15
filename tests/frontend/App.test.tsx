import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App";
import {
  buildCrawledPageRecord,
  buildCrawledPageSummaryRecord,
  buildCrawlRunWithPagesRecord,
  buildCredentialRecord,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  buildWebsiteWithSummaryRecord,
  countRequests,
  stubFetchRoutes,
  type FetchStub,
} from "./support/frontendTestHelpers";

/**
 * Stubs every GET the app's pages make for one website ("Example") that has
 * one use case ("Log in"), one action ("Submit credentials"), one
 * finished crawl ("crawl-run-1") of a single page, and one credential
 * ("credential-1").
 * @returns The installed fetch stub
 */
function stubEveryPageRequest(): FetchStub {
  return stubFetchRoutes({
    "GET /api/websites": { status: 200, body: [buildWebsiteWithSummaryRecord()] },
    "GET /api/websites/website-1": { status: 200, body: buildWebsiteRecord() },
    "GET /api/websites/website-1/use-cases": {
      status: 200,
      body: [buildWebsiteItemRecord({ id: "use-case-1", title: "Log in" })],
    },
    "GET /api/websites/website-1/actions": {
      status: 200,
      body: [buildWebsiteItemRecord({ id: "action-1", title: "Submit credentials" })],
    },
    "GET /api/websites/website-1/screenshot-runs": { status: 200, body: [] },
    "GET /api/websites/website-1/crawl-runs": { status: 200, body: [] },
    "GET /api/websites/website-1/credentials": { status: 200, body: [buildCredentialRecord()] },
    "GET /api/websites/website-1/credentials/credential-1": {
      status: 200,
      body: buildCredentialRecord(),
    },
    "GET /api/websites/website-1/crawl-runs/crawl-run-1": {
      status: 200,
      body: buildCrawlRunWithPagesRecord({ pages: [buildCrawledPageSummaryRecord()] }),
    },
    "GET /api/websites/website-1/crawl-runs/crawl-run-1/pages/crawled-page-1": {
      status: 200,
      body: buildCrawledPageRecord(),
    },
    "GET /api/websites/website-1/use-cases/use-case-1": {
      status: 200,
      body: buildWebsiteItemRecord({ id: "use-case-1", title: "Log in" }),
    },
    "GET /api/websites/website-1/actions/action-1": {
      status: 200,
      body: buildWebsiteItemRecord({ id: "action-1", title: "Submit credentials" }),
    },
  });
}

describe("App routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("routes / to the websites dashboard, through the relative /api path", async () => {
    const fetchStub = stubEveryPageRequest();

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Websites" })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Websites" })).toHaveTextContent("Example");
    expect(countRequests(fetchStub, "GET", "/api/websites")).toBe(1);
  });

  it("redirects the old /websites list URL to the dashboard, replacing it in history", async () => {
    stubEveryPageRequest();
    window.history.pushState({}, "", "/websites");
    const historyLengthBeforeRender = window.history.length;

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Websites" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(window.history.length).toBe(historyLengthBeforeRender);
  });

  it.each([
    { path: "/", heading: "Websites" },
    { path: "/websites/new", heading: "New website" },
    { path: "/websites/website-1", heading: "Example" },
    { path: "/websites/website-1/edit", heading: "Edit website" },
    { path: "/websites/website-1/use-cases/new", heading: "New use case" },
    { path: "/websites/website-1/use-cases/use-case-1", heading: "Log in" },
    { path: "/websites/website-1/use-cases/use-case-1/edit", heading: "Edit use case" },
    { path: "/websites/website-1/actions/new", heading: "New action" },
    { path: "/websites/website-1/actions/action-1", heading: "Submit credentials" },
    { path: "/websites/website-1/actions/action-1/edit", heading: "Edit action" },
    { path: "/websites/website-1/crawl-runs/crawl-run-1", heading: "Crawl" },
    { path: "/websites/website-1/credentials/new", heading: "New credential" },
    { path: "/websites/website-1/credentials/credential-1/edit", heading: "Edit credential" },
  ])("routes $path to the page headed '$heading'", async ({ path, heading }) => {
    stubEveryPageRequest();
    window.history.pushState({}, "", path);

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    const appHeader = screen.getByRole("banner");
    expect(within(appHeader).getByRole("link", { name: "Easy Test" })).toHaveAttribute("href", "/");
    expect(within(appHeader).getByRole("link", { name: "Websites" })).toHaveAttribute("href", "/");
  });

  it("matches /websites/new to the create form, not to a website with the id 'new'", async () => {
    const fetchStub = stubEveryPageRequest();
    window.history.pushState({}, "", "/websites/new");

    render(<App />);

    expect(await screen.findByRole("button", { name: "Create website" })).toBeDisabled();
    expect(countRequests(fetchStub, "GET", "/api/websites/new")).toBe(0);
  });

  it("navigates from a website's page to the dashboard through the header's Websites link", async () => {
    const user = userEvent.setup();
    stubEveryPageRequest();
    window.history.pushState({}, "", "/websites/website-1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Example" });

    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "Websites" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Websites" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("navigates home through the header's Easy Test name", async () => {
    const user = userEvent.setup();
    stubEveryPageRequest();
    window.history.pushState({}, "", "/websites/new");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "New website" });

    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "Easy Test" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Websites" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("mounts a fresh item page when Back moves from an action to a use case (keyed routes)", async () => {
    const user = userEvent.setup();
    stubEveryPageRequest();
    window.history.pushState({}, "", "/websites/website-1/use-cases/use-case-1");
    window.history.pushState({}, "", "/websites/website-1/actions/action-1");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Submit credentials" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("dialog", { name: "Delete action?" })).toBeInTheDocument();

    act(() => {
      window.history.back();
    });

    // Reusing the action page's instance would carry its open dialog over.
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/websites/website-1/use-cases/use-case-1");
  });
});
