import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import ActionScriptComparePage from "../../src/pages/ActionScriptComparePage";
import { type ActionPlan } from "../../src/utils/actionPlanSteps";
import {
  buildActionScriptRecord,
  buildActionScriptRefinementRecord,
  buildScriptModelCatalog,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  readBreadcrumbTrail,
  renderPageRoutes,
  stubFetchRoutes,
  type FetchStub,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const COMPARE_PATH = "/websites/website-1/actions/item-1/scripts/compare";
const ACTION_API_URL = "/api/websites/website-1/actions/item-1";
const SCRIPTS_API_URL = `${ACTION_API_URL}/scripts`;

/**
 * Builds a two-step login plan whose first step clicks the given link.
 * @param linkName - The name of the link the first step clicks
 * @returns The plan
 */
function buildLoginPlan(linkName: string): ActionPlan {
  return {
    name: "Log in",
    startUrl: "https://example.com/",
    steps: [
      { action: "click", target: { role: "link", name: linkName }, value: null },
      { action: "expectVisible", target: { role: "heading", name: "Welcome" }, value: null },
    ],
  };
}

const versionThree = buildActionScriptRecord({
  id: "script-3",
  actionTitle: "Log in to the shop",
  plan: buildLoginPlan("Log in"),
  createdAt: "2026-04-03T00:00:00.000Z",
});
const versionTwo = buildActionScriptRecord({
  id: "script-2",
  actionTitle: "Log in",
  plan: buildLoginPlan("Sign in"),
  modelId: "claude-haiku-4-5-20251001",
  effort: null,
  createdAt: "2026-04-02T00:00:00.000Z",
});
const versionOne = buildActionScriptRecord({
  id: "script-1",
  actionTitle: "Sign in",
  actionDescription: "An older description",
  plan: buildLoginPlan("Sign in"),
  createdAt: "2026-04-01T00:00:00.000Z",
});

/**
 * Renders the comparison page on its real route, at the given url.
 * @param url - The page url, query string included
 * @returns The Testing Library render result
 */
function renderComparePage(url: string = COMPARE_PATH): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/actions/:itemId/scripts/compare"
      element={<ActionScriptComparePage key="action-script-compare" />}
    />,
    { initialEntries: [url] },
  );
}

/**
 * Stubs the website, the action, its scripts, and the model catalog.
 * @param scripts - What the script list answers with
 * @param extraRoutes - Replacement replies
 * @returns The installed fetch stub
 */
function stubComparePage(scripts: unknown[], extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    "GET /api/websites/website-1": { status: 200, body: buildWebsiteRecord() },
    [`GET ${ACTION_API_URL}`]: {
      status: 200,
      body: buildWebsiteItemRecord({ title: "Log in to the shop" }),
    },
    [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: scripts },
    "GET /api/script-models": { status: 200, body: buildScriptModelCatalog() },
    ...extraRoutes,
  });
}

/**
 * Reads the text of a diff section's changed words.
 * @param sectionName - "Title", "Description", or "Plan"
 * @returns The highlighted words, in order
 */
function readChangedWords(sectionName: string): string[] {
  const section = screen.getByRole("region", { name: sectionName });
  return Array.from(section.querySelectorAll('[data-changed-word="true"]')).map(
    (changedWord) => changedWord.textContent,
  );
}

