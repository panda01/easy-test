import { type ReactElement } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import AppHeader from "./components/AppHeader";
import ActionDetailPage from "./pages/ActionDetailPage";
import ActionScriptComparePage from "./pages/ActionScriptComparePage";
import CrawlRunPage from "./pages/CrawlRunPage";
import CredentialCreatePage from "./pages/CredentialCreatePage";
import CredentialEditPage from "./pages/CredentialEditPage";
import HomePage from "./pages/HomePage";
import UseCaseDetailPage from "./pages/UseCaseDetailPage";
import WebsiteCreatePage from "./pages/WebsiteCreatePage";
import WebsiteDetailPage from "./pages/WebsiteDetailPage";
import WebsiteEditPage from "./pages/WebsiteEditPage";
import WebsiteItemCreatePage from "./pages/WebsiteItemCreatePage";
import WebsiteItemEditPage from "./pages/WebsiteItemEditPage";
import { ACTION_KIND, USE_CASE_KIND } from "./utils/websiteItemKinds";

/**
 * Application shell: the router, the header shown on every page, and the
 * route table. The home page is the websites dashboard, so `/websites`
 * redirects to it.
 *
 * Every screen - including each create and edit form - is its own URL, so the
 * browser's Back and Forward buttons move between screens, and each page
 * fetches its data when it mounts.
 *
 * Paths are written out literally (rather than generated from
 * `utils/routePaths.ts`) so grepping for a URL pattern finds its route here.
 *
 * Each use case / action route element carries a distinct `key`. react-router
 * reuses a mounted component when two routes render the same component type
 * (e.g. Back from an action's edit page to a use case's edit page), which
 * would carry state across; the key forces a fresh mount per route instead.
 * The detail pages are separate components (`UseCaseDetailPage`,
 * `ActionDetailPage`) and keep their keys for consistency.
 * @returns The routed application
 */
export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />

        {/* The dashboard at "/" is the website list; the old list URL lands there. */}
        <Route path="/websites" element={<Navigate to="/" replace />} />
        <Route path="/websites/new" element={<WebsiteCreatePage />} />
        <Route path="/websites/:websiteId" element={<WebsiteDetailPage />} />
        <Route path="/websites/:websiteId/edit" element={<WebsiteEditPage />} />
        <Route path="/websites/:websiteId/crawl-runs/:crawlRunId" element={<CrawlRunPage />} />
        <Route path="/websites/:websiteId/credentials/new" element={<CredentialCreatePage />} />
        <Route
          path="/websites/:websiteId/credentials/:credentialId/edit"
          element={<CredentialEditPage />}
        />

        <Route
          path="/websites/:websiteId/use-cases/new"
          element={<WebsiteItemCreatePage key="use-case-create" itemKind={USE_CASE_KIND} />}
        />
        <Route
          path="/websites/:websiteId/use-cases/:itemId"
          element={<UseCaseDetailPage key="use-case-detail" />}
        />
        <Route
          path="/websites/:websiteId/use-cases/:itemId/edit"
          element={<WebsiteItemEditPage key="use-case-edit" itemKind={USE_CASE_KIND} />}
        />

        <Route
          path="/websites/:websiteId/actions/new"
          element={<WebsiteItemCreatePage key="action-create" itemKind={ACTION_KIND} />}
        />
        <Route
          path="/websites/:websiteId/actions/:itemId"
          element={<ActionDetailPage key="action-detail" />}
        />
        <Route
          path="/websites/:websiteId/actions/:itemId/scripts/compare"
          element={<ActionScriptComparePage key="action-script-compare" />}
        />
        <Route
          path="/websites/:websiteId/actions/:itemId/edit"
          element={<WebsiteItemEditPage key="action-edit" itemKind={ACTION_KIND} />}
        />
      </Routes>
    </BrowserRouter>
  );
}
