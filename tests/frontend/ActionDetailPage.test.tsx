import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { type ReactElement } from "react";
import { Route, useLocation, useNavigationType } from "react-router-dom";
import ActionDetailPage from "../../src/pages/ActionDetailPage";
import { type ActionPlan } from "../../src/utils/actionPlanSteps";
import {
  buildActionScriptRecord,
  buildActionScriptRefinementRecord,
  buildActionScriptRunRecord,
  buildJsonResponse,
  buildScriptModelCatalog,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  stubWindowWidth,
  type FetchStub,
  type RouterStart,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

/** The dashboard: the website list on the home page. */
const LIST_PATH = "/";
const WEBSITE_PATH = "/websites/website-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const ACTION_PATH = `${WEBSITE_PATH}/actions/item-1`;
const ACTION_API_URL = `${WEBSITE_API_URL}/actions/item-1`;
const SCRIPTS_API_URL = `${ACTION_API_URL}/scripts`;
const SCRIPT_MODELS_API_URL = "/api/script-models";

/** Matches the Model dropdown, whose accessible name may also carry the chosen model. */
const MODEL_SELECT_NAME = /^Model/;

/** Matches the Effort dropdown, whose accessible name may also carry the chosen level. */
const EFFORT_SELECT_NAME = /^Effort/;

/** Matches the phone layout's Version dropdown, whose accessible name also carries the shown version. */
const VERSION_SELECT_NAME = /^Version/;

/** History as it is after clicking the action on the website's page. */
const OPENED_FROM_WEBSITE: RouterStart = {
  initialEntries: [LIST_PATH, WEBSITE_PATH, { pathname: ACTION_PATH, state: { returnTo: WEBSITE_PATH } }],
};

/** History after opening the page directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [ACTION_PATH] };

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
 * Shows the current query string and how the router got there, beside the
 * page under test, so a spec can check `?version=` and that it was REPLACEd.
 * @returns The readouts
 */
function SearchReadout(): ReactElement {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <div>
      <p data-testid="readout-search">{location.search}</p>
      <p data-testid="readout-navigation-type">{navigationType}</p>
    </div>
  );
}

/**
 * Renders the action page on its real route, keyed exactly as App.tsx
 * declares it, with the query string readout beside it.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderActionDetailPage(routerStart: RouterStart = OPENED_BY_DEEP_LINK): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/actions/:itemId"
      element={
        <>
          <ActionDetailPage key="action-detail" />
          <SearchReadout />
        </>
      }
    />,
    routerStart,
  );
}

/**
 * Waits until the query string reads `expectedSearch`, and checks the router
 * got there by replacing the entry rather than pushing one.
 * @param expectedSearch - e.g. "?version=2"
 */
async function expectSearchReplacedWith(expectedSearch: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("readout-search").textContent).toBe(expectedSearch);
  });
  expect(screen.getByTestId("readout-navigation-type").textContent).toBe("REPLACE");
}

const olderScript = buildActionScriptRecord({
  id: "script-1",
  createdAt: "2026-04-01T00:00:00.000Z",
});
const newerScript = buildActionScriptRecord({
  id: "script-2",
  summary: "The newer summary.",
  assumptions: [],
  contextPageUrls: [],
  plan: {
    name: "Log in",
    startUrl: "https://example.com/",
    steps: [{ action: "click", target: { role: "button", name: "Log in" }, value: null }],
  },
  createdAt: "2026-04-05T00:00:00.000Z",
});

/**
 * Stubs the website, the action, and the action's script list and the model
 * catalog, plus any extra or replacement routes (runs, POSTs).
 * @param scripts - What the script list answers with
 * @param extraRoutes - More replies
 * @returns The installed fetch stub
 */
