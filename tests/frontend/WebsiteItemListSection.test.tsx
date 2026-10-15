import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemListSection from "../../src/components/WebsiteItemListSection";
import { type JsonResourceState } from "../../src/hooks/useJsonResource";
import { type WebsiteItemRecord } from "../../src/hooks/useWebsiteItems";
import { ACTION_KIND, USE_CASE_KIND, type WebsiteItemKind } from "../../src/utils/websiteItemKinds";
import {
  buildNewestActionScriptRecord,
  buildWebsiteItemRecord,
  readProbeAfterLanding,
  renderPageRoutes,
} from "./support/frontendTestHelpers";

const WEBSITE_PATH = "/websites/website-1";

/** "Now" for every spec, so "12 min ago" reads the same on every run. */
const NOW = new Date("2026-10-13T14:30:00.000Z");

/**
 * Renders one section on the website's detail route, so its links can be
 * followed onto the location probe.
 * @param itemKind - Which kind of item the section lists
 * @param itemsResource - The list request state to render
 * @param isPhoneLayout - True to render the phone layout (no heading, compact rows)
 * @returns The Testing Library render result
 */
function renderSection(
  itemKind: WebsiteItemKind,
  itemsResource: JsonResourceState<WebsiteItemRecord[]>,
  isPhoneLayout = false,
): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId"
      element={
        <WebsiteItemListSection
          itemKind={itemKind}
          websiteId="website-1"
          itemsResource={itemsResource}
          returnToHereState={{ returnTo: WEBSITE_PATH }}
          isPhoneLayout={isPhoneLayout}
        />
      }
    />,
    { initialEntries: [WEBSITE_PATH] },
  );
}

/**
 * Wraps a loaded item list in the request state the section takes.
 * @param items - The loaded items
 * @returns A loaded list request
 */
function loadedItems(items: WebsiteItemRecord[]): JsonResourceState<WebsiteItemRecord[]> {
  return { data: items, isLoading: false, errorMessage: null };
}

/** Four actions, one per status: passed 12 minutes ago, failed at step 9, timed out, and not run (no versions). */
const actionsOfEveryStatus: WebsiteItemRecord[] = [
  buildWebsiteItemRecord({
    id: "action-passing",
    title: "Log in",
    description: "Sign in with a valid account",
    credentialId: "credential-1",
    credential: { id: "credential-1", name: "Admin" },
    newestScript: buildNewestActionScriptRecord({
      versionNumber: 6,
      credentialId: "credential-1",
      latestRun: {
        id: "run-a",
        succeeded: true,
        failedStepNumber: null,
        timedOut: false,
        createdAt: "2026-10-13T14:18:00.000Z",
      },
    }),
  }),
  buildWebsiteItemRecord({
    id: "action-failing",
    title: "Book a class",
    description: "Reserve a spot",
    credentialId: null,
    credential: null,
    newestScript: buildNewestActionScriptRecord({
      versionNumber: 5,
      actionTitle: "Book a class",
      actionDescription: "Reserve a spot",
      latestRun: {
        id: "run-b",
        succeeded: false,
        failedStepNumber: 9,
        timedOut: false,
        createdAt: "2026-10-13T14:06:00.000Z",
      },
    }),
  }),
  buildWebsiteItemRecord({
    id: "action-timed-out",
    title: "Update plan",
    description: "Switch a member to the annual plan",
    credentialId: null,
    credential: null,
    newestScript: buildNewestActionScriptRecord({
      versionNumber: 4,
      actionTitle: "Update plan",
      actionDescription: "Switch a member to the annual plan",
      latestRun: {
        id: "run-c",
        succeeded: false,
        failedStepNumber: null,
        timedOut: true,
        createdAt: "2026-10-13T13:30:00.000Z",
      },
    }),
  }),
  buildWebsiteItemRecord({ id: "action-without-versions", title: "Search", newestScript: null }),
];

/**
 * Reads the rows (links) of the section's list.
 * @param listName - The list's accessible name, "Actions" or "Use cases"
 * @returns The item links, in order
 */
function getItemLinks(listName: string): HTMLElement[] {
  return within(screen.getByRole("list", { name: listName })).getAllByRole("link");
}

