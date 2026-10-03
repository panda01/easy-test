import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, type RenderResult } from "@testing-library/react";
import { Route } from "react-router-dom";
import UseCaseDetailPage from "../../src/pages/UseCaseDetailPage";
import {
  ITEM_KIND_TEST_CASES,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  renderPageRoutes,
  stubFetchRoutes,
  type RouterStart,
} from "./support/frontendTestHelpers";
import { defineWebsiteItemDetailPageCases } from "./support/websiteItemDetailPageCases";

const USE_CASE_TEST_CASE = ITEM_KIND_TEST_CASES[0];

/**
 * Renders the use case page on its real route, keyed exactly as App.tsx
 * declares it.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderUseCaseDetailPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/use-cases/:itemId"
      element={<UseCaseDetailPage key="use-case-detail" />}
    />,
    routerStart,
  );
}

describe("UseCaseDetailPage", () => {
  describe("summary and delete flow", () => {
    defineWebsiteItemDetailPageCases({
      kindCase: USE_CASE_TEST_CASE,
      renderPage: renderUseCaseDetailPage,
      buildPageLoadRoutes: () => ({}),
    });
  });

  describe("scripts", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("has no scripts section and never asks for scripts", async () => {
      // Any request outside this table rejects loudly, so a scripts request
      // would surface as an error alert.
      const fetchStub = stubFetchRoutes({
        "GET /api/websites/website-1": { status: 200, body: buildWebsiteRecord() },
        "GET /api/websites/website-1/use-cases/item-1": {
          status: 200,
          body: buildWebsiteItemRecord(),
        },
      });

      renderUseCaseDetailPage({ initialEntries: ["/websites/website-1/use-cases/item-1"] });

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Scripts" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Convert to script" })).not.toBeInTheDocument();
      const requestedUrls = fetchStub.mock.calls.map(([requestedUrl]) => String(requestedUrl));
      expect(requestedUrls.some((requestedUrl) => requestedUrl.includes("/scripts"))).toBe(false);
    });
  });
});
