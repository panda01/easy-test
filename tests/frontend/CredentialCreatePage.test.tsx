import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import CredentialCreatePage from "../../src/pages/CredentialCreatePage";
import {
  buildCredentialRecord,
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

const DETAIL_PATH = "/websites/website-1";
const NEW_CREDENTIAL_PATH = "/websites/website-1/credentials/new";
const WEBSITE_API_URL = "/api/websites/website-1";
const CREDENTIALS_API_URL = "/api/websites/website-1/credentials";

/** History as it is after clicking "New credential" on the website's page. */
const OPENED_FROM_DETAIL: RouterStart = {
  initialEntries: [DETAIL_PATH, { pathname: NEW_CREDENTIAL_PATH, state: { returnTo: DETAIL_PATH } }],
};

/** History after opening the form directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [NEW_CREDENTIAL_PATH] };

/**
 * Renders the create page on its real route.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderCredentialCreatePage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <Route path="/websites/:websiteId/credentials/new" element={<CredentialCreatePage />} />,
    routerStart,
  );
}

/**
 * Stubs a successful load of the owning website, plus any extra routes.
 * @param extraRoutes - More replies, e.g. for the POST
 * @returns The installed fetch stub
 */
function stubLoadedWebsite(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    ...extraRoutes,
  });
}

/**
 * Finds a text field by its label, ignoring the required-field asterisk.
 * @param label - The field's label
 * @returns The field's input, once the form has mounted
 */
function findField(label: string): Promise<HTMLElement> {
  return screen.findByLabelText(new RegExp(`^${label}\\W*$`));
}

describe("CredentialCreatePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner and no form while the website loads", () => {
    const pendingWebsite = createDeferred<Response>();
    stubFetchRoutes({ [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise });

    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    expect(screen.getByRole("heading", { level: 1, name: "New credential" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading website" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create credential" })).not.toBeInTheDocument();
  });

  it("starts the login page URL blank, offering the website's login page, and names the website in the breadcrumbs", async () => {
    stubLoadedWebsite();

    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    const loginUrlField = await findField("Login page URL");
    expect(loginUrlField).toHaveValue("");
    expect(loginUrlField).not.toBeRequired();
    expect(loginUrlField).toHaveAttribute("placeholder", "https://example.com/login");
    expect(loginUrlField).toHaveAccessibleDescription(
      "Leave blank to use the website's login page (https://example.com/login)",
    );
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: "/" },
      { label: "Example", href: DETAIL_PATH },
      { label: "New credential", href: null },
    ]);
  });

  it("puts a plus on the Create credential button", async () => {
    stubLoadedWebsite();

    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    const createButton = await screen.findByRole("button", { name: "Create credential" });
    expect(within(createButton).getByTestId("AddIcon")).toBeInTheDocument();
  });

  it("POSTs the new credential and goes back to the website's page", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({
      [`POST ${CREDENTIALS_API_URL}`]: { status: 201, body: buildCredentialRecord() },
    });
    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    await user.type(await findField("Name"), "Admin");
    await user.type(await findField("Username"), "admin@example.com");
    await user.type(await findField("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).toHaveBeenCalledWith(CREDENTIALS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Admin",
        description: "",
        username: "admin@example.com",
        password: "correct horse",
        loginUrl: "",
        usernameSelector: "",
        passwordSelector: "",
        submitSelector: "",
      }),
    });
  });

  it("requires a login page URL when the website has none, and POSTs the typed one", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
      [`POST ${CREDENTIALS_API_URL}`]: { status: 201, body: buildCredentialRecord() },
    });
    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    const loginUrlField = await findField("Login page URL");
    expect(loginUrlField).toHaveValue("");
    expect(loginUrlField).toBeRequired();
    expect(loginUrlField).toHaveAccessibleDescription(
      "This website has no login page URL yet - enter it here (a successful login will also save it to the website)",
    );
    await user.type(await findField("Name"), "Admin");
    await user.type(await findField("Username"), "admin@example.com");
    await user.type(await findField("Password"), "correct horse");
    expect(screen.getByRole("button", { name: "Create credential" })).toBeDisabled();
    await user.type(loginUrlField, "https://example.com/sign-in");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    await readProbeAfterLanding(DETAIL_PATH);
    expect(fetchStub).toHaveBeenCalledWith(CREDENTIALS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Admin",
        description: "",
        username: "admin@example.com",
        password: "correct horse",
        loginUrl: "https://example.com/sign-in",
        usernameSelector: "",
        passwordSelector: "",
        submitSelector: "",
      }),
    });
  });

  it("replaces the form with the website's page on save after a deep link", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({
      [`POST ${CREDENTIALS_API_URL}`]: { status: 201, body: buildCredentialRecord() },
    });
    renderCredentialCreatePage(OPENED_BY_DEEP_LINK);

    await user.type(await findField("Name"), "Admin");
    await user.type(await findField("Username"), "admin");
    await user.type(await findField("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });

  it("shows the server's error and stays on the form when the save is refused", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({
      [`POST ${CREDENTIALS_API_URL}`]: {
        status: 503,
        body: { error: "CREDENTIAL_ENCRYPTION_KEY is not set in .env.local" },
      },
    });
    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    await user.type(await findField("Name"), "Admin");
    await user.type(await findField("Username"), "admin");
    await user.type(await findField("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "CREDENTIAL_ENCRYPTION_KEY is not set in .env.local",
    );
    expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
  });

  it("goes back to the website's page on Cancel without saving", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite();
    renderCredentialCreatePage(OPENED_FROM_DETAIL);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(countRequests(fetchStub, "POST", CREDENTIALS_API_URL)).toBe(0);
  });
});