describe("ActionScriptComparePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("compares the second newest version with the newest by default", async () => {
    stubComparePage([versionThree, versionTwo, versionOne]);

    renderComparePage();

    expect(await screen.findByRole("heading", { level: 1, name: "Compare plan versions" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(/^Version 2 · /);
    });
    expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(/^Version 3 · /);
    expect(readChangedWords("Title")).toEqual([" to the shop"]);
    expect(within(screen.getByRole("region", { name: "Description" })).getByText("No differences.")).toBeInTheDocument();
    const planSection = screen.getByRole("region", { name: "Plan" });
    expect(planSection).toHaveTextContent('"name": "Sign in"');
    expect(planSection).toHaveTextContent('"name": "Log in"');
    expect(planSection).toHaveTextContent('"action": "expectVisible"');
    expect(readChangedWords("Plan")).toEqual(["Sign", "Log"]);
  });

  it("labels versions with their model and effort once the model list loads", async () => {
    stubComparePage([versionThree, versionTwo]);

    renderComparePage();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(
        "Claude Haiku 4.5 (claude-haiku-4-5-20251001) · Standard effort",
      );
    });
    expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(
      "Claude Opus 5.5 (claude-opus-5-5) · high effort",
    );
  });

  it("labels a version saved from the step editor as edited", async () => {
    const editedVersion = buildActionScriptRecord({
      ...versionThree,
      editedFromActionScriptId: "script-2",
      modelId: null,
      effort: null,
    });
    stubComparePage([editedVersion, versionTwo]);

    renderComparePage();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(/^Version 2 · .+ · edited$/);
    });
    expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(
      /^Version 1 · .+ · Claude Haiku 4\.5 \(claude-haiku-4-5-20251001\) · Standard effort$/,
    );
  });

  it("labels a version Claude refined from a failed run as refined, with its model and effort", async () => {
    const refinedVersion = buildActionScriptRecord({
      ...versionThree,
      refinement: buildActionScriptRefinementRecord({
        sourceActionScriptId: "script-2",
        refinedActionScriptId: "script-3",
      }),
    });
    stubComparePage([refinedVersion, versionTwo]);

    renderComparePage();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(
        /^Version 2 · .+ · refined · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort$/,
      );
    });
    expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(
      /^Version 1 · .+ · Claude Haiku 4\.5 \(claude-haiku-4-5-20251001\) · Standard effort$/,
    );
  });

  it("labels a generated version whose model was not recorded as an unknown model", async () => {
    const versionWithoutModel = buildActionScriptRecord({ ...versionThree, modelId: null });
    stubComparePage([versionWithoutModel, versionTwo]);

    renderComparePage();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(
        /^Version 2 · .+ · unknown model$/,
      );
    });
  });

  it("shows the versions named in the query string", async () => {
    stubComparePage([versionThree, versionTwo, versionOne]);

    renderComparePage(`${COMPARE_PATH}?from=script-1&to=script-2`);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(/^Version 1 · /);
    });
    expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(/^Version 2 · /);
    const changedDescriptionWords = readChangedWords("Description");
    expect(changedDescriptionWords).toContain("older");
    expect(changedDescriptionWords).toContain("with a valid account");
  });

  it("falls back to the defaults for ids it does not know", async () => {
    stubComparePage([versionThree, versionTwo]);

    renderComparePage(`${COMPARE_PATH}?from=gone&to=also-gone`);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(/^Version 1 · /);
    });
    expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(/^Version 2 · /);
  });

  it("switches either side when a version is picked", async () => {
    const user = userEvent.setup();
    stubComparePage([versionThree, versionTwo, versionOne]);
    renderComparePage();
    await screen.findByRole("heading", { level: 1, name: "Compare plan versions" });

    await user.click(await screen.findByRole("combobox", { name: /^From/ }));
    await user.click(await screen.findByRole("option", { name: /^Version 1 · / }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(/^Version 1 · /);
    });

    await user.click(screen.getByRole("combobox", { name: /^To/ }));
    await user.click(await screen.findByRole("option", { name: /^Version 2 · / }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^To/ })).toHaveTextContent(/^Version 2 · /);
    });
    expect(readChangedWords("Title")).toEqual(["Sign", "Log"]);
    expect(within(screen.getByRole("region", { name: "Plan" })).getByText("No differences.")).toBeInTheDocument();
  });

  it("explains that two versions are needed when there are fewer", async () => {
    stubComparePage([versionOne]);

    renderComparePage();

    expect(
      await screen.findByText("Convert, refine, or edit this action's plan at least twice to compare versions."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^From/ })).not.toBeInTheDocument();
  });

  it("links back up the trail to the website and the action", async () => {
    stubComparePage([versionThree, versionTwo]);

    renderComparePage();

    await screen.findByRole("heading", { level: 1, name: "Compare plan versions" });
    await waitFor(() => {
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: "/" },
        { label: "Example", href: "/websites/website-1" },
        { label: "Log in to the shop", href: "/websites/website-1/actions/item-1" },
        { label: "Compare versions", href: null },
      ]);
    });
  });

  it("shows the server's not-found text for an unknown action", async () => {
    stubComparePage([], {
      [`GET ${ACTION_API_URL}`]: { status: 404, body: { error: "Action not found" } },
    });

    renderComparePage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Action not found");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("still compares, by model id, when the model list cannot load", async () => {
    stubComparePage([versionThree, versionTwo], {
      "GET /api/script-models": { status: 503, body: { error: "ANTHROPIC_API_KEY is not set" } },
    });

    renderComparePage();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /^From/ })).toHaveTextContent(
        "claude-haiku-4-5-20251001 · no effort level",
      );
    });
  });
});