describe.each([
  {
    itemKind: USE_CASE_KIND,
    heading: "Use cases",
    newLabel: "New use case",
    segment: "use-cases",
    loadingLabel: "Loading use cases",
    emptyText: "No use cases yet.",
  },
  {
    itemKind: ACTION_KIND,
    heading: "Actions",
    newLabel: "New action",
    segment: "actions",
    loadingLabel: "Loading actions",
    emptyText: "No actions yet.",
  },
])(
  "WebsiteItemListSection ($segment)",
  ({ itemKind, heading, newLabel, segment, loadingLabel, emptyText }) => {
    it("is a section named by its heading, with a New button linking to the create form", () => {
      renderSection(itemKind, loadedItems([]));

      const section = screen.getByRole("region", { name: heading });
      expect(within(section).getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: newLabel })).toHaveAttribute(
        "href",
        `/websites/website-1/${segment}/new`,
      );
    });

    it("is named without a heading on a phone, where its tab names it", () => {
      renderSection(itemKind, loadedItems([]), true);

      const section = screen.getByRole("region", { name: heading });
      expect(within(section).queryByRole("heading")).not.toBeInTheDocument();
      expect(within(section).getByRole("link", { name: newLabel })).toBeInTheDocument();
    });

    it.each([
      { layout: "desktop", isPhoneLayout: false },
      { layout: "phone", isPhoneLayout: true },
    ])("puts a plus on the New button on a $layout", ({ isPhoneLayout }) => {
      renderSection(itemKind, loadedItems([]), isPhoneLayout);

      const newItemLink = screen.getByRole("link", { name: newLabel });
      expect(within(newItemLink).getByTestId("AddIcon")).toBeInTheDocument();
    });

    it("shows a spinner while the list loads", () => {
      renderSection(itemKind, { data: null, isLoading: true, errorMessage: null });
      expect(screen.getByRole("progressbar", { name: loadingLabel })).toBeInTheDocument();
      expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    });

    it("shows the list request's error in an alert", () => {
      renderSection(itemKind, { data: null, isLoading: false, errorMessage: "Website not found" });
      expect(screen.getByRole("alert")).toHaveTextContent("Website not found");
      expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    });

    it("shows the empty state when there are no items", () => {
      renderSection(itemKind, loadedItems([]));
      expect(screen.getByText(emptyText)).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: heading })).not.toBeInTheDocument();
    });

    it("lists each item as a link to its own page", () => {
      renderSection(
        itemKind,
        loadedItems([
          buildWebsiteItemRecord({ id: "item-1", title: "Log in", description: "Sign in" }),
          buildWebsiteItemRecord({ id: "item-2", title: "Log out", description: "Sign out" }),
        ]),
      );

      const itemLinks = getItemLinks(heading);
      expect(itemLinks).toHaveLength(2);
      expect(itemLinks[0]).toHaveAttribute("href", `/websites/website-1/${segment}/item-1`);
      expect(itemLinks[0]).toHaveTextContent("Log in");
      expect(itemLinks[0]).toHaveTextContent("Sign in");
      expect(itemLinks[1]).toHaveAttribute("href", `/websites/website-1/${segment}/item-2`);
      expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    });

    it("passes the return state along when an item is opened", async () => {
      const user = userEvent.setup();
      renderSection(itemKind, loadedItems([buildWebsiteItemRecord({ id: "item-1", title: "Log in" })]));

      await user.click(screen.getByRole("link", { name: /Log in/ }));

      const landing = await readProbeAfterLanding(`/websites/website-1/${segment}/item-1`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
    });

    it("shows a run status icon only on actions", () => {
      renderSection(itemKind, loadedItems([buildWebsiteItemRecord({ id: "item-1", title: "Log in" })]));

      const statusIcons = within(screen.getByRole("list", { name: heading })).queryAllByRole("img");
      expect(statusIcons).toHaveLength(itemKind === ACTION_KIND ? 1 : 0);
    });

    it("passes the return state along when New is clicked", async () => {
      const user = userEvent.setup();
      renderSection(itemKind, loadedItems([]));

      await user.click(screen.getByRole("link", { name: newLabel }));

      const landing = await readProbeAfterLanding(`/websites/website-1/${segment}/new`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
    });
  },
);

describe("WebsiteItemListSection (use case cards)", () => {
  it("shows each use case as a card with a Use case kicker, its title, and its description", () => {
    renderSection(
      USE_CASE_KIND,
      loadedItems([
        buildWebsiteItemRecord({
          id: "use-case-1",
          title: "Member books and cancels a class",
          description: "A member reserves a spot, then cancels it.",
        }),
      ]),
    );

    const [useCaseCard] = getItemLinks("Use cases");
    expect(useCaseCard).toHaveTextContent(
      "Use caseMember books and cancels a classA member reserves a spot, then cancels it.",
    );
    expect(screen.queryByText(/passed ·/)).not.toBeInTheDocument();
  });
});

