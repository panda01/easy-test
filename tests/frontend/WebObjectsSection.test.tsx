import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebObjectsSection from "../../src/components/WebObjectsSection";
import { formatFullDateTime } from "../../src/utils/formatRelativeTime";
import {
  buildPagePatternRecord,
  buildWebObjectRecord,
  countRequests,
  renderPageRoutes,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const WEB_OBJECTS_API_URL = "/api/websites/website-1/web-objects";
const ACTION_OBJECT_API_URL = `${WEB_OBJECTS_API_URL}/web-object-2`;

const websiteObject = buildWebObjectRecord({
  skippedLinkCount: 1,
  pagePatterns: [
    buildPagePatternRecord(),
    buildPagePatternRecord({ id: "page-pattern-2", key: "/websites/{website}/edit", role: "view", viewName: "edit", pageCount: 1 }),
  ],
});
const actionObject = buildWebObjectRecord({
  id: "web-object-2",
  parentWebObjectId: "web-object-1",
  instancePatternKey: "/websites/{website}/actions/{action}",
  detectedName: "Action",
  name: "Test step",
  instanceCount: 1,
  pagePatterns: [
    buildPagePatternRecord({
      id: "page-pattern-3",
      webObjectId: "web-object-2",
      key: "/websites/{website}/actions/{action}",
      pageCount: 1,
    }),
  ],
});

/**
 * Renders the section on the website page's route.
 * @returns The Testing Library render result
 */
function renderSection(): ReturnType<typeof renderPageRoutes> {
  return renderPageRoutes(<Route path="/websites/:websiteId" element={<WebObjectsSection websiteId="website-1" />} />, {
    initialEntries: ["/websites/website-1"],
  });
}

describe("WebObjectsSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the saved objects as a tree with their names, counts, and patterns, and links to the crawl that found them", async () => {
    stubFetchRoutes({ [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [websiteObject, actionObject] } });

    renderSection();

    const webObjectList = await screen.findByRole("list", { name: "Web objects" });
    const [websiteItem, actionItem] = within(webObjectList).getAllByRole("listitem").filter((item) => item.parentElement === webObjectList);
    expect(within(websiteItem).getByRole("heading", { name: "Website" })).toBeInTheDocument();
    expect(within(websiteItem).getByText("3 instances · 1 more skipped")).toBeInTheDocument();
    expect(within(websiteItem).getByText("Instance page · 3 pages")).toBeInTheDocument();
    expect(within(websiteItem).getByText("View · edit · 1 page")).toBeInTheDocument();
    expect(within(websiteItem).getByText("/websites/{website}/edit")).toBeInTheDocument();
    expect(websiteItem).toHaveStyle({ paddingLeft: "0px" });
    expect(within(actionItem).getByRole("heading", { name: "Test step" })).toBeInTheDocument();
    expect(within(actionItem).getByText("detected as Action")).toBeInTheDocument();
    expect(actionItem).toHaveStyle({ paddingLeft: "16px" });
    const crawlLink = screen.getByRole("link", {
      name: `From the crawl on ${formatFullDateTime(websiteObject.crawlRun.createdAt)}`,
    });
    expect(crawlLink).toHaveAttribute("href", "/websites/website-1/crawl-runs/crawl-run-1?view=objects");
  });

  it("says so when no crawl found any objects yet", async () => {
    stubFetchRoutes({ [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [] } });

    renderSection();

    expect(await screen.findByText("No objects yet. Crawl the website to find them.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the server's reason when the objects cannot be fetched", async () => {
    stubFetchRoutes({ [`GET ${WEB_OBJECTS_API_URL}`]: { status: 404, body: { error: "Website not found" } } });

    renderSection();

    expect(await screen.findByText("Website not found")).toBeInTheDocument();
  });

  it("renames an object and shows the new name at once", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [websiteObject, actionObject] },
      [`PUT ${ACTION_OBJECT_API_URL}`]: { status: 200, body: { ...actionObject, name: "Script step" } },
    });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Rename Test step" }));
    const nameField = screen.getByRole("textbox", { name: "Name" });
    expect(nameField).toHaveValue("Test step");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Script step");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Script step" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(countRequests(fetchStub, "PUT", ACTION_OBJECT_API_URL)).toBe(1);
  });

  it("goes back to the detected name, which hides the 'detected as' note", async () => {
    stubFetchRoutes({
      [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [actionObject] },
      [`PUT ${ACTION_OBJECT_API_URL}`]: { status: 200, body: { ...actionObject, name: null } },
    });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Rename Test step" }));
    await userEvent.click(screen.getByRole("button", { name: "Use detected name" }));

    expect(await screen.findByRole("heading", { name: "Action" })).toBeInTheDocument();
    expect(screen.queryByText("detected as Action")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the server's reason when the rename fails, and closes it on Cancel", async () => {
    stubFetchRoutes({
      [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [actionObject] },
      [`PUT ${ACTION_OBJECT_API_URL}`]: { status: 404, body: { error: "Web object not found" } },
    });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Rename Test step" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Web object not found")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
