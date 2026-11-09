import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import ActionScriptRunPage from "../../src/pages/ActionScriptRunPage";
import { type ActionScriptRunDetailRecord } from "../../src/hooks/useActionScriptRun";
import {
  buildActionScriptRecord,
  buildActionScriptRunDetailRecord,
  buildActionScriptRunScreenshotRecord,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  createDeferred,
  readBreadcrumbTrail,
  renderPageRoutes,
  stubFetchRoutes,
  stubWindowWidth,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const RUN_PAGE_PATH = "/websites/website-1/actions/item-1/scripts/script-1/runs/script-run-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const ACTION_API_URL = "/api/websites/website-1/actions/item-1";
const SCRIPTS_API_URL = `${ACTION_API_URL}/scripts`;
const RUN_API_URL = `${SCRIPTS_API_URL}/script-1/runs/script-run-1`;

/** The version the run ran - Version 2 of 2: a click, then a check. */
const ranScript = buildActionScriptRecord({ id: "script-1" });
const olderScript = buildActionScriptRecord({ id: "script-0" });

const startPageScreenshot = buildActionScriptRunScreenshotRecord({
  id: "shot-start",
  position: 1,
  moment: "startPage",
  stepNumber: null,
  fileName: "website-1/run-folder/start-page.png",
});
const stepOneScreenshot = buildActionScriptRunScreenshotRecord({ id: "shot-step-1", position: 2, stepNumber: 1 });
const stepTwoScreenshot = buildActionScriptRunScreenshotRecord({
  id: "shot-step-2",
  position: 3,
  stepNumber: 2,
  fileName: "website-1/run-folder/step-002.png",
});

/** A passing run that took a screenshot after the start page and each of its two steps. */
const passingRun = buildActionScriptRunDetailRecord({
  finalPageUrl: "https://example.com/welcome",
  screenshots: [startPageScreenshot, stepOneScreenshot, stepTwoScreenshot],
});

/**
 * Stubs every request the run page makes, answering with the given run.
 * @param run - The run the run route answers with
 * @param overrides - Routes to replace
 * @returns The fetch stub
 */
function stubRunPageRoutes(run: ActionScriptRunDetailRecord, overrides: StubbedRouteTable = {}): ReturnType<typeof stubFetchRoutes> {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${ACTION_API_URL}`]: { status: 200, body: buildWebsiteItemRecord() },
    [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: [ranScript, olderScript] },
    [`GET ${RUN_API_URL}`]: { status: 200, body: run },
    ...overrides,
  });
}

/**
 * Renders the run page on its real route.
 * @returns The Testing Library render result
 */
function renderRunPage(): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/actions/:itemId/scripts/:actionScriptId/runs/:actionScriptRunId"
      element={<ActionScriptRunPage />}
    />,
    { initialEntries: [RUN_PAGE_PATH] },
  );
}

/**
 * Waits for the run to be shown (its "Version N run" heading).
 * @param headingText - The expected heading
 * @returns The heading
 */
async function waitForRun(headingText = "Version 2 run"): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 1, name: headingText });
}

describe("ActionScriptRunPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a spinner while the run loads, with a plain Run crumb", () => {
    const runResponse = createDeferred<Response>();
    stubRunPageRoutes(passingRun, { [`GET ${RUN_API_URL}`]: () => runResponse.promise });

    renderRunPage();

    expect(screen.getByRole("progressbar", { name: "Loading run" })).toBeInTheDocument();
    expect(readBreadcrumbTrail().at(-1)).toEqual({ label: "Run", href: null });
  });

  it("explains a run that does not exist", async () => {
    stubRunPageRoutes(passingRun, { [`GET ${RUN_API_URL}`]: { status: 404, body: { error: "Script run not found" } } });

    renderRunPage();

    expect(await screen.findByText("Script run not found")).toBeInTheDocument();
  });

  it("names the version, the outcome, and the facts, with breadcrumbs back to the action on this run", async () => {
    stubRunPageRoutes(passingRun);

    renderRunPage();

    await waitForRun();
    await waitFor(() => {
      expect(readBreadcrumbTrail().map((crumb) => crumb.label).slice(0, 3)).toEqual(["Websites", "Example", "Log in"]);
    });
    expect(readBreadcrumbTrail()[2].href).toBe("/websites/website-1/actions/item-1?script=script-1&run=script-run-1");
    expect(readBreadcrumbTrail()[3].label).toMatch(/^Run · /);
    expect(within(screen.getByRole("status")).getByText("Passed")).toBeInTheDocument();
    const facts = screen.getByLabelText("Run facts");
    expect(facts).toHaveTextContent("Took4.3 s");
    expect(facts).toHaveTextContent("Logged in asLogged out");
    expect(facts).toHaveTextContent("Ended onhttps://example.com/welcome");
    expect(screen.getByRole("heading", { name: "Output log" })).toBeInTheDocument();
  });

  it("shows the start page's screenshot before the steps, and each step's screenshot under it", async () => {
    stubRunPageRoutes(passingRun);

    renderRunPage();
    await waitForRun();

    const beforeTheSteps = screen.getByRole("list", { name: "Before the first step" });
    expect(within(beforeTheSteps).getByText("Opened the start page")).toBeInTheDocument();
    expect(within(beforeTheSteps).getByRole("img", { name: "Screenshot: Opened the start page" })).toHaveAttribute(
      "src",
      `${RUN_API_URL}/screenshots/shot-start`,
    );
    const planSteps = within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem");
    expect(within(planSteps[0]).getByRole("img", { name: 'Screenshot: Step 1 · Click link "Sign in"' })).toHaveAttribute(
      "src",
      `${RUN_API_URL}/screenshots/shot-step-1`,
    );
    expect(within(planSteps[1]).getByRole("button", { name: /^View full screen: Screenshot: Step 2 · / })).toBeInTheDocument();
    expect(screen.queryByText(/Step screenshots weren.t captured/)).not.toBeInTheDocument();
  });

  it("opens a clicked screenshot full screen at its place, and pages through all of the run's screenshots", async () => {
    const user = userEvent.setup();
    stubRunPageRoutes(passingRun);

    renderRunPage();
    await waitForRun();
    await user.click(screen.getByRole("button", { name: 'View full screen: Screenshot: Step 1 · Click link "Sign in"' }));

    const viewer = screen.getByRole("dialog", { name: 'Step 1 · Click link "Sign in"' });
    expect(within(viewer).getByLabelText("Screenshot position")).toHaveTextContent("2 / 3");
    await user.click(within(viewer).getByRole("button", { name: "Previous screenshot" }));
    expect(screen.getByRole("dialog", { name: "Opened the start page" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("dialog", { name: /^Step 2 · / })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows the failure screenshot under the step a failed run stopped at", async () => {
    const user = userEvent.setup();
    const failedRun = buildActionScriptRunDetailRecord({
      succeeded: false,
      failedStepNumber: 2,
      errorMessage: "locator.click: Timeout 10000ms exceeded.",
      failureScreenshotFileName: "website-1/run-folder/failure.png",
      failingPageUrl: "https://example.com/signed-in",
      screenshots: [startPageScreenshot, stepOneScreenshot],
    });
    stubRunPageRoutes(failedRun);

    renderRunPage();
    await waitForRun();

    expect(within(screen.getByRole("status")).getByText("Failed at step 2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("locator.click: Timeout 10000ms exceeded.");
    expect(screen.getByLabelText("Run facts")).toHaveTextContent("Failed onhttps://example.com/signed-in");
    const failedStep = within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem")[1];
    const failureScreenshot = within(failedStep).getByRole("img", { name: "Failure screenshot: Step 2 · failed here" });
    expect(failureScreenshot).toHaveAttribute("src", `${RUN_API_URL}/failure-screenshot`);

    await user.click(within(failedStep).getByRole("button", { name: /^View full screen: Failure screenshot/ }));
    expect(within(screen.getByRole("dialog", { name: "Step 2 · failed here" })).getByLabelText("Screenshot position")).toHaveTextContent(
      "3 / 3",
    );
  });

  it("says why a screenshot could not be taken in its place, and leaves it out of the full-screen viewer", async () => {
    const user = userEvent.setup();
    const runWithAMissedScreenshot = buildActionScriptRunDetailRecord({
      screenshots: [startPageScreenshot, { ...stepOneScreenshot, fileName: null, errorMessage: "Timeout 10000ms exceeded" }, stepTwoScreenshot],
    });
    stubRunPageRoutes(runWithAMissedScreenshot);

    renderRunPage();
    await waitForRun();

    const stepOne = within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem")[0];
    expect(within(stepOne).getByText("Screenshot could not be taken: Timeout 10000ms exceeded")).toBeInTheDocument();
    expect(within(stepOne).queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View full screen: Screenshot: Opened the start page" }));
    expect(screen.getByLabelText("Screenshot position")).toHaveTextContent("1 / 2");
    await user.click(screen.getByRole("button", { name: "Next screenshot" }));
    expect(screen.getByRole("dialog", { name: /^Step 2 · / })).toBeInTheDocument();
  });

  it("says when an older run took no step screenshots", async () => {
    stubRunPageRoutes(buildActionScriptRunDetailRecord());

    renderRunPage();
    await waitForRun();

    expect(screen.getByText("Step screenshots weren't captured for this run.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Before the first step" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Plan steps" })).toBeInTheDocument();
  });

  it("shows the login screenshot, the values used, and links to the cleanup run", async () => {
    const createRun = buildActionScriptRunDetailRecord({
      credentialName: "Admin",
      parameterValues: [{ key: "projectName", label: "Project name", value: "Apollo 7" }],
      createdObject: { id: "created-1", name: "Apollo 7", url: null, objectTypeName: "Project" },
      cleanupOutcome: "passed",
      cleanupActionScriptRunId: "run-delete-1",
      cleanupRun: {
        id: "run-delete-1",
        actionId: "item-2",
        actionScriptId: "script-delete-1",
        succeeded: true,
        errorMessage: null,
        failedStepNumber: null,
        timedOut: false,
        createdAt: "2026-04-03T03:05:00.000Z",
        action: { title: "Delete the project" },
      },
      screenshots: [buildActionScriptRunScreenshotRecord({ id: "shot-login", moment: "loggedIn", stepNumber: null })],
    });
    stubRunPageRoutes(createRun);

    renderRunPage();
    await waitForRun();

    expect(screen.getByLabelText("Run facts")).toHaveTextContent("Logged in asAdmin");
    expect(screen.getByRole("img", { name: "Screenshot: Logged in as Admin" })).toBeInTheDocument();
    expect(screen.getByText("Created Apollo 7 · cleaned up by a run of Delete the project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the cleanup run (Delete the project)" })).toHaveAttribute(
      "href",
      "/websites/website-1/actions/item-2/scripts/script-delete-1/runs/run-delete-1",
    );
    const valuesUsed = screen.getByRole("region", { name: "Values used" });
    expect(valuesUsed).toHaveTextContent("Project nameApollo 7");
  });

  it("links a cleanup run to the Create run it cleaned up after, and marks a blank value", async () => {
    const cleanupRun = buildActionScriptRunDetailRecord({
      parameterValues: [{ key: "note", label: "Note", value: "" }],
      cleanedUpRun: { id: "run-create-1", actionId: "item-3", actionScriptId: "script-create-1", action: { title: "Create a project" } },
    });
    stubRunPageRoutes(cleanupRun);

    renderRunPage();
    await waitForRun();

    expect(screen.getByRole("link", { name: "Open the run it cleaned up after (Create a project)" })).toHaveAttribute(
      "href",
      "/websites/website-1/actions/item-3/scripts/script-create-1/runs/run-create-1",
    );
    expect(screen.getByText("(left blank - its steps were skipped)")).toBeInTheDocument();
  });

  it("titles the page Run and lists the step screenshots on their own when the version is no longer listed", async () => {
    stubRunPageRoutes(passingRun, { [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: [olderScript] } });

    renderRunPage();
    await waitForRun("Run");

    expect(screen.queryByRole("list", { name: "Plan steps" })).not.toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Screenshot: Step 2" })).toBeInTheDocument();
  });

  it("shows a spinner in place of the steps while the versions load", async () => {
    const scriptsResponse = createDeferred<Response>();
    stubRunPageRoutes(passingRun, { [`GET ${SCRIPTS_API_URL}`]: () => scriptsResponse.promise });

    renderRunPage();
    await waitForRun("Run");

    expect(screen.getByRole("progressbar", { name: "Loading steps" })).toBeInTheDocument();
  });

  it("stacks everything in one column on a phone, the output log last", async () => {
    const restoreWindowWidth = stubWindowWidth(390);
    stubRunPageRoutes(passingRun);

    renderRunPage();
    await waitForRun();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings.at(-1)).toBe("Output log");
    expect(headings.indexOf("Steps")).toBeLessThan(headings.indexOf("Output log"));
    expect(screen.getByRole("img", { name: 'Screenshot: Step 1 · Click link "Sign in"' })).toBeInTheDocument();
    restoreWindowWidth();
  });
});
