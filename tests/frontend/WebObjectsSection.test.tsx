import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebObjectsSection from "../../src/components/WebObjectsSection";
import { formatFullDateTime } from "../../src/utils/formatRelativeTime";
import {
  buildCreatedObjectRecord,
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

  describe("created objects", () => {
    const CREATED_OBJECTS_API_URL = "/api/websites/website-1/created-objects";
    const projectObject = buildWebObjectRecord({
      id: "web-object-3",
      instancePatternKey: "/projects/{project}",
      detectedName: "Project",
      name: null,
      pagePatterns: [],
    });
    const seenProject = buildCreatedObjectRecord({
      id: "created-object-1",
      name: "Apollo 7",
      lastSeenAt: "2026-04-04T00:00:00.000Z",
    });
    const missingProject = buildCreatedObjectRecord({
      id: "created-object-2",
      name: "Apollo 8",
      url: null,
      notSeenSince: "2026-04-05T00:00:00.000Z",
      action: { id: "item-9", title: "Old create action", deletedAt: "2026-04-06T00:00:00.000Z" },
    });
    const deletedProject = buildCreatedObjectRecord({
      id: "created-object-3",
      name: "Apollo 9",
      deletedOnSiteAt: "2026-04-07T00:00:00.000Z",
      deletedByActionScriptRunId: "script-run-9",
      deletedByActionScriptRun: {
        id: "script-run-9",
        actionId: "item-2",
        actionScriptId: "script-2",
        createdAt: "2026-04-07T00:00:00.000Z",
        action: { title: "Delete a project" },
      },
    });
    const freshProject = buildCreatedObjectRecord({ id: "created-object-4", name: "Apollo 10" });
    const untypedObject = buildCreatedObjectRecord({
      id: "created-object-5",
      name: "Mystery",
      objectTypeKey: null,
      objectTypeName: null,
    });

    it("lists each type's created objects with what the record knows, and the others apart", async () => {
      stubFetchRoutes({
        [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [projectObject] },
        [`GET ${CREATED_OBJECTS_API_URL}`]: {
          status: 200,
          body: [seenProject, missingProject, deletedProject, freshProject, untypedObject],
        },
      });
      renderSection();

      const projectList = await screen.findByRole("list", { name: "Project created by runs" });
      expect(screen.getByText("Created by runs · 4")).toBeInTheDocument();
      expect(within(projectList).getByRole("link", { name: "Apollo 7" })).toHaveAttribute(
        "href",
        "http://localhost:3099/projects/capollo",
      );
      expect(
        within(projectList).getByText(`Seen on the crawl of ${formatFullDateTime("2026-04-04T00:00:00.000Z")}`),
      ).toBeInTheDocument();
      expect(within(projectList).getByText(`Not seen since ${formatFullDateTime("2026-04-05T00:00:00.000Z")}`)).toBeInTheDocument();
      expect(within(projectList).getByText(/Old create action \(deleted\)/)).toBeInTheDocument();
      expect(
        within(projectList).getByText(
          `Deleted by a run of Delete a project on ${formatFullDateTime("2026-04-07T00:00:00.000Z")}`,
        ),
      ).toBeInTheDocument();
      expect(within(projectList).getByText("Not crawled since it was made")).toBeInTheDocument();
      expect(within(projectList).getAllByRole("link", { name: "Create a project" })[0]).toHaveAttribute(
        "href",
        "/websites/website-1/actions/item-1",
      );

      const otherList = screen.getByRole("list", { name: "Other created objects" });
      expect(within(otherList).getByText("Mystery")).toBeInTheDocument();
    });

    it("removes a created object from the record and fetches the record again", async () => {
      const user = userEvent.setup();
      const fetchStub = stubFetchRoutes({
        [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [projectObject] },
        [`GET ${CREATED_OBJECTS_API_URL}`]: { status: 200, body: [seenProject] },
        [`DELETE ${CREATED_OBJECTS_API_URL}/created-object-1`]: { status: 204 },
      });
      renderSection();

      await user.click(await screen.findByRole("button", { name: "Remove Apollo 7 from the record" }));

      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", CREATED_OBJECTS_API_URL)).toBe(2);
      });
      expect(countRequests(fetchStub, "DELETE", `${CREATED_OBJECTS_API_URL}/created-object-1`)).toBe(1);
    });

    it("shows why the record could not be loaded, or an object could not be removed", async () => {
      const user = userEvent.setup();
      stubFetchRoutes({
        [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [projectObject] },
        [`GET ${CREATED_OBJECTS_API_URL}`]: { status: 200, body: [untypedObject] },
        [`DELETE ${CREATED_OBJECTS_API_URL}/created-object-5`]: { status: 404, body: { error: "Created object not found" } },
      });
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Remove Mystery from the record" }));
      expect(await screen.findByText("Could not remove it: Created object not found")).toBeInTheDocument();
    });

    it("says when the record could not be fetched", async () => {
      stubFetchRoutes({
        [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [] },
        [`GET ${CREATED_OBJECTS_API_URL}`]: { status: 500, body: { error: "Database is down" } },
      });
      renderSection();
      expect(await screen.findByText("Could not load the created objects: Database is down")).toBeInTheDocument();
    });
  });
});
