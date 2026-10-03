import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import WebsiteItemSummary from "../components/WebsiteItemSummary";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnToHereState } from "../hooks/useReturnNavigation";
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsiteItemDeletion } from "../hooks/useWebsiteItemDeletion";
import { useWebsite } from "../hooks/useWebsites";
import { WEBSITE_LIST_PATH, websiteDetailPath } from "../utils/routePaths";
import { USE_CASE_KIND } from "../utils/websiteItemKinds";

/**
 * A use case's own page (`/websites/:websiteId/use-cases/:itemId`): its
 * title, description, and timestamps, with Edit and Delete buttons.
 *
 * The owning website is fetched only for the breadcrumb; the use case request
 * alone decides loading / not-found, because the server already answers 404
 * for a use case whose website is gone. After a delete it returns to the
 * website history-aware (see `useWebsiteItemDeletion`).
 * @returns The rendered use case detail page
 */
export default function UseCaseDetailPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const useCaseId = useRequiredRouteParam("itemId");
  const websiteResource = useWebsite(websiteId);
  const useCaseResource = useWebsiteItem(USE_CASE_KIND, websiteId, useCaseId);
  const website = websiteResource.data;
  const useCase = useCaseResource.data;

  const returnToHereState = useReturnToHereState();
  const deletion = useWebsiteItemDeletion(USE_CASE_KIND, websiteId, useCaseId);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
          { label: useCase?.title ?? USE_CASE_KIND.singularTitle },
        ]}
      />

      <LoadStatusNotice
        isLoading={useCaseResource.isLoading}
        errorMessage={useCaseResource.errorMessage}
        loadingLabel={`Loading ${USE_CASE_KIND.singularLabel}`}
      />

      {useCase !== null && (
        <WebsiteItemSummary
          itemKind={USE_CASE_KIND}
          websiteId={websiteId}
          item={useCase}
          editLinkState={returnToHereState}
          deletion={deletion}
        />
      )}
    </Container>
  );
}