describe("WebsiteItemListSection (actions' status)", () => {
  beforeEach(() => {
    // Only the clock is faked: timers stay real, so Testing Library still waits.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("judges each action by its newest version's latest run: passed, failed, not run, or no versions yet", () => {
    renderSection(
      ACTION_KIND,
      loadedItems([
        actionsOfEveryStatus[0],
        actionsOfEveryStatus[1],
        buildWebsiteItemRecord({
          id: "action-not-run",
          title: "Sign up",
          newestScript: buildNewestActionScriptRecord({ latestRun: null }),
        }),
        actionsOfEveryStatus[3],
      ]),
    );

    const actionLinks = getItemLinks("Actions");
    expect(within(actionLinks[0]).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();
    expect(within(actionLinks[1]).getByRole("img", { name: "Latest run failed" })).toBeInTheDocument();
    expect(within(actionLinks[2]).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
    expect(within(actionLinks[3]).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
  });

  it("counts the actions by status above the list", () => {
    renderSection(ACTION_KIND, loadedItems(actionsOfEveryStatus));

    expect(screen.getByText("1 passed · 2 failed · 1 not run")).toBeInTheDocument();
  });

  it("shows no counts while there are no actions", () => {
    renderSection(ACTION_KIND, loadedItems([]));

    expect(screen.queryByText(/passed ·/)).not.toBeInTheDocument();
  });

  it("shows each action's status in words, who it runs as, its version, and its description on desktop", () => {
    renderSection(ACTION_KIND, loadedItems(actionsOfEveryStatus));

    const actionLinks = getItemLinks("Actions");
    expect(actionLinks[0]).toHaveTextContent("Sign in with a valid account");
    expect(actionLinks[0]).toHaveTextContent("Admin");
    expect(actionLinks[0]).toHaveTextContent("v6");
    expect(actionLinks[0]).toHaveTextContent("12 min ago");
    expect(actionLinks[1]).toHaveTextContent("Logged out");
    expect(actionLinks[1]).toHaveTextContent("v5");
    expect(actionLinks[1]).toHaveTextContent("Failed at step 9");
    expect(actionLinks[2]).toHaveTextContent("Timed out");
    expect(actionLinks[3]).toHaveTextContent("—");
    expect(actionLinks[3]).toHaveTextContent("Not run yet");
  });

  it("tags an action whose newest version was generated from different text, or as a different credential, as out of date", () => {
    renderSection(
      ACTION_KIND,
      loadedItems([
        buildWebsiteItemRecord({
          id: "action-renamed",
          title: "Log in again",
          newestScript: buildNewestActionScriptRecord({ actionTitle: "Log in" }),
        }),
        buildWebsiteItemRecord({
          id: "action-new-credential",
          title: "Log in",
          credentialId: "credential-2",
          credential: { id: "credential-2", name: "Editor" },
          newestScript: buildNewestActionScriptRecord({ credentialId: "credential-1" }),
        }),
        buildWebsiteItemRecord({ id: "action-up-to-date", title: "Log in", newestScript: buildNewestActionScriptRecord() }),
        buildWebsiteItemRecord({ id: "action-without-versions", title: "Search", newestScript: null }),
      ]),
    );

    const actionLinks = getItemLinks("Actions");
    expect(within(actionLinks[0]).getByText("Out of date")).toBeInTheDocument();
    expect(within(actionLinks[1]).getByText("Out of date")).toBeInTheDocument();
    expect(within(actionLinks[2]).queryByText("Out of date")).not.toBeInTheDocument();
    expect(within(actionLinks[3]).queryByText("Out of date")).not.toBeInTheDocument();
  });

  it("shows the status, then who it runs as, on a phone - without the description or version", () => {
    renderSection(ACTION_KIND, loadedItems(actionsOfEveryStatus), true);

    const actionLinks = getItemLinks("Actions");
    expect(actionLinks[0]).toHaveTextContent("Log in12 min ago · Admin");
    expect(actionLinks[1]).toHaveTextContent("Book a classFailed at step 9 · Logged out");
    expect(actionLinks[0]).not.toHaveTextContent("Sign in with a valid account");
    expect(actionLinks[0]).not.toHaveTextContent("v6");
    expect(screen.getByText("1 passed · 2 failed · 1 not run")).toBeInTheDocument();
  });
});
