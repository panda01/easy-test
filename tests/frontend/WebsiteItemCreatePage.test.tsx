import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemCreatePage from "../../src/pages/WebsiteItemCreatePage";
import { ACTION_KIND, USE_CASE_KIND } from "../../src/utils/websiteItemKinds";
import {
  ITEM_KIND_TEST_CASES,
  buildCredentialRecord,
  buildJsonResponse,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  type FetchStub,
  type RouterStart,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

/** The website list: the dashboard, on the home page. */
const LIST_PATH = "/";
const WEBSITE_PATH = "/websites/website-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const CREDENTIALS_API_URL = `${WEBSITE_API_URL}/credentials`;
const ACTION_CREATE_PATH = `${WEBSITE_PATH}/actions/new`;
const ACTIONS_API_URL = `${WEBSITE_API_URL}/actions`;

/** The website's two credentials, newest first, as the credential list returns them. */
const WEBSITE_CREDENTIALS = [
  buildCredentialRecord({ id: "credential-2", name: "Viewer" }),
  buildCredentialRecord({ id: "credential-1", name: "Admin" }),
];

/**
 * Renders the create page on both of its real routes, keyed per kind exactly
 * as App.tsx declares them.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteItemCreatePage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <>
      <Route
        path="/websites/:websiteId/use-cases/new"
        element={<WebsiteItemCreatePage key="use-case-create" itemKind={USE_CASE_KIND} />}
      />
      <Route
        path="/websites/:websiteId/actions/new"
        element={<WebsiteItemCreatePage key="action-create" itemKind={ACTION_KIND} />}
      />
    </>,
    routerStart,
  );
}

/**
 * Stubs a successful load of the owning website and its credentials, plus
 * any extra or replacement routes.
 * @param extraRoutes - More replies, e.g. for the POST
 * @returns The installed fetch stub
 */
function stubLoadedWebsite(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
    ...extraRoutes,
  });
}

/**
 * Picks an option from one of the form's MUI select dropdowns.
 * @param user - The user-event session
 * @param selectName - The dropdown's accessible name pattern (its label comes first)
 * @param optionName - The option's text
 */
async function pickFromSelect(user: UserEvent, selectName: RegExp, optionName: string): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/**
 * Waits for the form, then types a title and a description into it.
 * @param user - The user-event session to type with
 * @returns Resolves once both fields are filled
 */
async function fillForm(user: UserEvent): Promise<void> {
  await user.type(await screen.findByRole("textbox", { name: "Title" }), "Log in");
  await user.type(screen.getByRole("textbox", { name: "Description" }), "Sign in");
}

