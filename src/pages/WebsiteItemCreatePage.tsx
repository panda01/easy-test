import { type ReactElement, useState } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import DeleteActionStep from "../components/DeleteActionStep";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import TitleDescriptionForm from "../components/TitleDescriptionForm";
import { useLoginChoices } from "../hooks/useLoginChoices";
import { useWebObjects } from "../hooks/useWebObjects";
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
 * (`/websites/:websiteId/<use-cases|actions>/new`). An action's form also
 * asks what it does with an object (Kind and Object type - each on "Detect"
 * to start) and how it logs in: the Login action's login page and
 * selectors, or the credential any other action runs as (or none).
 *
 * Loads the owning website first - for the breadcrumb, and so a deleted or
 * unknown website shows "Website not found" instead of a form that cannot be
 * saved. On save it REPLACES its own history entry with the new item's page;
 * Cancel returns to the website history-aware (see `useReturnNavigation`).
 * Its "Create use case" / "Create action" button carries a plus, like every
 * button that creates something.
 *
 * STEP 2: when the saved action's kind is Create, the page does not leave
 * yet - it shows `DeleteActionStep`, Claude's proposed Delete action for the
 * user to correct and save (or skip), and moves on to the Create action's
 * page once that is done.
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
  const itemTakesALogin = itemKind.kindId === "action";
  const loginChoicesState = useLoginChoices(websiteId, itemTakesALogin, website?.loginUrl ?? null, null);
  const { loginChoices } = loginChoicesState;
  // An action's form waits for the credential and Login action lists, so its
  // login selects never start out missing a choice the user could pick.
  const formIsReady = !itemTakesALogin || loginChoices !== null;
  const webObjects = useWebObjects(websiteId).data ?? [];
  const objectTypes = webObjects.map((webObject) => ({
    key: webObject.instancePatternKey,
    name: webObject.name ?? webObject.detectedName,
  }));
  // Step 2 of a Create action: the Create action just saved, while its Delete action is proposed.
  const [createdCreateAction, setCreatedCreateAction] = useState<WebsiteItemRecord | null>(null);

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
    const itemIsACreateAction = itemTakesALogin && createdItem.objectRole?.kind === "create";
    if (itemIsACreateAction) {
      setCreatedCreateAction(createdItem);
      return;
    }
    replaceKeepingReturnState(websiteItemDetailPath(itemKind, websiteId, createdItem.id));
  };

  /** Moves on to the saved Create action's page, with or without a Delete action. */
  const finishCreateActionStep = (): void => {
    if (createdCreateAction === null) return;
    replaceKeepingReturnState(websiteItemDetailPath(itemKind, websiteId, createdCreateAction.id));
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
        {createdCreateAction === null ? `New ${itemKind.singularLabel}` : "Step 2: its delete action"}
      </Typography>

      <LoadStatusNotice
        isLoading={websiteResource.isLoading}
        errorMessage={websiteResource.errorMessage}
        loadingLabel="Loading website"
      />

      {itemTakesALogin && (
        <LoadStatusNotice
          isLoading={loginChoicesState.isLoading}
          errorMessage={loginChoicesState.errorMessage}
          loadingLabel="Loading credentials and login actions"
        />
      )}

      {createdCreateAction !== null && (
        <DeleteActionStep
          websiteId={websiteId}
          createAction={createdCreateAction}
          onCreated={finishCreateActionStep}
          onSkip={finishCreateActionStep}
        />
      )}

      {website !== null && formIsReady && createdCreateAction === null && (
        <TitleDescriptionForm
          key={`${itemKind.kindId}-${website.id}`}
          initialValues={EMPTY_ITEM_VALUES}
          submitLabel={`Create ${itemKind.singularLabel}`}
          submitButtonShowsPlus
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          loginChoices={loginChoices ?? undefined}
          objectRoleChoices={itemTakesALogin ? { objectTypes, detectedRole: null } : undefined}
        />
      )}
    </Container>
  );
}
