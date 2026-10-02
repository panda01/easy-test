import { type ReactElement } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import WebsiteForm from "../components/WebsiteForm";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useReturnNavigation } from "../hooks/useReturnNavigation";
import { type WebsiteRecord, type WebsiteRequestBody } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  WEBSITES_API_URL,
  websiteDetailPath,
} from "../utils/routePaths";

/** A blank website form. */
const EMPTY_WEBSITE_VALUES: WebsiteRequestBody = { url: "", name: "", description: "" };

/**
 * The create-website page (`/websites/new`).
 *
 * On save it REPLACES its own history entry with the new website's detail
 * page, so Back from there goes to the list rather than to a stale form.
 * Cancel returns to the list the same history-aware way (see
 * `useReturnNavigation`).
 * @returns The rendered create-website page
 */
export default function WebsiteCreatePage(): ReactElement {
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const { returnTo, replaceKeepingReturnState } = useReturnNavigation();

  /**
   * POSTs the new website and, when the server accepts it, moves on to the
   * created website's page. On failure the form stays put and shows the
   * server's reason.
   * @param values - The form's URL, name, and description
   * @returns Resolves once the request (and any navigation) is done
   */
  const createWebsite = async (values: WebsiteRequestBody): Promise<void> => {
    const result = await sendJsonRequest("POST", WEBSITES_API_URL, values);
    if (!result.succeeded) return;
    const createdWebsite = result.data as WebsiteRecord;
    replaceKeepingReturnState(websiteDetailPath(createdWebsite.id));
  };

  /**
   * Hands the form values to `createWebsite` without returning its promise,
   * because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's URL, name, and description
   */
  const handleSubmit = (values: WebsiteRequestBody): void => {
    void createWebsite(values);
  };

  /** Leaves the form without saving, back to the website list. */
  const handleCancel = (): void => {
    returnTo(WEBSITE_LIST_PATH);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[{ label: "Websites", to: WEBSITE_LIST_PATH }, { label: "New website" }]}
      />
      <Typography variant="h4" component="h1" gutterBottom>
        New website
      </Typography>
      <WebsiteForm
        initialValues={EMPTY_WEBSITE_VALUES}
        submitLabel="Create website"
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </Container>
  );
}
