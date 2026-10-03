import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import CredentialEditPage from "../../src/pages/CredentialEditPage";
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
const EDIT_PATH = "/websites/website-1/credentials/credential-1/edit";
const WEBSITE_API_URL = "/api/websites/website-1";
const CREDENTIAL_API_URL = "/api/websites/website-1/credentials/credential-1";

/** History as it is after clicking the credential on the website's page. */
const OPENED_FROM_DETAIL: RouterStart = {
  initialEntries: [DETAIL_PATH, { pathname: EDIT_PATH, state: { returnTo: DETAIL_PATH } }],
};

/** History after opening the form directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [EDIT_PATH] };

/** The saved credential, with selectors for two of the three form parts. */
const savedCredential = buildCredentialRecord({
  usernameSelector: "#email",
  submitSelector: "button.sign-in",
});

/**
 * Renders the edit page on its real route.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderCredentialEditPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/credentials/:credentialId/edit"
      element={<CredentialEditPage />}
    />,
    routerStart,
  );
}

/**
 * Stubs a successful load of the website and the credential, plus any extra routes.
 * @param extraRoutes - More replies, e.g. for the PUT or DELETE
 * @returns The installed fetch stub
 */
function stubLoadedCredential(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${CREDENTIAL_API_URL}`]: { status: 200, body: savedCredential },
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

describe("CredentialEditPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner, no form, and no Delete button while the credential loads", () => {
    const pendingCredential = createDeferred<Response>();
    stubLoadedCredential({ [`GET ${CREDENTIAL_API_URL}`]: () => pendingCredential.promise });

    renderCredentialEditPage(OPENED_FROM_DETAIL);

    expect(screen.getByRole("progressbar", { name: "Loading credential" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows a spinner and no form until the website has loaded too", () => {
    const pendingWebsite = createDeferred<Response>();
    stubLoadedCredential({ [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise });

    renderCredentialEditPage(OPENED_FROM_DETAIL);

    expect(screen.getByRole("progressbar", { name: "Loading credential" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows the website's load failure and no form", async () => {
    stubLoadedCredential({
      [`GET ${WEBSITE_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });

    renderCredentialEditPage(OPENED_FROM_DETAIL);

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows the server's not-found text and no form for a deleted credential", async () => {
    stubLoadedCredential({
      [`GET ${CREDENTIAL_API_URL}`]: { status: 404, body: { error: "Credential not found" } },
    });

    renderCredentialEditPage(OPENED_FROM_DETAIL);

    expect(await screen.findByRole("alert")).toHaveTextContent("Credential not found");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("pre-fills every field except the password, and names the credential in the breadcrumbs", async () => {
    stubLoadedCredential();

    renderCredentialEditPage(OPENED_FROM_DETAIL);

    expect(await findField("Name")).toHaveValue("Admin");
    expect(await findField("Description")).toHaveValue("The admin account");
    expect(await findField("Username")).toHaveValue("admin@example.com");
    expect(await findField("Login page URL")).toHaveValue("https://example.com/login");
    expect(await findField("Password")).toHaveValue("");
    expect(await findField("Username field selector")).toHaveValue("#email");
    expect(await findField("Password field selector")).toHaveValue("");
    expect(await findField("Submit button selector")).toHaveValue("button.sign-in");
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: "/websites" },
      { label: "Example", href: DETAIL_PATH },
      { label: "Admin", href: null },
      { label: "Edit", href: null },
    ]);
  });

  it("pre-fills blanks for a credential with no description or selectors", async () => {
    stubLoadedCredential({
      [`GET ${CREDENTIAL_API_URL}`]: {
        status: 200,
        body: buildCredentialRecord({ description: null }),
      },
    });

    renderCredentialEditPage(OPENED_FROM_DETAIL);

    expect(await findField("Description")).toHaveValue("");
    expect(await findField("Username field selector")).toHaveValue("");
  });

  it("starts the login page URL blank for a credential that uses the website's, and PUTs it blank", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedCredential({
      [`GET ${CREDENTIAL_API_URL}`]: {
        status: 200,
        body: buildCredentialRecord({ loginUrl: null }),
      },
      [`PUT ${CREDENTIAL_API_URL}`]: { status: 200, body: savedCredential },
    });
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    const loginUrlField = await findField("Login page URL");
    expect(loginUrlField).toHaveValue("");
    expect(loginUrlField).not.toBeRequired();
    expect(loginUrlField).toHaveAttribute("placeholder", "https://example.com/login");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await readProbeAfterLanding(DETAIL_PATH);
    expect(fetchStub).toHaveBeenCalledWith(CREDENTIAL_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Admin",
        description: "The admin account",
        username: "admin@example.com",
        password: "",
        loginUrl: "",
        usernameSelector: "",
        passwordSelector: "",
        submitSelector: "",
      }),
    });
  });

  it("requires the credential's own login page URL when the website has none", async () => {
    const user = userEvent.setup();
    stubLoadedCredential({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
    });
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    const loginUrlField = await findField("Login page URL");
    expect(loginUrlField).toHaveValue("https://example.com/login");
    expect(loginUrlField).toBeRequired();
    expect(loginUrlField).toHaveAccessibleDescription(
      "This website has no login page URL yet - enter it here (a successful login will also save it to the website)",
    );
    await user.clear(loginUrlField);

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("PUTs the edits with a blank password (keeping the saved one) and goes back to the website's page", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedCredential({
      [`PUT ${CREDENTIAL_API_URL}`]: { status: 200, body: savedCredential },
    });
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    const descriptionField = await findField("Description");
    await user.clear(descriptionField);
    await user.type(descriptionField, "Edited");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).toHaveBeenCalledWith(CREDENTIAL_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Admin",
        description: "Edited",
        username: "admin@example.com",
        password: "",
        loginUrl: "https://example.com/login",
        usernameSelector: "#email",
        passwordSelector: "",
        submitSelector: "button.sign-in",
      }),
    });
  });

  it("shows the server's error and stays on the form when the save is rejected", async () => {
    const user = userEvent.setup();
    stubLoadedCredential({
      [`PUT ${CREDENTIAL_API_URL}`]: {
        status: 400,
        body: { error: "The login page URL must be a valid http:// or https:// address" },
      },
    });
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The login page URL must be a valid http:// or https:// address",
    );
    expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
  });

  it("replaces the form with the website's page on Cancel after a deep link, saving nothing", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedCredential();
    renderCredentialEditPage(OPENED_BY_DEEP_LINK);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
    expect(countRequests(fetchStub, "PUT", CREDENTIAL_API_URL)).toBe(0);
  });

  it("asks before deleting, then DELETEs the credential and goes back to the website's page", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedCredential({
      [`DELETE ${CREDENTIAL_API_URL}`]: { status: 204, body: null },
    });
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete credential?" });
    expect(dialog).toHaveTextContent(
      '"Admin" will be deleted. Past crawls that logged in with it keep its name.',
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(countRequests(fetchStub, "DELETE", CREDENTIAL_API_URL)).toBe(1);
  });

  it("closes the delete dialog on Cancel without deleting", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedCredential();
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete credential?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(countRequests(fetchStub, "DELETE", CREDENTIAL_API_URL)).toBe(0);
  });

  it("keeps the dialog open with the server's reason when the delete fails", async () => {
    const user = userEvent.setup();
    stubLoadedCredential({
      [`DELETE ${CREDENTIAL_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });
    renderCredentialEditPage(OPENED_FROM_DETAIL);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete credential?" });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByRole("dialog", { name: "Delete credential?" })).toBeInTheDocument();
  });
});