function stubLoadedAction(scripts: unknown[], extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${ACTION_API_URL}`]: { status: 200, body: buildWebsiteItemRecord() },
    [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: scripts },
    [`GET ${SCRIPT_MODELS_API_URL}`]: { status: 200, body: buildScriptModelCatalog() },
    ...extraRoutes,
  });
}

/**
 * Waits until the model list has loaded and "Convert to new version" can be
 * clicked.
 * @returns The enabled Convert button
 */
async function waitForConvertButton(): Promise<HTMLElement> {
  const convertButton = await screen.findByRole("button", { name: "Convert to new version" });
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
 * Reads the step list's items.
 * @returns The shown version's step list items, in order
 */
function getStepItems(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem");
}

/**
 * Reads the step sentences of the shown version's read-only step list,
 * without each row's step number.
 * @returns Each listed step's text, in order
 */
function readListedSteps(): string[] {
  return getStepItems().map((stepItem) => stepItem.textContent.replace(/^\d+/, ""));
}

/**
 * Reads the rows of the desktop versions list.
 * @returns Every version row's button
 */
function getVersionButtons(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
}

/**
 * Finds the one element of a tag whose whole text matches, for text that is
 * split across nested elements (e.g. "Runs as <span>Admin</span>.").
 * @param tagName - The element's tag, e.g. "P"
 * @param expectedText - The whole text, or a pattern it must match
 * @returns The element
 */
function getElementByWholeText(tagName: string, expectedText: string | RegExp): HTMLElement {
  return screen.getByText((_content, element) => {
    const elementIsTheTag = element?.tagName === tagName;
    if (!elementIsTheTag) return false;
    const wholeText = element.textContent;
    return typeof expectedText === "string" ? wholeText === expectedText : expectedText.test(wholeText);
  });
}

/**
 * Opens the shown version's step editor and renames the plan, which is
 * enough of a change to enable "Save as new version".
 * @param user - The user-event session
 * @param planName - The new plan name
 */
async function renamePlanInEditor(user: UserEvent, planName: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Edit steps" }));
  const planNameField = screen.getByRole("textbox", { name: "Plan name" });
  await user.clear(planNameField);
  await user.type(planNameField, planName);
}

/**
 * Picks an option from one of the MUI select dropdowns.
 * @param user - The user-event session
 * @param selectName - The dropdown's accessible name pattern
 * @param optionName - The option's text, or a pattern for it
 */
async function pickFromSelect(user: UserEvent, selectName: RegExp, optionName: string | RegExp): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/** A failed run of script-1, at step 2, with a failure screenshot and a failing page. */
const failedRunOfOlderScript = buildActionScriptRunRecord({
  id: "script-run-9",
  actionScriptId: "script-1",
  succeeded: false,
  failedStepNumber: 2,
  errorMessage: 'Step 2 (Check that heading "Welcome" is visible): Timeout 10000ms exceeded.\nCall log: …',
  failureScreenshotFileName: "website-1/run-folder/failure.png",
  failingPageUrl: "http://localhost:3099/account",
  failingPageAriaSnapshot: '- link "Profile"',
  createdAt: "2026-04-04T00:00:00.000Z",
});

describe("ActionDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("header and delete flow", () => {
    /**
     * Waits for the action to load, then opens the delete dialog.
     * @param user - The user-event session to click with
     * @returns The open dialog element
     */
    const openDeleteDialog = async (user: UserEvent): Promise<HTMLElement> => {
      await screen.findByRole("heading", { level: 1, name: "Log in" });
      await user.click(screen.getByRole("button", { name: "Delete" }));
      return screen.findByRole("dialog", { name: "Delete action?" });
    };

    it("shows a spinner and placeholder breadcrumbs while the action loads", () => {
      const pendingWebsite = createDeferred<Response>();
      const pendingAction = createDeferred<Response>();
      stubLoadedAction([], {
        [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise,
        [`GET ${ACTION_API_URL}`]: () => pendingAction.promise,
      });

      renderActionDetailPage(OPENED_FROM_WEBSITE);

      expect(screen.getByRole("progressbar", { name: "Loading action" })).toBeInTheDocument();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Website", href: WEBSITE_PATH },
        { label: "Action", href: null },
      ]);
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("shows the server's not-found text and nothing else for an unknown action", async () => {
      stubLoadedAction([], { [`GET ${ACTION_API_URL}`]: { status: 404, body: { error: "Action not found" } } });

      renderActionDetailPage(OPENED_FROM_WEBSITE);

      expect(await screen.findByRole("alert")).toHaveTextContent("Action not found");
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Versions" })).not.toBeInTheDocument();
    });

    it("shows the title, the description with who it runs as, and named breadcrumbs - without the created / updated line", async () => {
      stubLoadedAction([]);

      renderActionDetailPage(OPENED_FROM_WEBSITE);

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(getElementByWholeText("P", "Sign in with a valid account Runs logged out.")).toBeInTheDocument();
      expect(screen.queryByText(/Created .+ · Updated .+/)).not.toBeInTheDocument();
      await waitFor(() => {
        expect(readBreadcrumbTrail()).toEqual([
          { label: "Websites", href: LIST_PATH },
          { label: "Example", href: WEBSITE_PATH },
          { label: "Log in", href: null },
        ]);
      });
    });

    it("says an action with a credential runs as it", async () => {
      stubLoadedAction([], {
        [`GET ${ACTION_API_URL}`]: {
          status: 200,
          body: buildWebsiteItemRecord({
            credentialId: "credential-1",
            credential: { id: "credential-1", name: "Admin" },
          }),
        },
      });

      renderActionDetailPage();

      await screen.findByRole("heading", { level: 1, name: "Log in" });
      expect(getElementByWholeText("P", "Sign in with a valid account Runs as Admin.")).toBeInTheDocument();
    });

    it("still shows the action when only the website (used for the breadcrumb) fails", async () => {
      stubLoadedAction([], {
        [`GET ${WEBSITE_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      });

      renderActionDetailPage(OPENED_FROM_WEBSITE);

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(readBreadcrumbTrail()[1]).toEqual({ label: "Website", href: WEBSITE_PATH });
    });

    it("opens the edit form with this page as its return state", async () => {
      const user = userEvent.setup();
      stubLoadedAction([]);
      renderActionDetailPage(OPENED_FROM_WEBSITE);

      await user.click(await screen.findByRole("link", { name: "Edit" }));

      const landing = await readProbeAfterLanding(`${ACTION_PATH}/edit`);
      expect(landing.navigationType).toBe("PUSH");
      expect(landing.state).toBe(JSON.stringify({ returnTo: ACTION_PATH }));
    });

    it("names the action in the delete dialog, and closes it on Cancel without sending a request", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedAction([]);
      renderActionDetailPage(OPENED_FROM_WEBSITE);

      const dialog = await openDeleteDialog(user);
      expect(dialog).toHaveTextContent('"Log in" will be deleted.');
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(countRequests(fetchStub, "DELETE", ACTION_API_URL)).toBe(0);
    });

    it("keeps the dialog open with the server's reason when the delete fails", async () => {
      const user = userEvent.setup();
      stubLoadedAction([], { [`DELETE ${ACTION_API_URL}`]: { status: 404, body: { error: "Action not found" } } });
      renderActionDetailPage(OPENED_FROM_WEBSITE);
      const dialog = await openDeleteDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Action not found");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("disables the dialog's buttons while the delete is in flight", async () => {
      const user = userEvent.setup();
      const pendingDelete = createDeferred<Response>();
      stubLoadedAction([], { [`DELETE ${ACTION_API_URL}`]: () => pendingDelete.promise });
      renderActionDetailPage(OPENED_FROM_WEBSITE);
      const dialog = await openDeleteDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));
      expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

      await act(async () => {
        pendingDelete.resolve(buildJsonResponse(204));
        await pendingDelete.promise;
      });
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("sends DELETE and goes back to the website when the website opened the page", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedAction([], { [`DELETE ${ACTION_API_URL}`]: { status: 204 } });
      renderActionDetailPage(OPENED_FROM_WEBSITE);
      const dialog = await openDeleteDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("POP");
      expect(fetchStub).toHaveBeenCalledWith(ACTION_API_URL, { method: "DELETE" });

      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(LIST_PATH);
    });

    it("replaces the deleted action's page with the website after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedAction([], { [`DELETE ${ACTION_API_URL}`]: { status: 204 } });
      renderActionDetailPage(OPENED_BY_DEEP_LINK);
      const dialog = await openDeleteDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("REPLACE");
    });
  });

  describe("versions and steps", () => {
    it("offers Convert to new version, says there are no versions, and requests no runs", async () => {
      const fetchStub = stubLoadedAction([]);

      renderActionDetailPage();

      expect(await screen.findByText("No versions yet.")).toBeInTheDocument();
      expect(screen.getByText("Convert this action to create its first version.")).toBeInTheDocument();
      await waitForConvertButton();
      expect(screen.queryByRole("heading", { name: "Latest run" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Run/ })).not.toBeInTheDocument();
      const requestedUrls = fetchStub.mock.calls.map(([requestedUrl]) => String(requestedUrl));
      expect(requestedUrls.some((requestedUrl) => requestedUrl.endsWith("/runs"))).toBe(false);
    });

    it("shows the newest version by default, numbers versions by age, and loads only that version's runs", async () => {
      const fetchStub = stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: {
          status: 200,
          body: [buildActionScriptRunRecord({ actionScriptId: "script-2" })],
        },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
      const versionButtons = getVersionButtons();
      expect(versionButtons[0]).toHaveAccessibleName(/^Not run yet Version 2 /);
      expect(versionButtons[1]).toHaveAccessibleName(/^Not run yet Version 1 /);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByText("The newer summary.")).toBeInTheDocument();
      expect(readListedSteps()).toEqual(['Click button "Log in"']);
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();
      const outcome = await screen.findByRole("status");
      expect(outcome).toHaveTextContent("Passed");
      expect(outcome).toHaveTextContent("4.3 s");
      expect(screen.getByRole("button", { name: "Run again" })).toBeEnabled();
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      expect(countRequests(fetchStub, "GET", runsApiUrl("script-1"))).toBe(0);
      expect(screen.getByTestId("readout-search").textContent).toBe("");
    });

    it("captions the shown version with the model, effort, and how long ago it was generated", async () => {
      stubLoadedAction([olderScript], { [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] } });

      renderActionDetailPage();

      await screen.findByRole("heading", { name: "Version 1" });
      await waitFor(() => {
        expect(getElementByWholeText("P", /^Claude Opus 5\.5 · high effort · .+$/)).toBeInTheDocument();
      });
      const caption = getElementByWholeText("P", /^Claude Opus 5\.5 · high effort · .+$/);
      expect(within(caption).getByTitle(new Date(olderScript.createdAt).toLocaleString())).toBeInTheDocument();
    });

    it("shows an older version, and its runs, when it is picked, putting it in ?version= by replacing the entry", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [failedRunOfOlderScript] },
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 2" });

      await user.click(getVersionButtons()[1]);

      expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      await expectSearchReplacedWith("?version=1");
      expect(screen.getByText("Opens the site and signs in.")).toBeInTheDocument();
      expect(readListedSteps()[0]).toBe('Click link "Sign in"');
      expect(getVersionButtons()[1]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("heading", { name: "Runs of version 1" })).toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 2");
    });

    it("opens on the version ?version= names (as after a reload), loading only its runs", async () => {
      const fetchStub = stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage({ initialEntries: [`${ACTION_PATH}?version=1`] });

      expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(getVersionButtons()[1]).toHaveAttribute("aria-current", "true");
      expect(await screen.findByText("This version has not been run yet.")).toBeInTheDocument();
      expect(countRequests(fetchStub, "GET", runsApiUrl("script-2"))).toBe(0);
    });

    it.each(["7", "0", "-1", "1.5", "two"])(
      "falls back on the newest version for ?version=%s",
      async (requestedVersion) => {
        stubLoadedAction([newerScript, olderScript], {
          [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        });

        renderActionDetailPage({ initialEntries: [`${ACTION_PATH}?version=${requestedVersion}`] });

        expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
        expect(getVersionButtons()[0]).toHaveAttribute("aria-current", "true");
      },
    );

    it("collapses the assumptions, the pages given to Claude, and the plan JSON into rows that open", async () => {
      const user = userEvent.setup();
      stubLoadedAction([olderScript], { [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] } });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 1" });

      expect(screen.queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Assumptions · 1" }));
      expect(within(screen.getByRole("list", { name: "Assumptions" })).getByText("The sign-in button is labelled Sign in")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Pages given to Claude · 1" }));
      expect(within(screen.getByRole("list", { name: "Pages given to Claude" })).getByText("https://example.com/")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Plan JSON" }));
      expect(screen.getByLabelText("Plan JSON")).toHaveTextContent('"name": "Log in"');
    });

    it("says when there are no assumptions and when Claude was shown no pages", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript], { [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] } });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 1" });

      await user.click(screen.getByRole("button", { name: "Assumptions · 0" }));
      await user.click(screen.getByRole("button", { name: "Pages given to Claude · 0" }));

      expect(screen.getByText("No assumptions recorded.")).toBeInTheDocument();
      expect(screen.getByText(/^None - the website had not been crawled/)).toBeInTheDocument();
    });

    it("converts the action: progress while in flight, then the new version is shown via ?version= without refetching the list", async () => {
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
      await expectSearchReplacedWith("?version=2");
      expect(screen.getByText("Just converted.")).toBeInTheDocument();
      expect(getVersionButtons()[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "Convert to new version" })).toBeEnabled();
      expect(fetchStub).toHaveBeenCalledWith(SCRIPTS_API_URL, buildConvertRequestInit("claude-opus-5-5", "high"));
      expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", runsApiUrl("script-3"))).toBe(1);
      });
    });

    it("numbers a converted version after every listed one, even while an older version is shown", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-3")}`]: { status: 200, body: [] },
        [`POST ${SCRIPTS_API_URL}`]: {
          status: 201,
          body: buildActionScriptRecord({ id: "script-3", summary: "Just converted." }),
        },
      });
      renderActionDetailPage({ initialEntries: [`${ACTION_PATH}?version=1`] });
      await screen.findByRole("heading", { name: "Version 1" });

      await user.click(await waitForConvertButton());

      expect(await screen.findByRole("heading", { name: "Version 3" })).toBeInTheDocument();
      await expectSearchReplacedWith("?version=3");
    });

    it("shows the server's reason when the conversion fails, and keeps the page as it was", async () => {
      const user = userEvent.setup();
      stubLoadedAction([], {
        [`POST ${SCRIPTS_API_URL}`]: { status: 503, body: { error: "ANTHROPIC_API_KEY is not set in .env.local" } },
      });
      renderActionDetailPage();
      await screen.findByText("No versions yet.");

      await user.click(await waitForConvertButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not convert: ANTHROPIC_API_KEY is not set in .env.local",
      );
      expect(screen.getByText("No versions yet.")).toBeInTheDocument();
    });

    it("shows why the script list could not be loaded", async () => {
      stubLoadedAction([], {
        [`GET ${SCRIPTS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
      expect(screen.queryByText("No versions yet.")).not.toBeInTheDocument();
    });
  });

  describe("runs", () => {
    it("runs the shown version: progress while in flight, then the recorded run is shown and its step marked", async () => {
      const user = userEvent.setup();
      const pendingRun = createDeferred<Response>();
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
        [`POST ${runsApiUrl("script-1")}`]: () => pendingRun.promise,
      });
      renderActionDetailPage();
      expect(await screen.findByText("This version has not been run yet.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Running script" })).toBeInTheDocument();
      await act(async () => {
        pendingRun.resolve(
          buildJsonResponse(201, { ...failedRunOfOlderScript, output: "✘ Stopped: Timeout 10000ms exceeded." }),
        );
        await pendingRun.promise;
      });

      const outcome = await screen.findByRole("status");
      expect(outcome).toHaveTextContent("Failed at step 2");
      expect(outcome).toHaveTextContent('Step 2 (Check that heading "Welcome" is visible): Timeout 10000ms exceeded.');
      expect(outcome).toHaveTextContent("4.3 s");
      expect(screen.getByRole("button", { name: "Run again" })).toBeEnabled();
      expect(screen.getByRole("img", { name: /Failure screenshot/ })).toHaveAttribute(
        "src",
        `${runsApiUrl("script-1")}/script-run-9/failure-screenshot`,
      );
      expect(screen.getByText("http://localhost:3099/account")).toBeInTheDocument();
      expect(getStepItems()[1]).toHaveTextContent(
        'Failed here — Step 2 (Check that heading "Welcome" is visible): Timeout 10000ms exceeded.',
      );
      const historyButtons = within(screen.getByRole("list", { name: "Runs of version 1" })).getAllByRole("button");
      expect(historyButtons).toHaveLength(1);
      expect(historyButtons[0]).toHaveAttribute("aria-current", "true");
      expect(fetchStub).toHaveBeenCalledWith(runsApiUrl("script-1"), { method: "POST" });
      expect(countRequests(fetchStub, "GET", runsApiUrl("script-1"))).toBe(1);

      await user.click(screen.getByRole("button", { name: /^Output log · / }));
      expect(screen.getByLabelText("Run output")).toHaveTextContent("✘ Stopped: Timeout 10000ms exceeded.");
    });

    it("turns the run version's status icon green or red as soon as its run is recorded, without refetching the versions", async () => {
      const user = userEvent.setup();
      const serverLatestRun = {
        id: "script-run-1",
        succeeded: true,
        failedStepNumber: null,
        timedOut: false,
        createdAt: "2026-04-03T00:00:00.000Z",
      };
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
      const [newerVersionButton, olderVersionButton] = getVersionButtons();
      expect(within(newerVersionButton).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
      expect(within(olderVersionButton).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(await within(newerVersionButton).findByRole("img", { name: "Latest run failed" })).toBeInTheDocument();
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

      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not run the script: spawn ENOENT");
    });

    it("shows an earlier run when it is picked from the version's runs, heading it Run and marking the steps by it", async () => {
      const user = userEvent.setup();
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: {
          status: 200,
          body: [failedRunOfOlderScript, buildActionScriptRunRecord({ id: "run-a" })],
        },
      });
      renderActionDetailPage();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 2");
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();
      expect(getStepItems()[1]).toHaveTextContent("Failed here —");

      const historyButtons = within(screen.getByRole("list", { name: "Runs of version 1" })).getAllByRole("button");
      await user.click(historyButtons[1]);

      expect(screen.getByRole("status")).toHaveTextContent("Passed");
      expect(screen.getByRole("heading", { name: "Run" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Latest run" })).not.toBeInTheDocument();
      expect(historyButtons[1]).toHaveAttribute("aria-current", "true");
      expect(screen.queryByText(/Failed here/)).not.toBeInTheDocument();

      await user.click(historyButtons[0]);
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();
    });
  });

  describe("editing a plan", () => {
    it("saves an edited plan as a new version: progress while in flight, then the new version is shown via ?version= without refetching the list", async () => {
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
      await user.click(getVersionButtons()[1]);
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
      await expectSearchReplacedWith("?version=3");
      expect(screen.getByText("Saved from the step editor.")).toBeInTheDocument();
      expect(getElementByWholeText("P", /^Edited from Version 1 · .+$/)).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Plan name" })).not.toBeInTheDocument();
      const versionButtons = getVersionButtons();
      expect(versionButtons).toHaveLength(3);
      expect(versionButtons[0]).toHaveTextContent(/Version 3 Edited from v1 · .+$/);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();
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

    it("closes the editor when another version is shown", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 2" });
      await user.click(screen.getByRole("button", { name: "Edit steps" }));
      expect(screen.getByRole("textbox", { name: "Plan name" })).toBeInTheDocument();

      await user.click(getVersionButtons()[1]);

      expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Plan name" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit steps" })).toBeInTheDocument();
    });
  });

  describe("refining a failed run", () => {
    it("refines a failed run into the next version: a note with a counter, progress while in flight, then the new version is shown via ?version=", async () => {
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
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [failedRunOfOlderScript] },
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`POST ${refinementsApiUrl("script-1", "script-run-9")}`]: () => pendingRefine.promise,
      });
      renderActionDetailPage();
      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 2");
      expect(screen.getByRole("heading", { name: "Refine with Claude" })).toBeInTheDocument();
      expect(screen.getByText("Optional · 0 / 2,000")).toBeInTheDocument();

      // Pasted, not typed: the note is a multiline field, and MUI's autosize
      // re-measures it with getComputedStyle after every keystroke (~8ms each
      // under jsdom). Typing it took about half this spec's time and pushed it
      // past the 5s timeout when the suite ran under load.
      await user.click(screen.getByRole("textbox", { name: "Note for Claude (optional)" }));
      await user.paste("  The link is called Profile now  ");
      expect(screen.getByText("Optional · 34 / 2,000")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Refine into Version 2" }));

      expect(screen.getByRole("button", { name: "Refining…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Refining script" })).toBeInTheDocument();
      expect(screen.getByText("This can take a few minutes.")).toBeInTheDocument();
      await act(async () => {
        pendingRefine.resolve(buildJsonResponse(201, refinedScript));
        await pendingRefine.promise;
      });

      expect(await screen.findByRole("heading", { name: "Version 2" })).toBeInTheDocument();
      await expectSearchReplacedWith("?version=2");
      expect(screen.getByText("Refined by Claude.")).toBeInTheDocument();
      await waitFor(() => {
        expect(
          getElementByWholeText("P", /^Refined from Version 1 · Claude Opus 5\.5 · high effort · .+$/),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("heading", { name: "Refined from" })).not.toBeInTheDocument();
      const versionButtons = getVersionButtons();
      expect(versionButtons).toHaveLength(2);
      expect(versionButtons[0]).toHaveTextContent(/Version 2 Refined from v1 · Opus 5\.5 · .+$/);
      expect(versionButtons[0]).toHaveAttribute("aria-current", "true");
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
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [failedRunOfOlderScript] },
        [`POST ${refinementsApiUrl("script-1", "script-run-9")}`]: {
          status: 502,
          body: { error: "Claude did not return a usable plan" },
        },
      });
      renderActionDetailPage();
      await screen.findByRole("status");

      await user.click(await screen.findByRole("button", { name: "Refine into Version 2" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not refine: Claude did not return a usable plan");
      expect(screen.getByRole("button", { name: "Refine into Version 2" })).toBeEnabled();
      expect(screen.getByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(fetchStub).toHaveBeenCalledWith(refinementsApiUrl("script-1", "script-run-9"), buildRefineRequestInit(null));
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
          body: [{ ...failedRunOfOlderScript, actionScriptId: "script-2" }],
        },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("status")).toHaveTextContent("Failed at step 2");
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Refine/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Refine with Claude" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Note for Claude (optional)" })).not.toBeInTheDocument();
    });
  });

  describe("model choice", () => {
    it("starts on the catalog's default model and effort, naming the model id and its fallback in the hover title", async () => {
      stubLoadedAction([]);

      renderActionDetailPage();

      await waitForConvertButton();
      expect(screen.getByRole("combobox", { name: MODEL_SELECT_NAME })).toHaveTextContent("Claude Opus 5.5");
      expect(screen.getByRole("combobox", { name: EFFORT_SELECT_NAME })).toHaveTextContent("high");
      expect(screen.getByTitle("claude-opus-5-5 · If it declines, Claude Opus 4.8 answers instead")).toBeInTheDocument();
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
      await user.click(screen.getByRole("button", { name: "Convert to new version" }));

      await screen.findByText(/Could not convert: stop here/);
      expect(fetchStub).toHaveBeenCalledWith(SCRIPTS_API_URL, buildConvertRequestInit("claude-opus-4-6", "max"));
    });

    it("keeps the effort level when the new model offers it, and falls back to high when it does not", async () => {
      const user = userEvent.setup();
      stubLoadedAction([]);
      renderActionDetailPage();
      await waitForConvertButton();

      await pickFromSelect(user, MODEL_SELECT_NAME, "Claude Opus 4.6");
      expect(screen.getByRole("combobox", { name: EFFORT_SELECT_NAME })).toHaveTextContent("high");
      expect(screen.getByTitle("claude-opus-4-6 · No fallback for this model")).toBeInTheDocument();

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
      await user.click(screen.getByRole("button", { name: "Convert to new version" }));
      await screen.findByText(/Could not convert: stop here/);
      expect(fetchStub).toHaveBeenCalledWith(SCRIPTS_API_URL, buildConvertRequestInit("claude-haiku-4-5-20251001", null));
    });

    it("keeps Convert disabled while the model list loads", async () => {
      const pendingCatalog = createDeferred<Response>();
      stubLoadedAction([], { [`GET ${SCRIPT_MODELS_API_URL}`]: () => pendingCatalog.promise });

      renderActionDetailPage();

      expect(await screen.findByText("Loading models…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Convert to new version" })).toBeDisabled();
    });

    it("says why the model list could not load, and keeps Convert disabled", async () => {
      stubLoadedAction([], {
        [`GET ${SCRIPT_MODELS_API_URL}`]: { status: 503, body: { error: "ANTHROPIC_API_KEY is not set in .env.local" } },
      });

      renderActionDetailPage();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not load models: ANTHROPIC_API_KEY is not set in .env.local",
      );
      expect(screen.getByRole("button", { name: "Convert to new version" })).toBeDisabled();
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
        expect(getElementByWholeText("P", /^Claude Haiku 4\.5 · Standard effort · .+$/)).toBeInTheDocument();
      });
      expect(getVersionButtons()[0]).toHaveTextContent(/Version 2 Haiku 4\.5 · .+$/);
      expect(getVersionButtons()[1]).toHaveTextContent(/Version 1 Opus 5\.5 · low · .+$/);
    });

    it("names an unlisted model by its id, and a version with no model as an unknown model", async () => {
      stubLoadedAction(
        [
          buildActionScriptRecord({ id: "script-2", modelId: null, effort: null }),
          buildActionScriptRecord({ id: "script-1", modelId: "claude-retired-1", effort: "low" }),
        ],
        { [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] } },
      );

      renderActionDetailPage();

      await screen.findByRole("heading", { name: "Version 2" });
      expect(getElementByWholeText("P", /^unknown model · .+$/)).toBeInTheDocument();
      await waitFor(() => {
        expect(getVersionButtons()[1]).toHaveTextContent(/Version 1 claude-retired-1 · low · .+$/);
      });
    });
  });

  describe("out-of-date versions and comparing", () => {
    it("tags versions generated from a different title or description, with no explanation block on the shown one", async () => {
      const user = userEvent.setup();
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
      renderActionDetailPage();
      await screen.findByRole("heading", { name: "Version 3" });

      const versionButtons = getVersionButtons();
      expect(versionButtons.map((versionButton) => versionButton.textContent.includes("Out of date"))).toEqual([
        false,
        true,
        true,
      ]);

      await user.click(versionButtons[2]);

      expect(await screen.findByRole("heading", { name: "Version 1" })).toBeInTheDocument();
      expect(screen.queryByText(/This version was generated from a different/)).not.toBeInTheDocument();
      expect(screen.queryByText("Old text")).not.toBeInTheDocument();
    });

    it("tags a version generated logged out once the action runs as a credential", async () => {
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

      await screen.findByRole("heading", { name: "Version 1" });
      expect(getVersionButtons()[0]).toHaveTextContent("Out of date");
    });

    it("links to the comparison page once there are two versions, carrying this page as the return state", async () => {
      const user = userEvent.setup();
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
      });
      renderActionDetailPage();

      await user.click(await screen.findByRole("link", { name: "Compare" }));

      const landing = await readProbeAfterLanding(`${ACTION_PATH}/scripts/compare`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: ACTION_PATH }));
    });

    it("offers no comparison with a single version", async () => {
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage();

      await screen.findByRole("heading", { name: "Version 1" });
      expect(screen.queryByRole("link", { name: "Compare" })).not.toBeInTheDocument();
    });
  });

  describe("phone layout (narrower than 1200 px)", () => {
    let removeWidthStub: (() => void) | null = null;

    afterEach(() => {
      removeWidthStub?.();
      removeWidthStub = null;
    });

    /** Two runs of script-1, the failed one newest. */
    const olderScriptRuns = [failedRunOfOlderScript, buildActionScriptRunRecord({ id: "run-a" })];

    it("puts Edit and Delete behind a ⋯ menu, keeps only who the action runs as, and backs up to the website", async () => {
      const user = userEvent.setup();
      removeWidthStub = stubWindowWidth(390);
      stubLoadedAction([], {
        [`GET ${ACTION_API_URL}`]: {
          status: 200,
          body: buildWebsiteItemRecord({
            credentialId: "credential-1",
            credential: { id: "credential-1", name: "Admin" },
          }),
        },
      });
      renderActionDetailPage(OPENED_FROM_WEBSITE);

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(getElementByWholeText("P", "Runs as Admin.")).toBeInTheDocument();
      expect(screen.queryByText(/Sign in with a valid account/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
      const breadcrumbNav = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(within(breadcrumbNav).getByRole("link")).toHaveTextContent("Example");
      expect(within(breadcrumbNav).getByRole("link")).toHaveAttribute("href", WEBSITE_PATH);

      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(await screen.findByRole("dialog", { name: "Delete action?" })).toHaveTextContent('"Log in" will be deleted.');
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));
      const landing = await readProbeAfterLanding(`${ACTION_PATH}/edit`);
      expect(landing.state).toBe(JSON.stringify({ returnTo: ACTION_PATH }));
    });

    it("offers a Version dropdown instead of the list, and showing another version puts it in ?version=", async () => {
      const user = userEvent.setup();
      removeWidthStub = stubWindowWidth(390);
      stubLoadedAction([newerScript, { ...olderScript, actionTitle: "Sign in" }], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] },
      });
      renderActionDetailPage();

      const versionSelect = await screen.findByRole("combobox", { name: VERSION_SELECT_NAME });
      expect(versionSelect).toHaveTextContent(/^Version 2 · Not run · .+$/);
      expect(screen.queryByRole("list", { name: "Versions" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
      expect(readListedSteps()).toEqual(['Click button "Log in"']);

      await user.click(versionSelect);
      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        expect.stringMatching(/^Version 2 · Not run · .+$/),
        expect.stringMatching(/^Version 1 · Not run · .+ · Out of date$/),
      ]);
      await user.click(options[1]);

      await expectSearchReplacedWith("?version=1");
      await waitFor(() => {
        expect(readListedSteps()[0]).toBe('Click link "Sign in"');
      });
      expect(screen.getByRole("combobox", { name: VERSION_SELECT_NAME })).toHaveTextContent(/^Version 1 · /);
    });

    it("shows the latest run in a card above the steps, with Run again and Refine side by side", async () => {
      const user = userEvent.setup();
      removeWidthStub = stubWindowWidth(390);
      const fetchStub = stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: olderScriptRuns },
        [`POST ${runsApiUrl("script-1")}`]: { status: 500, body: { error: "stop here" } },
        [`POST ${refinementsApiUrl("script-1", "script-run-9")}`]: { status: 502, body: { error: "stop here too" } },
      });
      renderActionDetailPage();

      const runCard = await screen.findByRole("region", { name: "Latest run" });
      expect(screen.queryByRole("heading", { name: "Latest run" })).not.toBeInTheDocument();
      const outcome = await within(runCard).findByRole("status");
      expect(outcome).toHaveTextContent("Failed at step 2");
      expect(outcome).toHaveTextContent(/· 4\.3 s$/);
      expect(screen.queryByRole("heading", { name: "Refine with Claude" })).not.toBeInTheDocument();
      expect(screen.queryByText(/^Optional ·/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed here/)).not.toBeInTheDocument();
      const runCardPosition = runCard.compareDocumentPosition(screen.getByRole("list", { name: "Plan steps" }));
      expect(runCardPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await user.click(within(runCard).getByRole("button", { name: "Refine" }));
      expect(await within(runCard).findByRole("alert")).toHaveTextContent("Could not refine: stop here too");
      expect(fetchStub).toHaveBeenCalledWith(refinementsApiUrl("script-1", "script-run-9"), buildRefineRequestInit(null));

      await user.click(within(runCard).getByRole("button", { name: "Run again" }));
      expect(await screen.findByText("Could not run the script: stop here")).toBeInTheDocument();
      expect(fetchStub).toHaveBeenCalledWith(runsApiUrl("script-1"), { method: "POST" });
    });

    it("lists the run history and the output log among the collapsed rows below the steps", async () => {
      const user = userEvent.setup();
      removeWidthStub = stubWindowWidth(390);
      stubLoadedAction([olderScript], {
        [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: olderScriptRuns },
      });
      renderActionDetailPage();
      await screen.findByRole("status");

      await user.click(screen.getByRole("button", { name: "Run history · 2" }));
      const historyButtons = within(screen.getByRole("list", { name: "Runs of version 1" })).getAllByRole("button");
      expect(historyButtons).toHaveLength(2);
      await user.click(historyButtons[1]);
      expect(screen.getByRole("status")).toHaveTextContent("Passed");

      await user.click(screen.getByRole("button", { name: /^Output log · / }));
      expect(screen.getByLabelText("Run output")).toHaveTextContent("Use case completed");
      expect(screen.getByRole("button", { name: "Assumptions · 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pages given to Claude · 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Plan JSON" })).toBeInTheDocument();
    });

    it("offers Run in the card, and no run rows, before the first run", async () => {
      removeWidthStub = stubWindowWidth(390);
      stubLoadedAction([olderScript], { [`GET ${runsApiUrl("script-1")}`]: { status: 200, body: [] } });

      renderActionDetailPage();

      const runCard = await screen.findByRole("region", { name: "Latest run" });
      expect(await within(runCard).findByText("This version has not been run yet.")).toBeInTheDocument();
      expect(within(runCard).getByRole("button", { name: "Run" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: /^Run history/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Output log/ })).not.toBeInTheDocument();
    });

    it("uses the single-column layout below 1200 px, while the breadcrumbs stay whole above 900 px", async () => {
      removeWidthStub = stubWindowWidth(1000);
      stubLoadedAction([newerScript, olderScript], {
        [`GET ${runsApiUrl("script-2")}`]: { status: 200, body: [] },
      });

      renderActionDetailPage(OPENED_FROM_WEBSITE);

      expect(await screen.findByRole("combobox", { name: VERSION_SELECT_NAME })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Versions" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
      await waitFor(() => {
        expect(readBreadcrumbTrail()).toEqual([
          { label: "Websites", href: LIST_PATH },
          { label: "Example", href: WEBSITE_PATH },
          { label: "Log in", href: null },
        ]);
      });
    });
  });
});
