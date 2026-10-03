import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import CredentialForm from "../components/CredentialForm";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import { type CredentialRequestBody } from "../hooks/useCredentials";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { useWebsite } from "../hooks/useWebsites";
import { WEBSITE_LIST_PATH, credentialsApiUrl, websiteDetailPath } from "../utils/routePaths";

/**
 * A new credential's starting values: every field blank. A blank login page
 * URL uses the website's login page; the form requires one only when the
 * website has none.
 */
const NEW_CREDENTIAL_VALUES: CredentialRequestBody = {
  name: "",
  description: "",
  username: "",
  password: "",
  loginUrl: "",
  usernameSelector: "",
  passwordSelector: "",
  submitSelector: "",
};

/**
 * The create-credential page (`/websites/:websiteId/credentials/new`).
 *
 * Loads the website first (for the breadcrumb and for its login page URL,
 * which the form offers as the default - or, when the website has none,
 * requires the credential to have its own), then mounts the form with every
 * field blank. Save and Cancel both
 * return to the website's page history-aware (see `useReturnNavigation`):
 * credentials are listed there, and have no page of their own to open.
 * @returns The rendered create-credential page
 */
export default function CredentialCreatePage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const websiteResource = useWebsite(websiteId);
  const website = websiteResource.data;
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const { returnTo } = useReturnNavigation();
  const detailPath = websiteDetailPath(websiteId);

  /**
   * POSTs the new credential and, when the server accepts it, returns to the
   * website's page. On failure the form stays put and shows the server's
   * reason.
   * @param values - The form's fields, password included
   * @returns Resolves once the request (and any navigation) is done
   */
  const createCredential = async (values: CredentialRequestBody): Promise<void> => {
    const result = await sendJsonRequest("POST", credentialsApiUrl(websiteId), values);
    if (!result.succeeded) return;
    returnTo(detailPath);
  };

  /**
   * Hands the form values to `createCredential` without returning its
   * promise, because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's fields, password included
   */
  const handleSubmit = (values: CredentialRequestBody): void => {
    void createCredential(values);
  };

  /** Leaves the form without saving, back to the website's page. */
  const handleCancel = (): void => {
    returnTo(detailPath);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: detailPath },
          { label: "New credential" },
        ]}
      />
      <Typography variant="h4" component="h1" gutterBottom>
        New credential
      </Typography>

      <LoadStatusNotice
        isLoading={websiteResource.isLoading}
        errorMessage={websiteResource.errorMessage}
        loadingLabel="Loading website"
      />

      {website !== null && (
        <CredentialForm
          key={website.id}
          initialValues={NEW_CREDENTIAL_VALUES}
          websiteLoginUrl={website.loginUrl}
          passwordIsSaved={false}
          submitLabel="Create credential"
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </Container>
  );
}
