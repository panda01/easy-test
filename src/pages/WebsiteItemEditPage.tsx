import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import TitleDescriptionForm from "../components/TitleDescriptionForm";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { type WebsiteItemRequestBody, useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  websiteDetailPath,
  websiteItemApiUrl,
  websiteItemDetailPath,
} from "../utils/routePaths";
import { type WebsiteItemPageProps } from "../utils/websiteItemKinds";

/**
 * The edit page for a use case or an action
 * (`/websites/:websiteId/<use-cases|actions>/:itemId/edit`).
 *
 * Loads the item first and only then mounts the form, keyed by kind and id,
 * so the fields always start from the saved values. Save and Cancel both
 * return to the item's page history-aware (see `useReturnNavigation`).
 * @param props - Which kind of item to edit
 * @returns The rendered edit page
 */
export default function WebsiteItemEditPage(props: WebsiteItemPageProps): ReactElement {
  const { itemKind } = props;
  const websiteId = useRequiredRouteParam("websiteId");
  const itemId = useRequiredRouteParam("itemId");
  const websiteResource = useWebsite(websiteId);
  const itemResource = useWebsiteItem(itemKind, websiteId, itemId);
  const website = websiteResource.data;
  const item = itemResource.data;
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const { returnTo } = useReturnNavigation();
  const itemPath = websiteItemDetailPath(itemKind, websiteId, itemId);

  /**
   * PUTs the edited item and, when the server accepts it, returns to the
   * item's page. On failure the form stays put and shows the server's reason.
   * @param values - The form's title and description
   * @returns Resolves once the request (and any navigation) is done
   */
  const saveItem = async (values: WebsiteItemRequestBody): Promise<void> => {
    const result = await sendJsonRequest(
      "PUT",
      websiteItemApiUrl(itemKind, websiteId, itemId),
      values,
    );
    if (!result.succeeded) return;
    returnTo(itemPath);
  };

  /**
   * Hands the form values to `saveItem` without returning its promise,
   * because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's title and description
   */
  const handleSubmit = (values: WebsiteItemRequestBody): void => {
    void saveItem(values);
  };

  /** Leaves the form without saving, back to the item's page. */
  const handleCancel = (): void => {
    returnTo(itemPath);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
          { label: item?.title ?? itemKind.singularTitle, to: itemPath },
          { label: "Edit" },
        ]}
      />
      <Typography variant="h4" component="h1" gutterBottom>
        Edit {itemKind.singularLabel}
      </Typography>

      <LoadStatusNotice
        isLoading={itemResource.isLoading}
        errorMessage={itemResource.errorMessage}
        loadingLabel={`Loading ${itemKind.singularLabel}`}
      />

      {item !== null && (
        <TitleDescriptionForm
          key={`${itemKind.kindId}-${item.id}`}
          initialValues={{ title: item.title, description: item.description }}
          submitLabel="Save changes"
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </Container>
  );
}
