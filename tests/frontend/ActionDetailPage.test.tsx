import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import ActionDetailPage from "../../src/pages/ActionDetailPage";
import { type ActionPlan } from "../../src/utils/actionPlanSteps";
import {
  ITEM_KIND_TEST_CASES,
  buildActionScriptRecord,
  buildActionScriptRefinementRecord,
  buildActionScriptRunRecord,
  buildJsonResponse,
  buildScriptModelCatalog,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  type FetchStub,
  type RouterStart,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";
import { defineWebsiteItemDetailPageCases } from "./support/websiteItemDetailPageCases";

const ACTION_TEST_CASE = ITEM_KIND_TEST_CASES[1];
const ACTION_PATH = "/websites/website-1/actions/item-1";
const ACTION_API_URL = "/api/websites/website-1/actions/item-1";
const SCRIPTS_API_URL = `${ACTION_API_URL}/scripts`;
const SCRIPT_MODELS_API_URL = "/api/script-models";

/** Matches the Model dropdown, whose accessible name also carries the chosen model. */
const MODEL_SELECT_NAME = /^Model/;

/** Matches the Effort dropdown, whose accessible name also carries the chosen level. */
const EFFORT_SELECT_NAME = /^Effort/;

/**
 * Builds the url that saves an edit of one script of the action under test as a new version.
 * @param actionScriptId - The id of the version that was edited
 * @returns The script's edits API url
 */
function editsApiUrl(actionScriptId: string): string {
  return `${SCRIPTS_API_URL}/${actionScriptId}/edits`;
}

/**
 * Builds the runs url of one script of the action under test.
 * @param actionScriptId - The script's id
 * @returns The script's runs API url
 */
function runsApiUrl(actionScriptId: string): string {
  return `${SCRIPTS_API_URL}/${actionScriptId}/runs`;
}

/**
 * Builds the url that refines a failed run of one script of the action under test.
 * @param actionScriptId - The id of the version that was run
 * @param actionScriptRunId - The failed run's id
 * @returns The run's refinements API url
 */
function refinementsApiUrl(actionScriptId: string, actionScriptRunId: string): string {
  return `${runsApiUrl(actionScriptId)}/${actionScriptRunId}/refinements`;
}

/**
 * Renders the action page on its real route, keyed exactly as App.tsx
 * declares it.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderActionDetailPage(routerStart: RouterStart = { initialEntries: [ACTION_PATH] }): RenderResult {
  return renderPageRoutes(
    <Route path="/websites/:websiteId/actions/:itemId" element={<ActionDetailPage key="action-detail" />} />,
    routerStart,
  );
}

const olderScript = buildActionScriptRecord({
  id: "script-1",
  createdAt: "2026-04-01T00:00:00.000Z",
});
const newerScript = buildActionScriptRecord({
  id: "script-2",
  summary: "The newer summary.",
  assumptions: [],
  plan: {
    name: "Log in",
    startUrl: "https://example.com/",
    steps: [{ action: "click", target: { role: "button", name: "Log in" }, value: null }],
  },
  createdAt: "2026-04-05T00:00:00.000Z",
});

/**
 * Stubs the website, the action, and the action's script list, plus any
 * extra or replacement routes (runs, POSTs).
 * @param scripts - What the script list answers with
 * @param extraRoutes - More replies
 * @returns The installed fetch stub
 */
function stubLoadedAction(
  scripts: unknown[],
  extraRoutes: StubbedRouteTable = {},
): FetchStub {
  return stubFetchRoutes({
    "GET /api/websites/website-1": { status: 200, body: buildWebsiteRecord() },
    [`GET ${ACTION_API_URL}`]: { status: 200, body: buildWebsiteItemRecord() },
    [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: scripts },
    [`GET ${SCRIPT_MODELS_API_URL}`]: { status: 200, body: buildScriptModelCatalog() },
    ...extraRoutes,
  });
}

/**
 * Waits until the model list has loaded and "Convert to script" can be
 * clicked.
 * @returns The enabled Convert button
 */
async function waitForConvertButton(): Promise<HTMLElement> {
  const convertButton = await screen.findByRole("button", { name: "Convert to script" });
  await waitFor(() => {
    expect(convertButton).toBeEnabled();
  });
  return convertButton;
}

/**
 * Builds what `useJsonMutation` sends for a convert request with this choice.
 * @param modelId - The chosen model's id
 * @param effort - The chosen effort level, or null
 * @returns The fetch init the stub should have received
 */
function buildConvertRequestInit(modelId: string, effort: string | null): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId, effort }),
  };
}

