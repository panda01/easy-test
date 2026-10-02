import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import WebsiteForm from "../components/WebsiteForm";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { type WebsiteRequestBody, useWebsite } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  websiteApiUrl,
  websiteDetailPath,
} from "../utils/routePaths";

/**
 * The edit-website page (`/websites/:websiteId/edit`).
 *
 * Loads the website first and only then mounts the form, keyed by the
 * website's id, so the fields always start from the saved values. Save and
 * Cancel both return to the website's detail page history-aware (see
 * `useReturnNavigation`), so the form never lingers in Back/Forward history.
 * @returns The rendered edit-website page
 */
export default function WebsiteEditPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const websiteResource = useWebsite(websiteId);
  const website = websiteResource.data;
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const { returnTo } = useReturnNavigation();
  const detailPath = websiteDetailPath(websiteId);

  /**
   * PUTs the edited website and, when the server accepts it, returns to its
   * detail page. On failure the form stays put and shows the server's reason.
   * @param values - The form's URL, name, and description
   * @returns Resolves once the request (and any navigation) is done
   */
  const saveWebsite = async (values: WebsiteRequestBody): Promise<void> => {
    const result = await sendJsonRequest("PUT", websiteApiUrl(websiteId), values);
    if (!result.succeeded) return;
    returnTo(detailPath);
  };

  /**
   * Hands the form values to `saveWebsite` without returning its promise,
   * because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's URL, name, and description
   */
  const handleSubmit = (values: WebsiteRequestBody): void => {
    void saveWebsite(values);
  };

  /** Leaves the form without saving, back to the website's detail page. */
  const handleCancel = (): void => {
    returnTo(detailPath);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: detailPath },
          { label: "Edit" },
        ]}
      />
      <Typography variant="h4" component="h1" gutterBottom>
        Edit website
      </Typography>

      <LoadStatusNotice
        isLoading={websiteResource.isLoading}
        errorMessage={websiteResource.errorMessage}
        loadingLabel="Loading website"
      />

      {website !== null && (
        <WebsiteForm
          key={website.id}
          initialValues={{
            url: website.url,
            name: website.name,
            description: website.description ?? "",
          }}
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
