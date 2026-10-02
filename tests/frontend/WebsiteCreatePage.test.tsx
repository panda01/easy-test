import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteCreatePage from "../../src/pages/WebsiteCreatePage";
import {
  buildJsonResponse,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  type RouterStart,
} from "./support/frontendTestHelpers";

const LIST_PATH = "/websites";
const CREATE_PATH = "/websites/new";

/** History as it is after clicking "New website" on the list. */
const OPENED_FROM_LIST: RouterStart = {
  initialEntries: [LIST_PATH, { pathname: CREATE_PATH, state: { returnTo: LIST_PATH } }],
};

/** History after opening the form directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [LIST_PATH, CREATE_PATH] };

/**
 * Renders the create page on its real route (`/websites/new`).
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteCreatePage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(<Route path="/websites/new" element={<WebsiteCreatePage />} />, routerStart);
}

/**
 * Types a URL and a name (the two required fields) into the website form.
 * @param user - The user-event session to type with
 * @returns Resolves once both fields are filled
 */
async function fillRequiredFields(user: UserEvent): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Example");
}

describe("WebsiteCreatePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the heading, breadcrumbs, and a blank form with submit disabled", () => {
    stubFetchRoutes({});
    renderWebsiteCreatePage(OPENED_FROM_LIST);

    expect(screen.getByRole("heading", { level: 1, name: "New website" })).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "New website", href: null },
    ]);
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create website" })).toBeDisabled();
  });

  it("keeps submit disabled while URL or name is whitespace-only", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({});
    renderWebsiteCreatePage(OPENED_FROM_LIST);

    await user.type(screen.getByRole("textbox", { name: "URL" }), "  ");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Example");

    expect(screen.getByRole("button", { name: "Create website" })).toBeDisabled();
  });

  it("POSTs the form values and replaces the form with the new website's page, keeping the return state", async () => {
    const user = userEvent.setup();
    const fetchStub = stubFetchRoutes({
      "POST /api/websites": { status: 201, body: buildWebsiteRecord({ id: "website-9" }) },
    });
    renderWebsiteCreatePage(OPENED_FROM_LIST);

    await fillRequiredFields(user);
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Notes");
    await user.click(screen.getByRole("button", { name: "Create website" }));

    const landing = await readProbeAfterLanding("/websites/website-9");
    expect(landing.navigationType).toBe("REPLACE");
    expect(landing.state).toBe(JSON.stringify({ returnTo: LIST_PATH }));
    expect(fetchStub).toHaveBeenCalledWith("/api/websites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", name: "Example", description: "Notes" }),
    });

    // The form's entry is gone, so Back goes straight to the list.
    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("disables submit while the create request is in flight", async () => {
    const user = userEvent.setup();
    const pendingCreate = createDeferred<Response>();
    stubFetchRoutes({ "POST /api/websites": () => pendingCreate.promise });
    renderWebsiteCreatePage(OPENED_FROM_LIST);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create website" }));
    expect(screen.getByRole("button", { name: "Create website" })).toBeDisabled();

    await act(async () => {
      pendingCreate.resolve(buildJsonResponse(201, buildWebsiteRecord({ id: "website-9" })));
      await pendingCreate.promise;
    });
    await readProbeAfterLanding("/websites/website-9");
  });

  it("shows the server's error and stays on the form when the create is rejected", async () => {
    const user = userEvent.setup();
    const fetchStub = stubFetchRoutes({
      "POST /api/websites": { status: 409, body: { error: "A website with that URL already exists" } },
    });
    renderWebsiteCreatePage(OPENED_FROM_LIST);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create website" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A website with that URL already exists",
    );
    expect(screen.getByRole("heading", { level: 1, name: "New website" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("https://example.com");
    expect(screen.getByRole("button", { name: "Create website" })).toBeEnabled();
    expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
    expect(countRequests(fetchStub, "POST", "/api/websites")).toBe(1);
  });

  it("goes back to the list on Cancel when the list opened the form", async () => {
    const user = userEvent.setup();
    const fetchStub = stubFetchRoutes({});
    renderWebsiteCreatePage(OPENED_FROM_LIST);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("replaces the form with the list on Cancel after a deep link", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({});
    renderWebsiteCreatePage(OPENED_BY_DEEP_LINK);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });
});