/**
 * Builds what `useJsonMutation` sends to save an edited plan as a new version.
 * @param plan - The edited plan
 * @returns The fetch init the stub should have received
 */
function buildEditRequestInit(plan: ActionPlan): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  };
}

/**
 * Builds what `useJsonMutation` sends to refine a failed run.
 * @param note - The note for Claude, or null when none was given
 * @returns The fetch init the stub should have received
 */
function buildRefineRequestInit(note: string | null): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  };
}

/**
 * Reads the step sentences of the selected version's read-only step list.
 * @returns Each listed step's text, in order
 */
function readListedSteps(): string[] {
  const stepList = screen.getByRole("list", { name: "Plan steps" });
  return within(stepList)
    .getAllByRole("listitem")
    .map((stepItem) => stepItem.textContent);
}

/**
 * Opens the selected version's step editor and renames the plan, which is
 * enough of a change to enable "Save as new version".
 * @param user - The user-event session
 * @param planName - The new plan name
 */
async function renamePlanInEditor(
  user: ReturnType<typeof userEvent.setup>,
  planName: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Edit steps" }));
  const planNameField = screen.getByRole("textbox", { name: "Plan name" });
  await user.clear(planNameField);
  await user.type(planNameField, planName);
}

/**
 * Picks an option from one of the MUI select dropdowns.
 * @param user - The user-event session
 * @param selectName - The dropdown's accessible name pattern
 * @param optionName - The option's text
 */
