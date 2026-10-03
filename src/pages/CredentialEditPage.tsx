import { type ReactElement, useState } from "react";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import CredentialForm from "../components/CredentialForm";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import { type CredentialRequestBody, useCredential } from "../hooks/useCredentials";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { useWebsite } from "../hooks/useWebsites";
import { WEBSITE_LIST_PATH, credentialApiUrl, websiteDetailPath } from "../utils/routePaths";

/**
 * The edit-credential page (`/websites/:websiteId/credentials/:credentialId/edit`),
 * which is also where a credential is deleted - it has no separate detail
 * page.
 *
 * Loads the credential and its website first and only then mounts the form,
 * keyed by the credential's id, so the fields start from the saved values and
 * the login page URL field knows the website's login page (the default when
 * the credential has no URL of its own, which then starts blank). The
 * password field always starts blank (the server never sends the password);
 * leaving it blank keeps the saved one. Save, Cancel, and a successful Delete
 * all return to the
 * website's page history-aware (see `useReturnNavigation`).
 * @returns The rendered edit-credential page
 */
export default function CredentialEditPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const credentialId = useRequiredRouteParam("credentialId");
  const websiteResource = useWebsite(websiteId);
  const website = websiteResource.data;
  const credentialResource = useCredential(websiteId, credentialId);
  const credential = credentialResource.data;
  const credentialOrWebsiteIsLoading = credentialResource.isLoading || websiteResource.isLoading;
  const loadErrorMessage = credentialResource.errorMessage ?? websiteResource.errorMessage;
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const {
    sendJsonRequest: sendDeleteRequest,
    isSubmitting: isDeleting,
    errorMessage: deleteErrorMessage,
  } = useJsonMutation();
  const [deleteDialogIsOpen, setDeleteDialogIsOpen] = useState(false);
  const { returnTo } = useReturnNavigation();
  const detailPath = websiteDetailPath(websiteId);

  /**
   * PUTs the edited credential and, when the server accepts it, returns to
   * the website's page. A blank password keeps the saved one. On failure the
   * form stays put and shows the server's reason.
   * @param values - The form's fields
   * @returns Resolves once the request (and any navigation) is done
   */
  const saveCredential = async (values: CredentialRequestBody): Promise<void> => {
    const result = await sendJsonRequest("PUT", credentialApiUrl(websiteId, credentialId), values);
    if (!result.succeeded) return;
    returnTo(detailPath);
  };

  /**
   * Hands the form values to `saveCredential` without returning its promise,
   * because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's fields
   */
  const handleSubmit = (values: CredentialRequestBody): void => {
    void saveCredential(values);
  };

  /** Leaves the form without saving, back to the website's page. */
  const handleCancel = (): void => {
    returnTo(detailPath);
  };

  /** Opens the delete confirmation dialog. */
  const handleDeleteClick = (): void => {
    setDeleteDialogIsOpen(true);
  };

  /** Closes the delete confirmation dialog without deleting. */
  const handleDeleteCancel = (): void => {
    setDeleteDialogIsOpen(false);
  };

  /**
   * DELETEs the credential and, when that succeeds, returns to the website's
   * page. On failure the dialog stays open and shows the server's reason.
   * @returns Resolves once the request (and any navigation) is done
   */
  const deleteCredential = async (): Promise<void> => {
    const result = await sendDeleteRequest("DELETE", credentialApiUrl(websiteId, credentialId));
    if (!result.succeeded) return;
    setDeleteDialogIsOpen(false);
    returnTo(detailPath);
  };

  /**
   * Starts the delete without returning its promise, because the dialog's
   * `onConfirm` prop expects a plain void callback.
   */
  const handleDeleteConfirm = (): void => {
    void deleteCredential();
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: detailPath },
          { label: credential?.name ?? "Credential" },
          { label: "Edit" },
        ]}
      />
      <Stack
        direction="row"
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}
      >
        <Typography variant="h4" component="h1">
          Edit credential
        </Typography>
        {credential !== null && (
          <Button onClick={handleDeleteClick} color="error" variant="outlined">
            Delete
          </Button>
        )}
      </Stack>

      <LoadStatusNotice
        isLoading={credentialOrWebsiteIsLoading}
        errorMessage={loadErrorMessage}
        loadingLabel="Loading credential"
      />

      {credential !== null && website !== null && (
        <CredentialForm
          key={credential.id}
          initialValues={{
            name: credential.name,
            description: credential.description ?? "",
            username: credential.username,
            password: "",
            loginUrl: credential.loginUrl ?? "",
            usernameSelector: credential.usernameSelector ?? "",
            passwordSelector: credential.passwordSelector ?? "",
            submitSelector: credential.submitSelector ?? "",
          }}
          websiteLoginUrl={website.loginUrl}
          passwordIsSaved={credential.hasPassword}
          submitLabel="Save changes"
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}

      {credential !== null && (
        <ConfirmDeleteDialog
          isOpen={deleteDialogIsOpen}
          title="Delete credential?"
          message={`"${credential.name}" will be deleted. Past crawls that logged in with it keep its name.`}
          isDeleting={isDeleting}
          errorMessage={deleteErrorMessage}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </Container>
  );
}
