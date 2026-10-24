import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemEditPage from "../../src/pages/WebsiteItemEditPage";
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
const ACTION_PATH = `${WEBSITE_PATH}/actions/item-1`;
const ACTION_EDIT_PATH = `${ACTION_PATH}/edit`;
const ACTION_API_URL = `${WEBSITE_API_URL}/actions/item-1`;

/** The website's two credentials, newest first, as the credential list returns them. */
const WEBSITE_CREDENTIALS = [
  buildCredentialRecord({ id: "credential-2", name: "Viewer" }),
  buildCredentialRecord({ id: "credential-1", name: "Admin" }),
];

/**
 * Renders the edit page on both of its real routes, keyed per kind exactly as
 * App.tsx declares them.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteItemEditPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <>
      <Route
        path="/websites/:websiteId/use-cases/:itemId/edit"
        element={<WebsiteItemEditPage key="use-case-edit" itemKind={USE_CASE_KIND} />}
      />
      <Route
        path="/websites/:websiteId/actions/:itemId/edit"
        element={<WebsiteItemEditPage key="action-edit" itemKind={ACTION_KIND} />}
      />
    </>,
    routerStart,
  );
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

/** What an action form sends for its object role when every choice is left on "Detect". */
const DETECT_EVERY_ROLE_CHOICE = { userActionKind: null, userObjectTypeKey: null, userNameParameterKey: null, userDeletesObject: null };

/**
 * Builds what `useJsonMutation` sends to save an action's title, description, and credential.
 * @param credentialId - The credential the action should log in as, or null for logged out
 * @returns The fetch init the stub should have received
 */
function buildActionSaveRequestInit(credentialId: string | null): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Log in", description: "Sign in with a valid account", credentialId, ...DETECT_EVERY_ROLE_CHOICE }),
  };
}

