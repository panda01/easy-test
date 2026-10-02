import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import TitleDescriptionForm from "../components/TitleDescriptionForm";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { type WebsiteItemRecord, type WebsiteItemRequestBody } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  websiteDetailPath,
  websiteItemDetailPath,
  websiteItemsApiUrl,
} from "../utils/routePaths";
import { type WebsiteItemPageProps } from "../utils/websiteItemKinds";

/** A blank title / description form. */
const EMPTY_ITEM_VALUES: WebsiteItemRequestBody = { title: "", description: "" };

/**
 * The create page for a use case or an action
 * (`/websites/:websiteId/<use-cases|actions>/new`).
 *
 * Loads the owning website first - for the breadcrumb, and so a deleted or
 * unknown website shows "Website not found" instead of a form that cannot be
 * saved. On save it REPLACES its own history entry with the new item's page;
 * Cancel returns to the website history-aware (see `useReturnNavigation`).
 * @param props - Which kind of item to create
 * @returns The rendered create page
 */
export default function WebsiteItemCreatePage(props: WebsiteItemPageProps): ReactElement {
  const { itemKind } = props;
  const websiteId = useRequiredRouteParam("websiteId");
  const websiteResource = useWebsite(websiteId);
  const website = websiteResource.data;
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const { returnTo, replaceKeepingReturnState } = useReturnNavigation();
  const websitePath = websiteDetailPath(websiteId);

  /**
   * POSTs the new item and, when the server accepts it, moves on to the
   * created item's page. On failure the form stays put and shows the reason.
   * @param values - The form's title and description
   * @returns Resolves once the request (and any navigation) is done
   */
  const createItem = async (values: WebsiteItemRequestBody): Promise<void> => {
    const result = await sendJsonRequest("POST", websiteItemsApiUrl(itemKind, websiteId), values);
    if (!result.succeeded) return;
    const createdItem = result.data as WebsiteItemRecord;
    replaceKeepingReturnState(websiteItemDetailPath(itemKind, websiteId, createdItem.id));
  };

  /**
   * Hands the form values to `createItem` without returning its promise,
   * because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's title and description
   */
  const handleSubmit = (values: WebsiteItemRequestBody): void => {
    void createItem(values);
  };

  /** Leaves the form without saving, back to the owning website's page. */
  const handleCancel = (): void => {
    returnTo(websitePath);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websitePath },
          { label: `New ${itemKind.singularLabel}` },
        ]}
      />
      <Typography variant="h4" component="h1" gutterBottom>
        New {itemKind.singularLabel}
      </Typography>

      <LoadStatusNotice
        isLoading={websiteResource.isLoading}
        errorMessage={websiteResource.errorMessage}
        loadingLabel="Loading website"
      />

      {website !== null && (
        <TitleDescriptionForm
          key={`${itemKind.kindId}-${website.id}`}
          initialValues={EMPTY_ITEM_VALUES}
          submitLabel={`Create ${itemKind.singularLabel}`}
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </Container>
  );
}
