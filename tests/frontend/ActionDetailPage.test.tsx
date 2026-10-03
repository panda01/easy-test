import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import ActionDetailPage from "../../src/pages/ActionDetailPage";
import {
  ITEM_KIND_TEST_CASES,
  buildActionScriptRecord,
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
 * Builds the runs url of one script of the action under test.
 * @param actionScriptId - The script's id
 * @returns The script's runs API url
 */
function runsApiUrl(actionScriptId: string): string {
  return `${SCRIPTS_API_URL}/${actionScriptId}/runs`;
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
  code: "// version one code",
  createdAt: "2026-04-01T00:00:00.000Z",
});
const newerScript = buildActionScriptRecord({
  id: "script-2",
  code: "// version two code",
  summary: "The newer summary.",
  assumptions: [],
  ruleViolations: [
    "Line 3: .fill( - sets a whole value at once; type with pressSequentially",
    "Line 9: evaluate - runs code inside the page",
  ],
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
      expect(versionButtons.map((versionButton) => versionButton.textContent)).toEqual([
        expect.stringMatching(/^Version 2.* · 2 rule warnings$/),
        expect.stringMatching(/^Version 1/),
      ]);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByLabelText("Script code")).toHaveTextContent("// version two code");
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Passed · 4.3 s");
      expect(countRequests(fetchStub, "GET", runsApiUrl("script-1"))).toBe(0);
    });

    it("warns about rule violations on the selected version", async () => {
      stubLoadedAction([newerScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage();

      const warningsList = await screen.findByRole("list", { name: "Rule warnings" });
      expect(within(warningsList).getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByText("2 rule warnings")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Run script" })).toBeEnabled();
    });

    it("switches to an older version, and its runs, when it is picked", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-1")}`]: {
          status: 200,
          body: [buildActionScriptRunRecord({ succeeded: false, exitCode: 1 })],
        },
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 2" });

      await user.click(screen.getByRole("button", { name: /^Version 1/ }));

      expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(screen.getByLabelText("Script code")).toHaveTextContent("// version one code");
      expect(screen.getByRole("heading", { name: "Runs of version 1" })).toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed · exit code 1");
    });

    it("converts the action: progress while in flight, then the new version is selected without refetching the list", async () => {
      const user = userEvent.setup();
      const pendingConversion = createDeferred<Response>();
      const createdScript = buildActionScriptRecord({ id: "script-3", code: "// version two, just made" });
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
      expect(screen.getByLabelText("Script code")).toHaveTextContent("// version two, just made");
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
        exitCode: 1,
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

      expect(await screen.findByRole("status")).toHaveTextContent("Failed · exit code 1 · 4.3 s");
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
            buildActionScriptRunRecord({ id: "run-b", succeeded: false, exitCode: 1 }),
            buildActionScriptRunRecord({ id: "run-a" }),
          ],
        },
      });
      renderActionDetailPage();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed · exit code 1");

      const historyButtons = within(screen.getByRole("list", { name: "Run history" })).getAllByRole("button");
      await user.click(historyButtons[1]);

      expect(screen.getByRole("status")).toHaveTextContent("Passed");
      expect(historyButtons[1]).toHaveAttribute("aria-current", "true");
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
          screen.getByText(/Claude Haiku 4\.5 \(claude-haiku-4-5-20251001\) · Standard effort · START_URL/),
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
