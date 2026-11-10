import { describe, it, expect, vi } from "vitest";
import { screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import CredentialsSection, {
  describeCredentialsNeeded,
  describeLoginCheckWithoutLoginAction,
  type CredentialsLoginAction,
  type CredentialsSectionProps,
} from "../../src/components/CredentialsSection";
import { type CredentialRecord } from "../../src/hooks/useCredentials";
import { type JsonResourceState } from "../../src/hooks/useJsonResource";
import { type LoginCheckRecord } from "../../src/hooks/useWebsites";
import { buildCredentialRecord, readProbeAfterLanding, renderPageRoutes } from "./support/frontendTestHelpers";

const WEBSITE_PATH = "/websites/website-1";

/** The website's Login action, logging in at the website's login page. */
const WEBSITE_LOGIN_ACTION: CredentialsLoginAction = {
  id: "login-action-1",
  title: "Sign in",
  loginUrl: "https://example.com/login",
};

/**
 * Builds a login-form check as the API returns it: by default one that
 * found no login form.
 * @param overrides - Fields to replace in the default check
 * @returns The login check record
 */
function buildLoginCheckRecord(overrides: Partial<LoginCheckRecord> = {}): LoginCheckRecord {
  return { outcome: "notFound", loginUrl: null, loginActionId: null, message: null, ...overrides };
}

/**
 * Wraps a loaded credential list in the request state the section takes.
 * @param credentials - The loaded credentials
 * @returns A loaded list request
 */
function loadedCredentials(credentials: CredentialRecord[]): JsonResourceState<CredentialRecord[]> {
  return { data: credentials, isLoading: false, errorMessage: null, reload: vi.fn() };
}

/**
 * Renders the section on the website's detail route, so its links can be
 * followed onto the location probe. By default the website has no
 * credentials and - known from a loaded action list - no Login action, and
 * no login-form check has been made.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<CredentialsSectionProps> = {}): RenderResult {
  const props: CredentialsSectionProps = {
    websiteId: "website-1",
    credentialsResource: loadedCredentials([]),
    returnToHereState: { returnTo: WEBSITE_PATH },
    loginAction: null,
    loginActionIsKnown: true,
    loginFormWasJustFound: false,
    isCheckingForLoginForm: false,
    loginCheckErrorMessage: null,
    lastLoginCheck: null,
    onLookForLoginForm: vi.fn(),
    ...overrides,
  };
  return renderPageRoutes(
    <Route path="/websites/:websiteId" element={<CredentialsSection {...props} />} />,
    { initialEntries: [WEBSITE_PATH] },
  );
}

describe("describeLoginCheckWithoutLoginAction", () => {
  it("says no login form was found, and how else a website may log in", () => {
    expect(describeLoginCheckWithoutLoginAction(buildLoginCheckRecord({ outcome: "notFound" }))).toBe(
      "No login form was found on the website's page or behind a “Log in” / “Sign in” link. If it logs in some other way (in a pop-up, or with single sign-on), add an action with the kind Login.",
    );
  });

  it("says why the check could not look, or that no reason was given", () => {
    expect(
      describeLoginCheckWithoutLoginAction(buildLoginCheckRecord({ outcome: "failed", message: "Timeout 30000ms exceeded" })),
    ).toBe("Could not look for a login form: Timeout 30000ms exceeded");
    expect(describeLoginCheckWithoutLoginAction(buildLoginCheckRecord({ outcome: "failed", message: null }))).toBe(
      "Could not look for a login form: no reason was given",
    );
  });

  it.each([
    { outcome: "found" as const, label: "made the Login action" },
    { outcome: "alreadyHasLoginAction" as const, label: "found the website already has one" },
  ])("says nothing when the check $label", ({ outcome }) => {
    expect(
      describeLoginCheckWithoutLoginAction(
        buildLoginCheckRecord({ outcome, loginUrl: "https://example.com/login", loginActionId: "login-action-1" }),
      ),
    ).toBeNull();
  });
});

describe("describeCredentialsNeeded", () => {
  it("says the website logs in with its Login action at its login page, and asks for accounts", () => {
    expect(describeCredentialsNeeded(WEBSITE_LOGIN_ACTION, false)).toBe(
      "This website logs in at https://example.com/login with the login action “Sign in”. Add the accounts your actions should log in as.",
    );
  });

  it("says the login form was just found, right after website create", () => {
    expect(describeCredentialsNeeded(WEBSITE_LOGIN_ACTION, true)).toBe(
      "Found a login form at https://example.com/login, and added the login action “Sign in”. Add the accounts your actions should log in as.",
    );
  });

  it("names the login page generically while the Login action has none", () => {
    const loginActionWithoutPage = { ...WEBSITE_LOGIN_ACTION, loginUrl: null };
    expect(describeCredentialsNeeded(loginActionWithoutPage, false)).toBe(
      "This website logs in at its login page with the login action “Sign in”. Add the accounts your actions should log in as.",
    );
    expect(describeCredentialsNeeded(loginActionWithoutPage, true)).toBe(
      "Found a login form at its login page, and added the login action “Sign in”. Add the accounts your actions should log in as.",
    );
  });
});

describe("CredentialsSection", () => {
  describe("a website without a Login action", () => {
    it("says no login form was found yet, and looks for one when asked", async () => {
      const user = userEvent.setup();
      const onLookForLoginForm = vi.fn();
      renderSection({ onLookForLoginForm });

      expect(screen.getByText("No login form found on this website yet.")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Look for a login form" }));

      expect(onLookForLoginForm).toHaveBeenCalledTimes(1);
    });

    it("disables the button and shows progress while it looks", () => {
      renderSection({ isCheckingForLoginForm: true });

      expect(screen.getByRole("button", { name: "Looking for a login form…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Looking for a login form" })).toBeInTheDocument();
    });

    it("tells what the last check found when it made no Login action, as information", () => {
      renderSection({ lastLoginCheck: buildLoginCheckRecord({ outcome: "notFound" }) });

      const checkResultAlert = screen.getByRole("alert");
      expect(checkResultAlert).toHaveTextContent(/^No login form was found on the website's page/);
      expect(checkResultAlert).toHaveClass("MuiAlert-standardInfo");
    });

    it("tells why the last check failed, as an error", () => {
      renderSection({ lastLoginCheck: buildLoginCheckRecord({ outcome: "failed", message: "Navigation failed" }) });

      const checkResultAlert = screen.getByRole("alert");
      expect(checkResultAlert).toHaveTextContent("Could not look for a login form: Navigation failed");
      expect(checkResultAlert).toHaveClass("MuiAlert-standardError");
    });

    it("shows nothing for a check that made the Login action (the page reloads the actions)", () => {
      renderSection({ lastLoginCheck: buildLoginCheckRecord({ outcome: "found" }) });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows why the check request failed", () => {
      renderSection({ loginCheckErrorMessage: "Website not found" });

      expect(screen.getByRole("alert")).toHaveTextContent("Website not found");
    });

    it("says nothing about the login form until the action list has loaded", () => {
      renderSection({ loginActionIsKnown: false });

      expect(screen.queryByText("No login form found on this website yet.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Look for a login form" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "New credential" })).toBeInTheDocument();
    });
  });

  describe("a website with a Login action but no credentials", () => {
    it("asks for credentials, naming the Login action, with an Add credential link that returns here", async () => {
      const user = userEvent.setup();
      renderSection({ loginAction: WEBSITE_LOGIN_ACTION });

      const credentialsNeededAlert = screen.getByRole("alert");
      expect(credentialsNeededAlert).toHaveTextContent(describeCredentialsNeeded(WEBSITE_LOGIN_ACTION, false));
      expect(screen.queryByRole("button", { name: "Look for a login form" })).not.toBeInTheDocument();
      expect(screen.getByText("No credentials yet.")).toBeInTheDocument();

      const addCredentialLink = within(credentialsNeededAlert).getByRole("link", { name: "Add credential" });
      expect(within(addCredentialLink).getByTestId("AddIcon")).toBeInTheDocument();
      await user.click(addCredentialLink);
      const landing = await readProbeAfterLanding("/websites/website-1/credentials/new");
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
    });

    it("says the login form was just found, right after website create", () => {
      renderSection({ loginAction: WEBSITE_LOGIN_ACTION, loginFormWasJustFound: true });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Found a login form at https://example.com/login, and added the login action “Sign in”.",
      );
    });

    it("waits for the credential list before asking for credentials", () => {
      renderSection({
        loginAction: WEBSITE_LOGIN_ACTION,
        credentialsResource: { data: null, isLoading: true, errorMessage: null, reload: vi.fn() },
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Loading credentials" })).toBeInTheDocument();
      expect(screen.queryByText(/Logs in with the login action/)).not.toBeInTheDocument();
    });
  });

  describe("a website with a Login action and credentials", () => {
    it("names the Login action, linking to it, and where it logs in", async () => {
      const user = userEvent.setup();
      renderSection({
        loginAction: WEBSITE_LOGIN_ACTION,
        credentialsResource: loadedCredentials([buildCredentialRecord()]),
      });

      const loginActionLink = screen.getByRole("link", { name: "Sign in" });
      expect(loginActionLink.parentElement).toHaveTextContent(
        "Logs in with the login action Sign in at https://example.com/login",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Look for a login form" })).not.toBeInTheDocument();

      await user.click(loginActionLink);
      const landing = await readProbeAfterLanding("/websites/website-1/actions/login-action-1");
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
    });

    it("says when the Login action has no login page yet", () => {
      renderSection({
        loginAction: { ...WEBSITE_LOGIN_ACTION, loginUrl: null },
        credentialsResource: loadedCredentials([buildCredentialRecord()]),
      });

      expect(screen.getByRole("link", { name: "Sign in" }).parentElement).toHaveTextContent(
        "Logs in with the login action Sign in (it has no login page yet)",
      );
    });

    it("lists the credentials under the hint on picking one to log in as", () => {
      renderSection({
        loginAction: WEBSITE_LOGIN_ACTION,
        credentialsResource: loadedCredentials([buildCredentialRecord()]),
      });

      expect(screen.getByText(/^Accounts for this website\. Pick one as an action/)).toBeInTheDocument();
      const credentialList = screen.getByRole("list", { name: "Credentials" });
      expect(within(credentialList).getByRole("link")).toHaveTextContent("Admin");
    });
  });
});
