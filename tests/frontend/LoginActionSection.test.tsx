import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import LoginActionSection, {
  describeLoginRunOutcome,
  type LoginActionSectionProps,
} from "../../src/components/LoginActionSection";
import { buildLoginRunRecord } from "./support/frontendTestHelpers";

/** "Now" for every spec: three hours after the newest run. */
const NOW = new Date("2026-04-06T06:04:05.000Z");

/** The newest run: logged in as Admin three hours before `NOW`, in 3.2 s, ending on the dashboard. */
const passedRun = buildLoginRunRecord({ id: "login-run-3", createdAt: "2026-04-06T03:04:05.000Z" });

/** An hour older: a run that failed with a reason, and a screenshot of the failure. */
const failedRun = buildLoginRunRecord({
  id: "login-run-2",
  succeeded: false,
  errorMessage: "The login form was still there after submitting",
  screenshotFileName: "website-1/login-run-2.png",
  finalPageUrl: null,
  createdAt: "2026-04-06T02:04:05.000Z",
});

/** The oldest run, another hour older, which passed. */
const oldestRun = buildLoginRunRecord({ id: "login-run-1", createdAt: "2026-04-06T01:04:05.000Z" });

/** The website's two credentials, as the "Log in as" select offers them. */
const WEBSITE_CREDENTIALS = [
  { id: "credential-1", name: "Admin" },
  { id: "credential-2", name: "Editor" },
];