async function pickFromSelect(
  user: ReturnType<typeof userEvent.setup>,
  selectName: RegExp,
  optionName: string,
): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("ActionDetailPage", () => {
  describe("summary and delete flow", () => {
    defineWebsiteItemDetailPageCases({
      kindCase: ACTION_TEST_CASE,
      renderPage: renderActionDetailPage,
      buildPageLoadRoutes: (itemApiUrl) => ({
        [`GET ${itemApiUrl}/scripts`]: { status: 200, body: [] },
        [`GET ${SCRIPT_MODELS_API_URL}`]: { status: 200, body: buildScriptModelCatalog() },
      }),
    });
  });

  describe("scripts", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("offers Convert to script, says there are no scripts, and requests no runs", async () => {
      const fetchStub = stubLoadedAction([]);

      renderActionDetailPage();

      expect(await screen.findByText("No scripts yet.")).toBeInTheDocument();
      await waitForConvertButton();
      expect(screen.queryByRole("heading", { name: /Runs of version/ })).not.toBeInTheDocument();
      const requestedUrls = fetchStub.mock.calls.map(([requestedUrl]) => String(requestedUrl));
      expect(requestedUrls.some((requestedUrl) => requestedUrl.endsWith("/runs"))).toBe(false);
    });

    it("selects the newest version by default, numbers versions by age, and loads that version's runs", async () => {
      const fetchStub = stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: {
          status: 200,
          body: [buildActionScriptRunRecord({ actionScriptId: "script-2" })],
        },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
      const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
      // Each row starts with its run status icon's title, from the version's own `latestRun` (null here).
      expect(versionButtons.map((versionButton) => versionButton.textContent)).toEqual([
        expect.stringMatching(/^Not run yetVersion 2.* · high effort$/),
        expect.stringMatching(/^Not run yetVersion 1/),
      ]);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByText("The newer summary.")).toBeInTheDocument();
      expect(readListedSteps()).toEqual(['Click button "Log in"']);
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Passed · 4.3 s");
      expect(countRequests(fetchStub, "GET", runsApiUrl("script-1"))).toBe(0);
    });

    it("says an action without a credential runs logged out", async () => {
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage();

      expect(await screen.findByText("Runs as: logged out (no credential)")).toBeInTheDocument();
      expect(await screen.findByText(/^Running opens a browser window on this computer, runs logged out,/)).toBeInTheDocument();
      expect(screen.getByText(/^Generated .+ · Runs logged out$/)).toBeInTheDocument();
      expect(screen.queryByText("Out of date")).not.toBeInTheDocument();
    });

    it("says an action with a credential logs in as it first, and marks plans generated logged out as out of date", async () => {
      stubLoadedAction([olderScript], {
        [`GET ${ACTION_API_URL}`]: {
          status: 200,
          body: buildWebsiteItemRecord({
            credentialId: "credential-1",
            credential: { id: "credential-1", name: "Admin" },
          }),
        },
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage();

      expect(await screen.findByText('Runs as: "Admin" (logs in first)')).toBeInTheDocument();
      expect(
        await screen.findByText(/^Running opens a browser window on this computer, logs in as "Admin",/),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Not run yet Version 1/ })).toHaveTextContent("Out of date");
      expect(
        screen.getByText(/This version was generated from a different credential than the action has now/),
      ).toBeInTheDocument();
    });

    it("switches to an older version, and its runs, when it is picked", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-1")}`]: {
          status: 200,
          body: [buildActionScriptRunRecord({ succeeded: false, failedStepNumber: 1 })],
        },
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 2" });

      await user.click(screen.getByRole("button", { name: /^Not run yet Version 1/ }));

      expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(screen.getByText("Opens the site and signs in.")).toBeInTheDocument();
      expect(readListedSteps()).toEqual(['Click link "Sign in"', 'Check that heading "Welcome" is visible']);
      expect(screen.getByRole("heading", { name: "Runs of version 1" })).toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 1");
    });

    it("converts the action: progress while in flight, then the new version is selected without refetching the list", async () => {
      const user = userEvent.setup();
      const pendingConversion = createDeferred<Response>();
      const createdScript = buildActionScriptRecord({ id: "script-3", summary: "Just converted." });
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-3")}`]: { status: 200, body: [] },
        [`POST ${SCRIPTS_API_URL}`]: () => pendingConversion.promise,
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 1" });

      await user.click(await waitForConvertButton());

      expect(screen.getByRole("button", { name: "Converting…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Converting to script" })).toBeInTheDocument();
      await act(async () => {
        pendingConversion.resolve(buildJsonResponse(201, createdScript));
        await pendingConversion.promise;
      });

      expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
      expect(screen.getByText("Just converted.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Convert to script" })).toBeEnabled();
      expect(fetchStub).toHaveBeenCalledWith(
        SCRIPTS_API_URL,
        buildConvertRequestInit("claude-opus-5-5", "high"),
      );
      expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", runsApiUrl("script-3"))).toBe(1);
      });
    });

    it("shows the server's reason when the conversion fails, and keeps the page as it was", async () => {
      const user = userEvent.setup();
      stubLoadedAction([], {
        [`POST ${SCRIPTS_API_URL}`]: {
          status: 503,
          body: { error: "ANTHROPIC_API_KEY is not set in .env.local" },
        },
      });
      renderActionDetailPage();
      await screen.findByText("No scripts yet.");

      await user.click(await waitForConvertButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not convert: ANTHROPIC_API_KEY is not set in .env.local",
      );
      expect(screen.getByText("No scripts yet.")).toBeInTheDocument();
    });

    it("shows why the script list could not be loaded", async () => {
      stubLoadedAction([], {
        [`GET ${SCRIPTS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
      expect(screen.queryByText("No scripts yet.")).not.toBeInTheDocument();
    });

    it("runs the selected version: progress while in flight, then the recorded run is shown and selected", async () => {
      const user = userEvent.setup();
      const pendingRun = createDeferred<Response>();
      const failedRun = buildActionScriptRunRecord({
        id: "script-run-9",
        succeeded: false,
        failedStepNumber: 1,
        errorMessage: 'Step 1 (Click link "Sign in"): Timeout 10000ms exceeded.',
        output: "✘ Stopped: Timeout 10000ms exceeded.\n",
        failureScreenshotFileName: "website-1/run-folder/failure.png",
      });
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`POST ${runsApiUrl("script-1")}`]: () => pendingRun.promise,
      });
      renderActionDetailPage();
      expect(await screen.findByText("This version has not been run yet.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Run script" }));

      expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Running script" })).toBeInTheDocument();
      await act(async () => {
        pendingRun.resolve(buildJsonResponse(201, failedRun));
        await pendingRun.promise;
      });

      const outcome = await screen.findByRole("status");
      expect(outcome).toHaveTextContent("Failed at step 1 · 4.3 s");
      expect(outcome).toHaveTextContent('Step 1 (Click link "Sign in"): Timeout 10000ms exceeded.');
      expect(screen.getByLabelText("Run output")).toHaveTextContent("✘ Stopped: Timeout 10000ms exceeded.");
      expect(screen.getByRole("img", { name: /Failure screenshot/ })).toHaveAttribute(
        "src",
        `${runsApiUrl("script-1")}/script-run-9/failure-screenshot`,
      );
      const historyButtons = within(screen.getByRole("list", { name: "Run history" })).getAllByRole("button");
      expect(historyButtons).toHaveLength(1);
      expect(historyButtons[0]).toHaveAttribute("aria-current", "true");
      expect(fetchStub).toHaveBeenCalledWith(runsApiUrl("script-1"), { method: "POST" });
      expect(countRequests(fetchStub, "GET", runsApiUrl("script-1"))).toBe(1);
    });

    it("turns the run version's status icon green or red as soon as its run is recorded, without refetching the versions", async () => {
      const user = userEvent.setup();
      const serverLatestRun = { id: "script-run-1", succeeded: true, createdAt: "2026-04-03T00:00:00.000Z" };
      const fetchStub = stubLoadedAction(
        [{ ...newerScript, latestRun: null }, { ...olderScript, latestRun: serverLatestRun }],
        {
          [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
          [`POST ${runsApiUrl("script-2")}`]: {
            status: 201,
            body: buildActionScriptRunRecord({
              id: "script-run-9",
              actionScriptId: "script-2",
              succeeded: false,
              failedStepNumber: 1,
              errorMessage: 'Step 1 (Click button "Log in"): Timeout 10000ms exceeded.',
            }),
          },
        },
      );
      renderActionDetailPage();
      await screen.findByText("This version has not been run yet.");
      const versionList = screen.getByRole("list", { name: "Versions" });
      const [newerVersionButton, olderVersionButton] = within(versionList).getAllByRole("button");
      expect(within(newerVersionButton).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
      expect(within(olderVersionButton).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Run script" }));

      expect(await within(newerVersionButton).findByRole("img", { name: "Latest run failed" })).toBeInTheDocument();
      expect(within(newerVersionButton).queryByRole("img", { name: "Not run yet" })).not.toBeInTheDocument();
      expect(within(olderVersionButton).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();
      expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
    });

    it("shows the server's reason when a run cannot be started", async () => {
      const user = userEvent.setup();
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`POST ${runsApiUrl("script-1")}`]: { status: 500, body: { error: "spawn ENOENT" } },
      });
      renderActionDetailPage();
      await screen.findByText("This version has not been run yet.");

      await user.click(screen.getByRole("button", { name: "Run script" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not run the script: spawn ENOENT");
    });

    it("shows an earlier run when it is picked from the history", async () => {
      const user = userEvent.setup();
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: {
          status: 200,
          body: [
            buildActionScriptRunRecord({ id: "run-b", succeeded: false, failedStepNumber: 2 }),
            buildActionScriptRunRecord({ id: "run-a" }),
          ],
        },
      });
      renderActionDetailPage();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 2");

      const historyButtons = within(screen.getByRole("list", { name: "Run history" })).getAllByRole("button");
      await user.click(historyButtons[1]);

      expect(screen.getByRole("status")).toHaveTextContent("Passed");
      expect(historyButtons[1]).toHaveAttribute("aria-current", "true");
    });
  });

  describe("editing a plan", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("saves an edited plan as a new version: progress while in flight, then the new version is selected without refetching the list", async () => {
      const user = userEvent.setup();
      const pendingEdit = createDeferred<Response>();
      const editedPlan: ActionPlan = { ...olderScript.plan, name: "Log in again" };
      const editedScript = buildActionScriptRecord({
        id: "script-3",
        summary: "Saved from the step editor.",
        plan: editedPlan,
        modelId: null,
        effort: null,
        editedFromActionScriptId: "script-1",
        createdAt: "2026-04-06T00:00:00.000Z",
      });
      const fetchStub = stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-3")}`]: { status: 200, body: [] },
        [`POST ${editsApiUrl("script-1")}`]: () => pendingEdit.promise,
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 2" });
      await user.click(screen.getByRole("button", { name: /^Not run yet Version 1/ }));
      await screen.findByRole("heading", { name: "Version 1" });

      await renamePlanInEditor(user, "Log in again");
      await user.click(screen.getByRole("button", { name: "Save as new version" }));

      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: "Plan name" })).toBeDisabled();
      await act(async () => {
        pendingEdit.resolve(buildJsonResponse(201, editedScript));
        await pendingEdit.promise;
      });

      expect(await screen.findByRole("heading", { name: "Version 3" })).toBeInTheDocument();
      expect(screen.getByText("Saved from the step editor.")).toBeInTheDocument();
      expect(screen.getByText(/^Edited .+ from Version 1 · Runs logged out$/)).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Plan name" })).not.toBeInTheDocument();
      const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
      expect(versionButtons).toHaveLength(3);
      expect(versionButtons[0]).toHaveTextContent(/^Not run yetVersion 3.+ · Edited from Version 1$/);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("heading", { name: "Runs of version 3" })).toBeInTheDocument();
      expect(fetchStub).toHaveBeenCalledWith(editsApiUrl("script-1"), buildEditRequestInit(editedPlan));
      expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", runsApiUrl("script-3"))).toBe(1);
      });
    });

    it("keeps the editor open with the server's reason when the edit cannot be saved", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`POST ${editsApiUrl("script-1")}`]: {
          status: 400,
          body: { error: "Step 1 (Click): needs an element to act on" },
        },
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 1" });

      await renamePlanInEditor(user, "Log in again");
      await user.click(screen.getByRole("button", { name: "Save as new version" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not save: Step 1 (Click): needs an element to act on",
      );
      expect(screen.getByRole("textbox", { name: "Plan name" })).toHaveValue("Log in again");
      expect(screen.getByRole("button", { name: "Save as new version" })).toBeEnabled();
      expect(screen.getByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(countRequests(fetchStub, "POST", editsApiUrl("script-1"))).toBe(1);
    });
  });

  describe("refining a failed run", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    const failedRun = buildActionScriptRunRecord({
      id: "script-run-9",
      actionScriptId: "script-1",
      succeeded: false,
      failedStepNumber: 3,
      errorMessage: 'Step 3 (Click link "Account"): Timeout 10000ms exceeded.',
      failureScreenshotFileName: "website-1/run-folder/failure.png",
      failingPageUrl: "http://localhost:3099/account",
      failingPageAriaSnapshot: '- link "Profile"',
    });

    it("refines a failed run into a new version: progress while in flight, then the new version is selected without refetching the list", async () => {
      const user = userEvent.setup();
      const pendingRefine = createDeferred<Response>();
      const refinedScript = buildActionScriptRecord({
        id: "script-2",
        summary: "Refined by Claude.",
        refinement: buildActionScriptRefinementRecord({
          sourceActionScriptId: "script-1",
          actionScriptRunId: "script-run-9",
          refinedActionScriptId: "script-2",
        }),
        createdAt: "2026-04-06T00:00:00.000Z",
      });
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [failedRun] },
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`POST ${refinementsApiUrl("script-1", "script-run-9")}`]: () => pendingRefine.promise,
      });
      renderActionDetailPage();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 3");
      expect(screen.getByText("Failing page: http://localhost:3099/account")).toBeInTheDocument();

      await user.type(
        screen.getByRole("textbox", { name: "Note for Claude (optional)" }),
        "  The link is called Profile now  ",
      );
      await user.click(screen.getByRole("button", { name: "Refine" }));

      expect(screen.getByRole("button", { name: "Refining…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Refining script" })).toBeInTheDocument();
      expect(screen.getByText("This can take a few minutes.")).toBeInTheDocument();
      await act(async () => {
        pendingRefine.resolve(buildJsonResponse(201, refinedScript));
        await pendingRefine.promise;
      });

      expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
      expect(screen.getByText("Refined by Claude.")).toBeInTheDocument();
      expect(
        screen.getByText(/^Refined .+ from Version 1 · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort · Runs logged out$/),
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Refined from" })).toBeInTheDocument();
      const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
      expect(versionButtons).toHaveLength(2);
      expect(versionButtons[0]).toHaveTextContent(/^Not run yetVersion 2.+ · Refined from Version 1 · Claude Opus 5\.5/);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      expect(fetchStub).toHaveBeenCalledWith(
        refinementsApiUrl("script-1", "script-run-9"),
        buildRefineRequestInit("The link is called Profile now"),
      );
      expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", runsApiUrl("script-2"))).toBe(1);
      });
      expect(await screen.findByText("This version has not been run yet.")).toBeInTheDocument();
    });

    it("sends no note when none was typed, and shows the server's reason when the refine fails", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [failedRun] },
        [`POST ${refinementsApiUrl("script-1", "script-run-9")}`]: {
          status: 502,
          body: { error: "Claude did not return a usable plan" },
        },
      });
      renderActionDetailPage();
      await screen.findByRole("status");

      await user.click(await screen.findByRole("button", { name: "Refine" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not refine: Claude did not return a usable plan",
      );
      expect(screen.getByRole("button", { name: "Refine" })).toBeEnabled();
      expect(screen.getByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(fetchStub).toHaveBeenCalledWith(
        refinementsApiUrl("script-1", "script-run-9"),
        buildRefineRequestInit(null),
      );
      expect(countRequests(fetchStub, "POST", refinementsApiUrl("script-1", "script-run-9"))).toBe(1);
    });

    it("offers no Refine on a failed run of a version saved from the step editor", async () => {
      const editedScript = buildActionScriptRecord({
        id: "script-2",
        modelId: null,
        effort: null,
        editedFromActionScriptId: "script-1",
      });
      stubLoadedAction([editedScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: {
          status: 200,
          body: [{ ...failedRun, actionScriptId: "script-2" }],
        },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 3");
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Refine" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Note for Claude (optional)" })).not.toBeInTheDocument();
    });
  });

  describe("model choice", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("starts on the catalog's default model and effort, naming the model id and its fallback", async () => {
      stubLoadedAction([]);

      renderActionDetailPage();

      await waitForConvertButton();
      expect(screen.getByRole("combobox", { name: MODEL_SELECT_NAME })).toHaveTextContent(
        "Claude Opus 5.5",
      );
      expect(screen.getByRole("combobox", { name: EFFORT_SELECT_NAME })).toHaveTextContent("high");
      expect(
        screen.getByText("claude-opus-5-5 · If it declines, Claude Opus 4.8 answers instead"),
      ).toBeInTheDocument();
    });

    it("sends the picked model and effort level with the conversion", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedAction([], {
        [`POST ${SCRIPTS_API_URL}`]: { status: 503, body: { error: "stop here" } },
      });
      renderActionDetailPage();
      await waitForConvertButton();

      await pickFromSelect(user, MODEL_SELECT_NAME, "Claude Opus 4.6");
      await pickFromSelect(user, EFFORT_SELECT_NAME, "max");
      await user.click(screen.getByRole("button", { name: "Convert to script" }));

      await screen.findByText(/Could not convert: stop here/);
      expect(fetchStub).toHaveBeenCalledWith(
        SCRIPTS_API_URL,
        buildConvertRequestInit("claude-opus-4-6", "max"),
      );
    });

    it("keeps the effort level when the new model offers it, and falls back to high when it does not", async () => {
      const user = userEvent.setup();
      stubLoadedAction([]);
      renderActionDetailPage();
      await waitForConvertButton();

      await pickFromSelect(user, MODEL_SELECT_NAME, "Claude Opus 4.6");
      expect(screen.getByRole("combobox", { name: EFFORT_SELECT_NAME })).toHaveTextContent("high");
      expect(screen.getByText("claude-opus-4-6 · No fallback for this model")).toBeInTheDocument();

      await pickFromSelect(user, MODEL_SELECT_NAME, "Claude Opus 5.5");
      await pickFromSelect(user, EFFORT_SELECT_NAME, "xhigh");
      await pickFromSelect(user, MODEL_SELECT_NAME, "Claude Opus 4.6");

      expect(screen.getByRole("combobox", { name: EFFORT_SELECT_NAME })).toHaveTextContent("high");
    });

    it("shows Standard and sends no effort level for a model with no effort setting", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedAction([], {
        [`POST ${SCRIPTS_API_URL}`]: { status: 503, body: { error: "stop here" } },
      });
      renderActionDetailPage();
      await waitForConvertButton();

      await pickFromSelect(user, MODEL_SELECT_NAME, "Claude Haiku 4.5");

      const effortSelect = screen.getByRole("combobox", { name: EFFORT_SELECT_NAME });
      expect(effortSelect).toHaveTextContent("Standard");
      expect(effortSelect).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText("This model has no effort setting")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Convert to script" }));
      await screen.findByText(/Could not convert: stop here/);
      expect(fetchStub).toHaveBeenCalledWith(
        SCRIPTS_API_URL,
        buildConvertRequestInit("claude-haiku-4-5-20251001", null),
      );
    });

    it("keeps Convert disabled while the model list loads", () => {
      const pendingCatalog = createDeferred<Response>();
      stubLoadedAction([], { [`GET ${SCRIPT_MODELS_API_URL}`]: () => pendingCatalog.promise });

      renderActionDetailPage();

      return screen.findByText("Loading models…").then(() => {
        expect(screen.getByRole("button", { name: "Convert to script" })).toBeDisabled();
      });
    });

    it("says why the model list could not load, and keeps Convert disabled", async () => {
      stubLoadedAction([], {
        [`GET ${SCRIPT_MODELS_API_URL}`]: {
          status: 503,
          body: { error: "ANTHROPIC_API_KEY is not set in .env.local" },
        },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not load models: ANTHROPIC_API_KEY is not set in .env.local",
      );
      expect(screen.getByRole("button", { name: "Convert to script" })).toBeDisabled();
    });

    it("labels each version with the model and effort that wrote it", async () => {
      stubLoadedAction(
        [
          buildActionScriptRecord({ id: "script-2", modelId: "claude-haiku-4-5-20251001", effort: null }),
          buildActionScriptRecord({ id: "script-1", modelId: "claude-opus-5-5", effort: "low" }),
        ],
        { [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] } },
      );

      renderActionDetailPage();

      await screen.findByRole("heading", { name: "Version 2" });
      await waitFor(() => {
        expect(
          screen.getByText(/^Generated .+ · Claude Haiku 4\.5 \(claude-haiku-4-5-20251001\) · Standard effort · Runs logged out$/),
        ).toBeInTheDocument();
      });
      const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
      expect(versionButtons[1]).toHaveTextContent("Claude Opus 5.5 (claude-opus-5-5) · low effort");
    });
  });

  describe("out-of-date versions and comparing", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("marks versions generated from a different title or description, and explains it on the selected one", async () => {
      stubLoadedAction(
        [
          buildActionScriptRecord({ id: "script-3" }),
          buildActionScriptRecord({ id: "script-2", actionTitle: "Sign in" }),
          buildActionScriptRecord({ id: "script-1", actionTitle: "Sign in", actionDescription: "Old text" }),
        ],
        {
          [`GET ${runsApiUrl("script-3")}`]: { status: 200, body: [] },
          [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        },
      );
      const user = userEvent.setup();
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 3" });

      const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
      expect(versionButtons.map((versionButton) => versionButton.textContent.includes("Out of date"))).toEqual(
        [false, true, true],
      );
      expect(screen.queryByText(/This version was generated from a different/)).not.toBeInTheDocument();

      await user.click(versionButtons[2]);

      expect(
        await screen.findByText(/This version was generated from a different title and description/),
      ).toBeInTheDocument();
      expect(screen.getByText("Old text")).toBeInTheDocument();
    });

    it("links to the comparison page once there are two versions, carrying this page as the return state", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
      });
      renderActionDetailPage();

      await user.click(await screen.findByRole("link", { name: "Compare versions" }));

      const landing = await readProbeAfterLanding(`${ACTION_PATH}/scripts/compare`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: ACTION_PATH }));
    });

    it("offers no comparison with a single version", async () => {
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage();

      await screen.findByRole("heading", { name: "Version 1" });
      expect(screen.queryByRole("link", { name: "Compare versions" })).not.toBeInTheDocument();
    });
  });
});