describe.each(ITEM_KIND_TEST_CASES)(
  "WebsiteItemCreatePage ($segment)",
  ({ segment, singularLabel }) => {
    const createPath = `${WEBSITE_PATH}/${segment}/new`;
    const itemsApiUrl = `${WEBSITE_API_URL}/${segment}`;
    const submitLabel = `Create ${singularLabel}`;
    /** What the create request adds for this kind: an action says who it logs in as (nobody, by default). */
    const expectedCredentialFields = segment === "actions" ? { credentialId: null } : {};

    /** History as it is after clicking "New ..." on the website's page. */
    const openedFromWebsite: RouterStart = {
      initialEntries: [
        LIST_PATH,
        WEBSITE_PATH,
        { pathname: createPath, state: { returnTo: WEBSITE_PATH } },
      ],
    };

    /** History after opening the form directly (deep link or reload): no state. */
    const openedByDeepLink: RouterStart = { initialEntries: [LIST_PATH, createPath] };

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("shows the heading, a spinner, placeholder breadcrumbs, and no form while the website loads", () => {
      const pendingWebsite = createDeferred<Response>();
      stubLoadedWebsite({ [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise });

      renderWebsiteItemCreatePage(openedFromWebsite);

      expect(
        screen.getByRole("heading", { level: 1, name: `New ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Loading website" })).toBeInTheDocument();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Website", href: WEBSITE_PATH },
        { label: `New ${singularLabel}`, href: null },
      ]);
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("puts a plus on the Create button", async () => {
      stubLoadedWebsite();

      renderWebsiteItemCreatePage(openedFromWebsite);

      const createButton = await screen.findByRole("button", { name: submitLabel });
      expect(within(createButton).getByTestId("AddIcon")).toBeInTheDocument();
    });

    it("shows the server's not-found text and no form for an unknown website", async () => {
      stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
      });

      renderWebsiteItemCreatePage(openedFromWebsite);

      expect(await screen.findByRole("alert")).toHaveTextContent("Website not found");
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("shows a blank form with submit disabled, and the website's name in the breadcrumbs", async () => {
      stubLoadedWebsite();

      renderWebsiteItemCreatePage(openedFromWebsite);

      expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("");
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
      expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Example", href: WEBSITE_PATH },
        { label: `New ${singularLabel}`, href: null },
      ]);
    });

    it("keeps submit disabled while the description is whitespace-only", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteItemCreatePage(openedFromWebsite);

      await user.type(await screen.findByRole("textbox", { name: "Title" }), "Log in");
      await user.type(screen.getByRole("textbox", { name: "Description" }), "   ");

      expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled();
    });

    it("POSTs the form and replaces it with the new item's page, keeping the return state", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`POST ${itemsApiUrl}`]: { status: 201, body: buildWebsiteItemRecord({ id: "item-9" }) },
      });
      renderWebsiteItemCreatePage(openedFromWebsite);

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: submitLabel }));

      const landing = await readProbeAfterLanding(`${WEBSITE_PATH}/${segment}/item-9`);
      expect(landing.navigationType).toBe("REPLACE");
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
      expect(fetchStub).toHaveBeenCalledWith(itemsApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Log in", description: "Sign in", ...expectedCredentialFields }),
      });

      // The form's entry is gone, so Back goes straight to the website.
      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("disables submit while the create request is in flight", async () => {
      const user = userEvent.setup();
      const pendingCreate = createDeferred<Response>();
      stubLoadedWebsite({ [`POST ${itemsApiUrl}`]: () => pendingCreate.promise });
      renderWebsiteItemCreatePage(openedFromWebsite);

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: submitLabel }));
      expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled();

      await act(async () => {
        pendingCreate.resolve(buildJsonResponse(201, buildWebsiteItemRecord({ id: "item-9" })));
        await pendingCreate.promise;
      });
      await readProbeAfterLanding(`${WEBSITE_PATH}/${segment}/item-9`);
    });

    it("shows the server's error and stays on the form when the create is rejected", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`POST ${itemsApiUrl}`]: { status: 400, body: { error: "title is required" } },
      });
      renderWebsiteItemCreatePage(openedFromWebsite);

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: submitLabel }));

      expect(await screen.findByRole("alert")).toHaveTextContent("title is required");
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Log in");
      expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
      expect(countRequests(fetchStub, "POST", itemsApiUrl)).toBe(1);
    });

    it("goes back to the website on Cancel when the website opened the form", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite();
      renderWebsiteItemCreatePage(openedFromWebsite);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("POP");
      expect(countRequests(fetchStub, "POST", itemsApiUrl)).toBe(0);
    });

    it("replaces the form with the website on Cancel after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteItemCreatePage(openedByDeepLink);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("REPLACE");

      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(LIST_PATH);
    });
  },
);

describe("WebsiteItemCreatePage ('actions'): Log in as", () => {
  /** History as it is after clicking "New action" on the website's page. */
  const openedFromWebsite: RouterStart = {
    initialEntries: [WEBSITE_PATH, { pathname: ACTION_CREATE_PATH, state: { returnTo: WEBSITE_PATH } }],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for the website's credentials before showing the form", async () => {
    const pendingCredentials = createDeferred<Response>();
    stubLoadedWebsite({ [`GET ${CREDENTIALS_API_URL}`]: () => pendingCredentials.promise });

    renderWebsiteItemCreatePage(openedFromWebsite);

    expect(await screen.findByRole("progressbar", { name: "Loading credentials" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading website" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();

    await act(async () => {
      pendingCredentials.resolve(buildJsonResponse(200, WEBSITE_CREDENTIALS));
      await pendingCredentials.promise;
    });

    expect(await screen.findByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Logged out (no credential)");
    expect(screen.queryByRole("progressbar", { name: "Loading credentials" })).not.toBeInTheDocument();
  });

  it("shows why the credentials could not be loaded, and no form", async () => {
    stubLoadedWebsite({
      [`GET ${CREDENTIALS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });

    renderWebsiteItemCreatePage(openedFromWebsite);

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  });

  it("offers logged out and each of the website's credentials, and sends the one picked", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({
      [`POST ${ACTIONS_API_URL}`]: { status: 201, body: buildWebsiteItemRecord({ id: "item-9" }) },
    });
    renderWebsiteItemCreatePage(openedFromWebsite);
    await fillForm(user);

    await user.click(screen.getByRole("combobox", { name: /^Log in as/ }));
    const credentialOptions = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(credentialOptions.map((credentialOption) => credentialOption.textContent)).toEqual([
      "Logged out (no credential)",
      "Viewer",
      "Admin",
    ]);
    await user.click(screen.getByRole("option", { name: "Admin" }));
    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Admin");
    await user.click(screen.getByRole("button", { name: "Create action" }));

    await readProbeAfterLanding(`${WEBSITE_PATH}/actions/item-9`);
    expect(fetchStub).toHaveBeenCalledWith(ACTIONS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Log in", description: "Sign in", credentialId: "credential-1" }),
    });
  });

  it("sends logged out again when Logged out is picked after a credential", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({
      [`POST ${ACTIONS_API_URL}`]: { status: 201, body: buildWebsiteItemRecord({ id: "item-9" }) },
    });
    renderWebsiteItemCreatePage(openedFromWebsite);
    await fillForm(user);

    await pickFromSelect(user, /^Log in as/, "Viewer");
    await pickFromSelect(user, /^Log in as/, "Logged out (no credential)");
    await user.click(screen.getByRole("button", { name: "Create action" }));

    await readProbeAfterLanding(`${WEBSITE_PATH}/actions/item-9`);
    expect(fetchStub).toHaveBeenCalledWith(ACTIONS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Log in", description: "Sign in", credentialId: null }),
    });
  });
});

describe("WebsiteItemCreatePage ('use-cases'): no credential", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("neither fetches credentials nor asks who to log in as", async () => {
    const fetchStub = stubLoadedWebsite();

    renderWebsiteItemCreatePage({ initialEntries: [`${WEBSITE_PATH}/use-cases/new`] });

    expect(await screen.findByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Log in as/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Loading credentials" })).not.toBeInTheDocument();
    expect(countRequests(fetchStub, "GET", CREDENTIALS_API_URL)).toBe(0);
  });
});
