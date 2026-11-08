import { type ReactElement, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import TitleDescriptionForm from "./TitleDescriptionForm";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { type WebsiteItemRecord, type WebsiteItemRequestBody } from "../hooks/useWebsiteItems";
import { nocturneTokens } from "../theme/nocturneTheme";
import { deleteActionApiUrl, deleteActionProposalApiUrl } from "../utils/routePaths";

/** What the proposal route answers with. */
export interface DeleteActionProposalRecord {
  /** The proposed title. */
  title: string;
  /** The proposed description. */
  description: string;
  /** The model that wrote it. */
  modelId: string;
}

/** Props for `DeleteActionStep`. */
export interface DeleteActionStepProps {
  /** The owning website's cuid. */
  websiteId: string;
  /** The Create action the Delete action will clean up after. */
  createAction: WebsiteItemRecord;
  /** Called with the new Delete action once the server has created and linked it. */
  onCreated: (deleteAction: WebsiteItemRecord) => void;
  /** Called when the user skips this step; the Create action then has no delete action yet. */
  onSkip: () => void;
}

/**
 * Step 2 of making a Create action: its Delete action. Asks the server for
 * Claude's proposal (the inverse of the Create action's title and
 * description, with the same names and values, confirming the deletion when
 * the site asks), shows it pre-filled in the title / description form for
 * the user to correct, and saves it with "Create delete action" - or lets
 * them skip it with "Skip for now", in which case the Create action's runs
 * fail until a delete action is added from its page.
 *
 * The proposal is requested once, when the step mounts; a failed proposal
 * shows the reason with "Try again", and the form can still be filled by
 * hand meanwhile (it starts blank then).
 * @param props - The Create action, and what to do once the Delete action exists or the step is skipped
 * @returns The rendered step
 */
export default function DeleteActionStep(props: DeleteActionStepProps): ReactElement {
  const { websiteId, createAction, onCreated, onSkip } = props;
  const { sendJsonRequest: sendProposalRequest, errorMessage: proposalErrorMessage } = useJsonMutation();
  const { sendJsonRequest: sendCreateRequest, isSubmitting, errorMessage } = useJsonMutation();
  const [proposal, setProposal] = useState<DeleteActionProposalRecord | null>(null);
  const [proposalAttempt, setProposalAttempt] = useState(0);
  // Starts as loading so the form never shows blank before the proposal was asked for.
  const [proposalStatus, setProposalStatus] = useState<"loading" | "ready" | "failed">("loading");
  // Which proposal was already asked for, so React's development double
  // mount (StrictMode) does not ask Claude twice for the same one.
  const requestedProposalKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const proposalKey = `${createAction.id}:${String(proposalAttempt)}`;
    const proposalWasAlreadyRequested = requestedProposalKeyRef.current === proposalKey;
    if (!proposalWasAlreadyRequested) {
      requestedProposalKeyRef.current = proposalKey;
      /**
       * Asks for the proposal and keeps it unless the step unmounted meanwhile.
       * @returns Resolves once the request is done
       */
      const loadProposal = async (): Promise<void> => {
        setProposalStatus("loading");
        const result = await sendProposalRequest("POST", deleteActionProposalApiUrl(websiteId, createAction.id));
        if (!isMountedRef.current) return;
        if (!result.succeeded) {
          setProposalStatus("failed");
          return;
        }
        setProposal(result.data as DeleteActionProposalRecord);
        setProposalStatus("ready");
      };
      void loadProposal();
    }
    return () => {
      isMountedRef.current = false;
    };
    // `sendProposalRequest` is stable (a `useCallback` with no dependencies);
    // `proposalAttempt` re-asks after a failure.
  }, [websiteId, createAction.id, proposalAttempt, sendProposalRequest]);

  /**
   * POSTs the (possibly edited) Delete action and hands it to the page.
   * @param values - The form's title and description
   * @returns Resolves once the request (and any navigation) is done
   */
  const createDeleteAction = async (values: WebsiteItemRequestBody): Promise<void> => {
    const result = await sendCreateRequest("POST", deleteActionApiUrl(websiteId, createAction.id), {
      title: values.title,
      description: values.description,
    });
    if (!result.succeeded) return;
    onCreated(result.data as WebsiteItemRecord);
  };

  /**
   * Hands the form values to `createDeleteAction` without returning its
   * promise, because the form's `onSubmit` prop expects a plain void callback.
   * @param values - The form's title and description
   */
  const handleSubmit = (values: WebsiteItemRequestBody): void => {
    void createDeleteAction(values);
  };

  /** Asks Claude for the proposal again after a failure. */
  const handleRetry = (): void => {
    setProposalAttempt((attempt) => attempt + 1);
  };

  const proposalIsLoading = proposalStatus === "loading";
  const proposalFailed = proposalStatus === "failed";
  const initialValues: WebsiteItemRequestBody =
    proposal === null ? { title: "", description: "" } : { title: proposal.title, description: proposal.description };

  return (
    <Stack spacing={2}>
      <Typography sx={{ fontSize: 13.5, color: nocturneTokens.neutral[400] }}>
        Every run of <strong>{createAction.title}</strong> makes an object. This delete action removes it
        afterwards, so the run only passes when the cleanup passes too. Check the proposal and correct it
        where needed.
      </Typography>
      <LoadStatusNotice isLoading={proposalIsLoading} errorMessage={null} loadingLabel="Proposing the delete action" />
      {proposalFailed && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={handleRetry}>
              Try again
            </Button>
          }
        >
          Claude could not propose the delete action: {proposalErrorMessage}. Write it below, or try again.
        </Alert>
      )}
      {!proposalIsLoading && (
        <TitleDescriptionForm
          key={proposal === null ? `blank-${String(proposalAttempt)}` : `proposal-${String(proposalAttempt)}`}
          initialValues={initialValues}
          submitLabel="Create delete action"
          submitButtonShowsPlus
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onSubmit={handleSubmit}
          onCancel={onSkip}
          cancelLabel="Skip for now"
        />
      )}
    </Stack>
  );
}
