import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import DeleteActionCreatePage from "../../src/pages/DeleteActionCreatePage";
import {
  buildActionObjectRoleRecord,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  type FetchStub,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const WEBSITE_PATH = "/websites/website-1";
const ACTION_PATH = `${WEBSITE_PATH}/actions/item-1`;
const PAGE_PATH = `${ACTION_PATH}/delete-action/new`;
const WEBSITE_API_URL = "/api/websites/website-1";
const ACTION_API_URL = `${WEBSITE_API_URL}/actions/item-1`;
const PROPOSAL_API_URL = `${ACTION_API_URL}/delete-action/proposal`;
const DELETE_ACTION_API_URL = `${ACTION_API_URL}/delete-action`;

/** A Create action with no delete action yet. */
const createAction = buildWebsiteItemRecord({
  title: "Create a project",
  objectRole: buildActionObjectRoleRecord({ kind: "create" }),
  deleteAction: null,
  createActions: [],
});

/**
 * Stubs the website, the action, the proposal, and the create route, plus
 * any replacements.
 * @param extraRoutes - More replies
 * @returns The installed fetch stub
 */
function stubLoadedPage(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${ACTION_API_URL}`]: { status: 200, body: createAction },
    [`POST ${PROPOSAL_API_URL}`]: { status: 200, body: { title: "Delete the project", description: "Remove it", modelId: "m" } },
    [`POST ${DELETE_ACTION_API_URL}`]: { status: 201, body: buildWebsiteItemRecord({ id: "item-2" }) },
    ...extraRoutes,
  });
}

/**
 * Renders the page on its real route, opened from the action's page.
 * @returns The Testing Library render result
 */
function renderDeleteActionCreatePage(): RenderResult {
  return renderPageRoutes(
    <Route path="/websites/:websiteId/actions/:itemId/delete-action/new" element={<DeleteActionCreatePage />} />,
    { initialEntries: [ACTION_PATH, { pathname: PAGE_PATH, state: { returnTo: ACTION_PATH } }] },
  );
}

describe("DeleteActionCreatePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the step for a Create action without a delete action, and returns to the action once it is created", async () => {
    const user = userEvent.setup();
    stubLoadedPage();
    renderDeleteActionCreatePage();

    expect(screen.getByRole("heading", { name: "Add its delete action" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Delete the project");
    });
    await user.click(screen.getByRole("button", { name: "Create delete action" }));

    await readProbeAfterLanding(ACTION_PATH);
  });

  it("returns to the action on Skip for now", async () => {
    const user = userEvent.setup();
    stubLoadedPage();
    renderDeleteActionCreatePage();

    await user.click(await screen.findByRole("button", { name: "Skip for now" }));

    await readProbeAfterLanding(ACTION_PATH);
  });

  it("refuses an action whose kind is not Create, and one that already has a delete action", async () => {
    stubLoadedPage({
      [`GET ${ACTION_API_URL}`]: { status: 200, body: buildWebsiteItemRecord({ objectRole: buildActionObjectRoleRecord({ kind: "read" }) }) },
    });
    renderDeleteActionCreatePage();
    expect(
      await screen.findByText("Only a Create action gets a delete action; this action's kind is not Create."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();

    vi.restoreAllMocks();
    stubLoadedPage({
      [`GET ${ACTION_API_URL}`]: {
        status: 200,
        body: { ...createAction, deleteAction: { id: "item-2", title: "Delete the project" } },
      },
    });
    renderDeleteActionCreatePage();
    expect(await screen.findByText("This action already has a delete action: Delete the project.")).toBeInTheDocument();
  });

  it("shows the server's not-found text for an unknown action", async () => {
    stubLoadedPage({ [`GET ${ACTION_API_URL}`]: { status: 404, body: { error: "Action not found" } } });
    renderDeleteActionCreatePage();

    expect(await screen.findByText("Action not found")).toBeInTheDocument();
  });
});
