import { useCallback, useEffect, useState } from "react";
import { type VersionParametersRecord } from "../utils/actionParameters";
import { describeError, readResponseErrorMessage } from "../utils/describeError";
import { actionScriptParametersApiUrl } from "../utils/routePaths";

/** What `useActionParameters` hands back. */
export interface ActionParametersState {
  /** The shown version's parameters view, or null while there is none (loading, failed, or no version). */
  view: VersionParametersRecord | null;
  /** True until the first view for the current version has arrived. */
  isLoading: boolean;
  /** Why the view could not be fetched, or null. */
  errorMessage: string | null;
  /** Fetches the view again (after a run, or a parameter was changed), keeping the current one shown meanwhile. */
  reloadParameters: () => void;
  /** Shows a view a request just answered with (an "add a parameter" POST), without refetching. */
  showParameters: (view: VersionParametersRecord) => void;
}

/** A finished fetch, remembered with the url it was for. */
interface FinishedParametersRequest {
  resourceUrl: string;
  view: VersionParametersRecord | null;
  errorMessage: string | null;
}

/**
 * Fetches one version's parameters
 * (`GET /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/parameters`):
 * the action's object role, the parameters, the object choices, and a Create
 * action's confirm step and name parameter.
 *
 * Unlike `useJsonResource` it can be reloaded - a run teaches the parameters
 * new readings and may create an object, and the Parameters section changes
 * them - and a reload keeps the current view shown until the new one
 * arrives, so nothing flashes. A null version fetches nothing.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The shown version, or null when there is none
 * @returns The view, the request's state, and the reload and replace functions
 */
export function useActionParameters(
  websiteId: string,
  actionId: string,
  actionScriptId: string | null,
): ActionParametersState {
  const resourceUrl =
    actionScriptId === null ? null : actionScriptParametersApiUrl(websiteId, actionId, actionScriptId);
  const [finishedRequest, setFinishedRequest] = useState<FinishedParametersRequest | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const thereIsNothingToFetch = resourceUrl === null;
    if (thereIsNothingToFetch) return;
    let cancelled = false;

    /**
     * Performs the GET and records its outcome for `resourceUrl`.
     * @returns Resolves once the outcome is recorded (or discarded when cancelled)
     */
    const loadParameters = async (): Promise<void> => {
      try {
        const response = await fetch(resourceUrl);
        if (!response.ok) throw new Error(await readResponseErrorMessage(response));
        // The API is the contract for this shape; see useJsonResource.
        const view = (await response.json()) as VersionParametersRecord;
        if (cancelled) return;
        setFinishedRequest({ resourceUrl, view, errorMessage: null });
      } catch (err: unknown) {
        if (cancelled) return;
        setFinishedRequest({ resourceUrl, view: null, errorMessage: describeError(err) });
      }
    };

    void loadParameters();
    return () => {
      cancelled = true;
    };
  }, [resourceUrl, reloadCount]);

  const reloadParameters = useCallback((): void => {
    setReloadCount((previousCount) => previousCount + 1);
  }, []);

  const showParameters = useCallback(
    (view: VersionParametersRecord): void => {
      if (resourceUrl === null) return;
      setFinishedRequest({ resourceUrl, view, errorMessage: null });
    },
    [resourceUrl],
  );

  const requestIsForThisVersion = resourceUrl !== null && finishedRequest?.resourceUrl === resourceUrl;
  return {
    view: requestIsForThisVersion ? finishedRequest.view : null,
    isLoading: resourceUrl !== null && !requestIsForThisVersion,
    errorMessage: requestIsForThisVersion ? finishedRequest.errorMessage : null,
    reloadParameters,
    showParameters,
  };
}
