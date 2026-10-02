import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App";
import {
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  countRequests,
  stubFetchRoutes,
  type FetchStub,
} from "./support/frontendTestHelpers";

describe("App", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", uptime: 42.7 }),
    } as unknown as Response);
    window.history.pushState({}, "", "/");
  });

  it("routes / to the homepage", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Hello World" })).toBeInTheDocument();
    expect(await screen.findByText("ok")).toBeInTheDocument();
  });

  it("requests the health endpoint through the relative /api path", async () => {
    render(<App />);
    await screen.findByText("ok");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/health");
  });
});

/**
 * Stubs every GET the app's pages make for one website ("Example") that has
 * one use case ("Log in") and one action ("Submit credentials").
 * @returns The installed fetch stub
 */
function stubEveryPageRequest(): FetchStub {
  return stubFetchRoutes({
    "GET /api/health": { status: 200, body: { status: "ok", uptime: 1 } },
    "GET /api/websites": { status: 200, body: [buildWebsiteRecord()] },
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

  it.each([
    { path: "/websites", heading: "Websites" },
    { path: "/websites/new", heading: "New website" },
    { path: "/websites/website-1", heading: "Example" },
    { path: "/websites/website-1/edit", heading: "Edit website" },
    { path: "/websites/website-1/use-cases/new", heading: "New use case" },
    { path: "/websites/website-1/use-cases/use-case-1", heading: "Log in" },
    { path: "/websites/website-1/use-cases/use-case-1/edit", heading: "Edit use case" },
    { path: "/websites/website-1/actions/new", heading: "New action" },
    { path: "/websites/website-1/actions/action-1", heading: "Submit credentials" },
    { path: "/websites/website-1/actions/action-1/edit", heading: "Edit action" },
  ])("routes $path to the page headed '$heading'", async ({ path, heading }) => {
    stubEveryPageRequest();
    window.history.pushState({}, "", path);

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    const appHeader = screen.getByRole("banner");
    expect(within(appHeader).getByRole("link", { name: "Websites" })).toHaveAttribute(
      "href",
      "/websites",
    );
  });

  it("matches /websites/new to the create form, not to a website with the id 'new'", async () => {
    const fetchStub = stubEveryPageRequest();
    window.history.pushState({}, "", "/websites/new");

    render(<App />);

    expect(await screen.findByRole("button", { name: "Create website" })).toBeDisabled();
    expect(countRequests(fetchStub, "GET", "/api/websites/new")).toBe(0);
  });

  it("navigates from the homepage to the website list through the header's Websites link", async () => {
    const user = userEvent.setup();
    stubEveryPageRequest();
    render(<App />);
    await screen.findByText("ok");

    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "Websites" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Websites" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/websites");
  });

  it("navigates home through the header's app name", async () => {
    const user = userEvent.setup();
    stubEveryPageRequest();
    window.history.pushState({}, "", "/websites");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Websites" });

    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "easy-test" }));

    expect(await screen.findByRole("heading", { name: "Hello World" })).toBeInTheDocument();
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
