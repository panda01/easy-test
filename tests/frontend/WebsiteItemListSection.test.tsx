import { describe, it, expect } from "vitest";
import { screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemListSection from "../../src/components/WebsiteItemListSection";
import { type JsonResourceState } from "../../src/hooks/useJsonResource";
import { type WebsiteItemRecord } from "../../src/hooks/useWebsiteItems";
import { ACTION_KIND, USE_CASE_KIND, type WebsiteItemKind } from "../../src/utils/websiteItemKinds";
import {
  buildWebsiteItemRecord,
  readProbeAfterLanding,
  renderPageRoutes,
} from "./support/frontendTestHelpers";

const WEBSITE_PATH = "/websites/website-1";

/**
 * Renders one section on the website's detail route, so its links can be
 * followed onto the location probe.
 * @param itemKind - Which kind of item the section lists
 * @param itemsResource - The list request state to render
 * @returns The Testing Library render result
 */
function renderSection(
  itemKind: WebsiteItemKind,
  itemsResource: JsonResourceState<WebsiteItemRecord[]>,
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
        />
      }
    />,
    { initialEntries: [WEBSITE_PATH] },
  );
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
      renderSection(itemKind, { data: [], isLoading: false, errorMessage: null });

      const section = screen.getByRole("region", { name: heading });
      expect(within(section).getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
      expect(within(section).getByRole("link", { name: newLabel })).toHaveAttribute(
        "href",
        `/websites/website-1/${segment}/new`,
      );
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
      renderSection(itemKind, { data: [], isLoading: false, errorMessage: null });
      expect(screen.getByText(emptyText)).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: heading })).not.toBeInTheDocument();
    });

    it("lists each item as a link to its own page", () => {
      renderSection(itemKind, {
        data: [
          buildWebsiteItemRecord({ id: "item-1", title: "Log in", description: "Sign in" }),
          buildWebsiteItemRecord({ id: "item-2", title: "Log out", description: "Sign out" }),
        ],
        isLoading: false,
        errorMessage: null,
      });

      const itemList = screen.getByRole("list", { name: heading });
      const itemLinks = within(itemList).getAllByRole("link");
      expect(itemLinks).toHaveLength(2);
      expect(itemLinks[0]).toHaveAttribute("href", `/websites/website-1/${segment}/item-1`);
      expect(itemLinks[0]).toHaveTextContent("Log in");
      expect(itemLinks[0]).toHaveTextContent("Sign in");
      expect(itemLinks[1]).toHaveAttribute("href", `/websites/website-1/${segment}/item-2`);
      expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    });

    it("passes the return state along when an item is opened", async () => {
      const user = userEvent.setup();
      renderSection(itemKind, {
        data: [buildWebsiteItemRecord({ id: "item-1", title: "Log in" })],
        isLoading: false,
        errorMessage: null,
      });

      await user.click(screen.getByRole("link", { name: /Log in/ }));

      const landing = await readProbeAfterLanding(`/websites/website-1/${segment}/item-1`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
    });

    it("shows a run status icon only on actions", () => {
      renderSection(itemKind, {
        data: [buildWebsiteItemRecord({ id: "item-1", title: "Log in" })],
        isLoading: false,
        errorMessage: null,
      });

      const itemList = screen.getByRole("list", { name: heading });
      const statusIcons = within(itemList).queryAllByRole("img");
      expect(statusIcons).toHaveLength(itemKind === ACTION_KIND ? 1 : 0);
    });

    it("passes the return state along when New is clicked", async () => {
      const user = userEvent.setup();
      renderSection(itemKind, { data: [], isLoading: false, errorMessage: null });

      await user.click(screen.getByRole("link", { name: newLabel }));

      const landing = await readProbeAfterLanding(`/websites/website-1/${segment}/new`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
    });
  },
);

describe("WebsiteItemListSection (actions' run status)", () => {
  it("judges each action by its newest version's latest run: passed, failed, not run, or no versions yet", () => {
    renderSection(ACTION_KIND, {
      data: [
        buildWebsiteItemRecord({
          id: "action-passing",
          title: "Log in",
          newestScript: {
            id: "script-a",
            latestRun: { id: "run-a", succeeded: true, createdAt: "2026-04-03T00:00:00.000Z" },
          },
        }),
        buildWebsiteItemRecord({
          id: "action-failing",
          title: "Log out",
          newestScript: {
            id: "script-b",
            latestRun: { id: "run-b", succeeded: false, createdAt: "2026-04-03T00:00:00.000Z" },
          },
        }),
        buildWebsiteItemRecord({
          id: "action-not-run",
          title: "Sign up",
          newestScript: { id: "script-c", latestRun: null },
        }),
        buildWebsiteItemRecord({ id: "action-without-versions", title: "Search", newestScript: null }),
      ],
      isLoading: false,
      errorMessage: null,
    });

    const actionLinks = within(screen.getByRole("list", { name: "Actions" })).getAllByRole("link");
    expect(within(actionLinks[0]).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();
    expect(within(actionLinks[1]).getByRole("img", { name: "Latest run failed" })).toBeInTheDocument();
    expect(within(actionLinks[2]).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
    expect(within(actionLinks[3]).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
    expect(actionLinks[0]).toHaveAccessibleName(/^Latest run passed Log in/);
  });
});