describe.each(ITEM_KIND_TEST_CASES)(
  "WebsiteItemEditPage ($segment)",
  ({ segment, singularLabel, singularTitle, notFoundText }) => {
    const itemPath = `${WEBSITE_PATH}/${segment}/item-1`;
    const editPath = `${itemPath}/edit`;
    const itemApiUrl = `${WEBSITE_API_URL}/${segment}/item-1`;
    /** What the save request adds for this kind: an action says who it logs in as (nobody, by default). */
    const expectedCredentialFields = segment === "actions" ? { credentialId: null, ...DETECT_EVERY_ROLE_CHOICE } : {};

    /** History as it is after clicking Edit on the item's page. */
    const openedFromItem: RouterStart = {
      initialEntries: [
        WEBSITE_PATH,
        { pathname: itemPath, state: { returnTo: WEBSITE_PATH } },
        { pathname: editPath, state: { returnTo: itemPath } },
      ],
    };

    /** History after opening the form directly (deep link or reload): no state. */
    const openedByDeepLink: RouterStart = { initialEntries: [WEBSITE_PATH, editPath] };

    /**
     * Stubs successful loads of the website and the item, plus any extra or
     * replacement routes.
     * @param extraRoutes - More replies, e.g. for the PUT, or replacements for the GETs
     * @returns The installed fetch stub
     */
    const stubLoadedItem = (extraRoutes: StubbedRouteTable = {}): FetchStub =>
      stubFetchRoutes({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
        [`GET ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord() },
        [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
        ...extraRoutes,
      });

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("shows the heading, a spinner, placeholder breadcrumbs, and no form while the item loads", () => {
      const pendingWebsite = createDeferred<Response>();
      const pendingItem = createDeferred<Response>();
      stubLoadedItem({
        [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise,
        [`GET ${itemApiUrl}`]: () => pendingItem.promise,
      });

      renderWebsiteItemEditPage(openedFromItem);

      expect(
        screen.getByRole("heading", { level: 1, name: `Edit ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("progressbar", { name: `Loading ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Website", href: WEBSITE_PATH },
        { label: singularTitle, href: itemPath },
        { label: "Edit", href: null },
      ]);
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("shows the server's not-found text and no form for an unknown item", async () => {
      stubLoadedItem({ [`GET ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });

      renderWebsiteItemEditPage(openedFromItem);

      expect(await screen.findByRole("alert")).toHaveTextContent(notFoundText);
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("pre-fills the form with the saved item and names both records in the breadcrumbs", async () => {
      stubLoadedItem();

      renderWebsiteItemEditPage(openedFromItem);

      expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Log in");
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
        "Sign in with a valid account",
      );
      expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
      await waitFor(() => {
        expect(readBreadcrumbTrail()).toEqual([
          { label: "Websites", href: LIST_PATH },
          { label: "Example", href: WEBSITE_PATH },
          { label: "Log in", href: itemPath },
          { label: "Edit", href: null },
        ]);
      });
    });

    it("disables Save while the title is cleared to whitespace", async () => {
      const user = userEvent.setup();
      stubLoadedItem();
      renderWebsiteItemEditPage(openedFromItem);

      const titleField = await screen.findByRole("textbox", { name: "Title" });
      await user.clear(titleField);
      await user.type(titleField, "  ");

      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    });

    it("PUTs the edited values and goes back to the item's page when it opened the form", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedItem({
        [`PUT ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord({ title: "Sign in" }) },
      });
      renderWebsiteItemEditPage(openedFromItem);

      const titleField = await screen.findByRole("textbox", { name: "Title" });
      await user.clear(titleField);
      await user.type(titleField, "Sign in");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("POP");
      expect(fetchStub).toHaveBeenCalledWith(itemApiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Sign in",
          description: "Sign in with a valid account",
          ...expectedCredentialFields,
        }),
      });

      // History is [website, item], not [website, item, item].
      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("replaces the form with the item's page on Save after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedItem({ [`PUT ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord() } });
      renderWebsiteItemEditPage(openedByDeepLink);

      await user.click(await screen.findByRole("button", { name: "Save changes" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("REPLACE");

      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("shows the server's error and stays on the form when the save is rejected", async () => {
      const user = userEvent.setup();
      stubLoadedItem({ [`PUT ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });
      renderWebsiteItemEditPage(openedFromItem);

      await user.click(await screen.findByRole("button", { name: "Save changes" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(notFoundText);
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Log in");
      expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
    });

    it("goes back to the item's page on Cancel without saving, when it opened the form", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedItem();
      renderWebsiteItemEditPage(openedFromItem);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("POP");
      expect(countRequests(fetchStub, "PUT", itemApiUrl)).toBe(0);
    });

    it("replaces the form with the item's page on Cancel after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedItem();
      renderWebsiteItemEditPage(openedByDeepLink);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("REPLACE");
    });
  },
);

describe("WebsiteItemEditPage ('actions'): Log in as", () => {
  /** History as it is after clicking Edit on the action's page. */
  const openedFromAction: RouterStart = {
    initialEntries: [ACTION_PATH, { pathname: ACTION_EDIT_PATH, state: { returnTo: ACTION_PATH } }],
  };

  /**
   * Stubs the website, an action that logs in as the given credential, and
   * the website's credentials, plus any extra or replacement routes.
   * @param savedCredentialId - The credential the action is saved with, or null for logged out
   * @param extraRoutes - More replies, e.g. for the PUT
   * @returns The installed fetch stub
   */
  const stubActionWithCredential = (
    savedCredentialId: string | null,
    extraRoutes: StubbedRouteTable = {},
  ): FetchStub =>
    stubFetchRoutes({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
      [`GET ${ACTION_API_URL}`]: {
        status: 200,
        body: buildWebsiteItemRecord({ credentialId: savedCredentialId }),
      },
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
      [`PUT ${ACTION_API_URL}`]: { status: 200, body: buildWebsiteItemRecord() },
      ...extraRoutes,
    });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for the website's credentials before showing the form", async () => {
    const pendingCredentials = createDeferred<Response>();
    stubActionWithCredential("credential-1", {
      [`GET ${CREDENTIALS_API_URL}`]: () => pendingCredentials.promise,
    });

    renderWebsiteItemEditPage(openedFromAction);

    expect(await screen.findByRole("progressbar", { name: "Loading credentials" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading action" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();

    await act(async () => {
      pendingCredentials.resolve(buildJsonResponse(200, WEBSITE_CREDENTIALS));
      await pendingCredentials.promise;
    });

    expect(await screen.findByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Admin");
  });

  it("shows why the credentials could not be loaded, and no form", async () => {
    stubActionWithCredential(null, {
      [`GET ${CREDENTIALS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });

    renderWebsiteItemEditPage(openedFromAction);

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  });

  it("starts on the saved credential and saves a different one", async () => {
    const user = userEvent.setup();
    const fetchStub = stubActionWithCredential("credential-1");
    renderWebsiteItemEditPage(openedFromAction);

    const credentialSelect = await screen.findByRole("combobox", { name: /^Log in as/ });
    expect(credentialSelect).toHaveTextContent("Admin");
    await pickFromSelect(user, /^Log in as/, "Viewer");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await readProbeAfterLanding(ACTION_PATH);
    expect(fetchStub).toHaveBeenCalledWith(ACTION_API_URL, buildActionSaveRequestInit("credential-2"));
  });

  it("saves the saved credential unchanged", async () => {
    const user = userEvent.setup();
    const fetchStub = stubActionWithCredential("credential-1");
    renderWebsiteItemEditPage(openedFromAction);

    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    await readProbeAfterLanding(ACTION_PATH);
    expect(fetchStub).toHaveBeenCalledWith(ACTION_API_URL, buildActionSaveRequestInit("credential-1"));
  });

  it("switches an action to logged out", async () => {
    const user = userEvent.setup();
    const fetchStub = stubActionWithCredential("credential-1");
    renderWebsiteItemEditPage(openedFromAction);
    await screen.findByRole("combobox", { name: /^Log in as/ });

    await pickFromSelect(user, /^Log in as/, "Logged out (no credential)");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await readProbeAfterLanding(ACTION_PATH);
    expect(fetchStub).toHaveBeenCalledWith(ACTION_API_URL, buildActionSaveRequestInit(null));
  });

  it("shows and saves a credential that is no longer offered (deleted) as logged out", async () => {
    const user = userEvent.setup();
    const fetchStub = stubActionWithCredential("deleted-credential");
    renderWebsiteItemEditPage(openedFromAction);

    expect(await screen.findByRole("combobox", { name: /^Log in as/ })).toHaveTextContent(
      "Logged out (no credential)",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await readProbeAfterLanding(ACTION_PATH);
    expect(fetchStub).toHaveBeenCalledWith(ACTION_API_URL, buildActionSaveRequestInit(null));
  });
});

describe("WebsiteItemEditPage ('use-cases'): no credential", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("neither fetches credentials nor asks who to log in as", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
      [`GET ${WEBSITE_API_URL}/use-cases/item-1`]: { status: 200, body: buildWebsiteItemRecord() },
      [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: WEBSITE_CREDENTIALS },
    });

    renderWebsiteItemEditPage({ initialEntries: [`${WEBSITE_PATH}/use-cases/item-1/edit`] });

    expect(await screen.findByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Log in as/ })).not.toBeInTheDocument();
    expect(countRequests(fetchStub, "GET", CREDENTIALS_API_URL)).toBe(0);
  });
});