/**
 * Renders the section with a loaded run list and a runnable Login action by
 * default (logging in as the first of two credentials), overridden per test.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<LoginActionSectionProps> = {}): RenderResult {
  const props: LoginActionSectionProps = {
    websiteId: "website-1",
    actionId: "login-action-1",
    runs: [passedRun, failedRun, oldestRun],
    isLoading: false,
    errorMessage: null,
    runBlockedReason: null,
    credentials: WEBSITE_CREDENTIALS,
    selectedCredentialId: "credential-1",
    onSelectedCredentialChange: vi.fn(),
    isRunning: false,
    runErrorMessage: null,
    onRunLogin: vi.fn(),
    now: NOW,
    ...overrides,
  };
  return render(<LoginActionSection {...props} />);
}

describe("describeLoginRunOutcome", () => {
  it("words a passed run as Logged in and a failed one as Login failed", () => {
    expect(describeLoginRunOutcome(passedRun)).toBe("Logged in");
    expect(describeLoginRunOutcome(failedRun)).toBe("Login failed");
  });
});

describe("LoginActionSection", () => {
  it("explains that a Login action has no steps, and runs the login when Run login is clicked", async () => {
    const user = userEvent.setup();
    const onRunLogin = vi.fn();
    renderSection({ onRunLogin });

    expect(screen.getByText(/^The login action has no steps/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run login" }));

    expect(onRunLogin).toHaveBeenCalledTimes(1);
  });

  it("disables Run login and says why while it cannot run", () => {
    renderSection({
      runBlockedReason: "Save a credential on the website's Credentials tab first",
      credentials: [],
      selectedCredentialId: null,
    });

    expect(screen.getByRole("button", { name: "Run login" })).toBeDisabled();
    expect(screen.getByText("Save a credential on the website's Credentials tab first")).toBeInTheDocument();
  });

  it("shows Logging in… with a progress bar, and disables the button and the Log in as select, while a run is in flight", () => {
    renderSection({ isRunning: true });

    expect(screen.getByRole("button", { name: "Logging in…" })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "Logging in" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Log in as" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows no progress bar or blocked reason while it can run and nothing runs", () => {
    renderSection();

    expect(screen.getByRole("button", { name: "Run login" })).toBeEnabled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Credentials tab/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Log in as" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows the picked credential in Log in as, offers each of the website's credentials, and hands a newly picked one's id to the page", async () => {
    const user = userEvent.setup();
    const onSelectedCredentialChange = vi.fn();
    renderSection({ onSelectedCredentialChange });

    const credentialSelect = screen.getByRole("combobox", { name: "Log in as" });
    expect(credentialSelect).toHaveTextContent("Admin");
    await user.click(credentialSelect);
    const credentialOptions = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(credentialOptions.map((credentialOption) => credentialOption.textContent)).toEqual(["Admin", "Editor"]);
    await user.click(screen.getByRole("option", { name: "Editor" }));

    expect(onSelectedCredentialChange).toHaveBeenCalledWith("credential-2");
  });

  it("hides Log in as while the website has no credentials", () => {
    renderSection({ credentials: [], selectedCredentialId: null });

    expect(screen.queryByRole("combobox", { name: "Log in as" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run login" })).toBeInTheDocument();
  });

  it("hides Log in as while no credential is picked yet", () => {
    renderSection({ selectedCredentialId: null });

    expect(screen.queryByRole("combobox", { name: "Log in as" })).not.toBeInTheDocument();
  });

  it("shows why the last Run login request failed", () => {
    renderSection({ runs: [], runErrorMessage: "A login is already running" });

    expect(screen.getByRole("alert")).toHaveTextContent("A login is already running");
  });

  it("says it has not run yet when it has no runs", () => {
    renderSection({ runs: [] });

    expect(screen.getByText("Not run yet. Run the login to check it works.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Latest run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "History" })).not.toBeInTheDocument();
  });

  it("shows a spinner, and neither runs nor the not-run text, while the runs load", () => {
    renderSection({ runs: null, isLoading: true });

    expect(screen.getByRole("progressbar", { name: "Loading login runs" })).toBeInTheDocument();
    expect(screen.queryByText(/Not run yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Latest run" })).not.toBeInTheDocument();
  });

  it("shows why the runs could not be loaded", () => {
    renderSection({ runs: null, errorMessage: "Database unavailable" });

    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText(/Not run yet/)).not.toBeInTheDocument();
  });

  it("shows the latest passed run: who it logged in as, when, how long, where, its screenshot, and its log", () => {
    renderSection();

    const latestRun = screen.getByRole("region", { name: "Latest run" });
    expect(within(latestRun).getByRole("alert")).toHaveTextContent("Logged in as “Admin”");
    expect(latestRun).toHaveTextContent(
      "3 h ago · took 0:03 · login page https://example.com/login · ended on https://example.com/dashboard",
    );
    expect(within(latestRun).getByTitle(new Date(passedRun.createdAt).toLocaleString())).toHaveTextContent("3 h ago");
    expect(within(latestRun).getByRole("img", { name: "The page after logging in" })).toHaveAttribute(
      "src",
      "/api/websites/website-1/actions/login-action-1/login-runs/login-run-3/screenshot",
    );
    expect(within(latestRun).getByLabelText("Login run log")).toHaveTextContent("▶ Open the login page ✔ Logged in");
  });

  it("shows the latest failed run's reason and what the page showed, without an end page it never reached", () => {
    renderSection({ runs: [failedRun] });

    const latestRun = screen.getByRole("region", { name: "Latest run" });
    expect(within(latestRun).getByRole("alert")).toHaveTextContent(
      "Could not log in as “Admin”: The login form was still there after submitting",
    );
    expect(latestRun).not.toHaveTextContent("ended on");
    expect(
      within(latestRun).getByRole("img", { name: "What the page showed when the login failed" }),
    ).toHaveAttribute("src", "/api/websites/website-1/actions/login-action-1/login-runs/login-run-2/screenshot");
  });

  it("says no reason was given for a failed run without one", () => {
    renderSection({ runs: [{ ...failedRun, errorMessage: null }] });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not log in as “Admin”: no reason was given");
  });

  it("shows no screenshot for a run that could not take one", () => {
    renderSection({ runs: [{ ...passedRun, screenshotFileName: null }] });

    const latestRun = screen.getByRole("region", { name: "Latest run" });
    expect(within(latestRun).queryByRole("img")).not.toBeInTheDocument();
    expect(within(latestRun).getByLabelText("Login run log")).toBeInTheDocument();
  });

  it("lists the older runs in the history, each with its outcome, when, and any reason", () => {
    renderSection();

    const history = screen.getByRole("region", { name: "History" });
    const historyRows = within(history).getAllByRole("listitem");
    expect(historyRows).toHaveLength(2);
    expect(historyRows[0]).toHaveTextContent(
      "Login failed4 h ago— The login form was still there after submitting",
    );
    expect(within(historyRows[0]).getByTitle(new Date(failedRun.createdAt).toLocaleString())).toBeInTheDocument();
    expect(historyRows[1]).toHaveTextContent("Logged in5 h ago");
    expect(historyRows[1]).not.toHaveTextContent("—");
  });

  it("shows no history while there is only the latest run", () => {
    renderSection({ runs: [passedRun] });

    expect(screen.getByRole("region", { name: "Latest run" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "History" })).not.toBeInTheDocument();
  });
});
