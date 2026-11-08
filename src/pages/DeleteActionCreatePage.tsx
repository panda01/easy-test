import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import DeleteActionStep from "../components/DeleteActionStep";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { WEBSITE_LIST_PATH, websiteDetailPath, websiteItemDetailPath } from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/**
 * The page that adds a Delete action to a Create action that has none yet
 * (`/websites/:websiteId/actions/:itemId/delete-action/new`) - the same
 * step 2 the create page shows, reached from the action's page after "Skip
 * for now". Loads the website (for the breadcrumb) and the Create action,
 * refuses with a notice when the action's kind is not Create or it already
 * has a delete action, and returns to the action's page once the Delete
 * action exists or the step is skipped again.
 * @returns The rendered page
 */
export default function DeleteActionCreatePage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const actionId = useRequiredRouteParam("itemId");
  const websiteResource = useWebsite(websiteId);
  const website = websiteResource.data;
  const actionResource = useWebsiteItem(ACTION_KIND, websiteId, actionId);
  const action = actionResource.data;
  const { returnTo } = useReturnNavigation();
  const actionPath = websiteItemDetailPath(ACTION_KIND, websiteId, actionId);

  /** Goes back to the Create action's page. */
  const returnToAction = (): void => {
    returnTo(actionPath);
  };

  const actionIsNotACreateAction = action !== null && action.objectRole?.kind !== "create";
  const actionAlreadyHasADeleteAction = action !== null && (action.deleteAction ?? null) !== null;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
          { label: action?.title ?? "Action", to: actionPath },
          { label: "Delete action" },
        ]}
      />
      <Typography variant="h4" component="h1" gutterBottom>
        Add its delete action
      </Typography>
      <LoadStatusNotice
        isLoading={websiteResource.isLoading}
        errorMessage={websiteResource.errorMessage}
        loadingLabel="Loading website"
      />
      <LoadStatusNotice
        isLoading={actionResource.isLoading}
        errorMessage={actionResource.errorMessage}
        loadingLabel="Loading action"
      />
      {actionIsNotACreateAction && (
        <Alert severity="info">Only a Create action gets a delete action; this action&apos;s kind is not Create.</Alert>
      )}
      {actionAlreadyHasADeleteAction && (
        <Alert severity="info">This action already has a delete action: {action.deleteAction?.title}.</Alert>
      )}
      {action !== null && !actionIsNotACreateAction && !actionAlreadyHasADeleteAction && (
        <DeleteActionStep
          websiteId={websiteId}
          createAction={action}
          onCreated={returnToAction}
          onSkip={returnToAction}
        />
      )}
    </Container>
  );
}
