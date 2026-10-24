import { useCallback, useEffect, useState } from "react";
import { useJsonMutation } from "./useJsonMutation";
import { describeError, readResponseErrorMessage } from "../utils/describeError";
import { createdObjectApiUrl, createdObjectsApiUrl } from "../utils/routePaths";

/**
 * One object a Create action's run made, as the record lists it. Dates
 * arrive as ISO strings. Declared here rather than imported from the server:
 * the client never imports server code.
 */
export interface CreatedObjectRecord {
  id: string;
  websiteId: string;
  /** The Create action that made it. */
  actionId: string;
  /** The version that ran. */
  actionScriptId: string;
  /** The run that made it. */
  actionScriptRunId: string;
  /** Its type (a web object's key), or null when the action had none. */
  objectTypeKey: string | null;
  /** That type's name when it was made, or null. */
  objectTypeName: string | null;
  /** The name the run typed. */
  name: string;
  /** Its own page, or null. */
  url: string | null;
  /** When the latest crawl that listed it ran, or null. */
  lastSeenAt: string | null;
  /** When a crawl first missed it (it is no longer a choice), or null. */
  notSeenSince: string | null;
  /** When a deleting run deleted it on the site, or null. */
  deletedOnSiteAt: string | null;
  /** That run's id, or null. */
  deletedByActionScriptRunId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** The action that made it - `deletedAt` set when it has since been deleted. */
  action: { id: string; title: string; deletedAt: string | null };
  /** The run that deleted it, or null. */
  deletedByActionScriptRun: {
    id: string;
    actionId: string;
    actionScriptId: string;
    createdAt: string;
    action: { title: string };
  } | null;
}

/** What `useCreatedObjects` hands back. */
export interface CreatedObjectsState {
  /** The record, newest first; null until it has loaded. */
  createdObjects: CreatedObjectRecord[] | null;
  /** True until the first list has arrived. */
  isLoading: boolean;
  /** Why the list could not be fetched, or null. */
  errorMessage: string | null;
  /**
   * Removes one object from the record (DELETE), then fetches the list again.
   * @param createdObjectId - The created object's cuid
   * @returns True when the server removed it
   */
  removeCreatedObject: (createdObjectId: string) => Promise<boolean>;
  /** True while a remove request is in flight. */
  isRemoving: boolean;
  /** Why the last remove failed, or null. */
  removeErrorMessage: string | null;
}

/**
 * Fetches a website's created objects (`GET /api/websites/:websiteId/created-objects`)
 * - the record of what its Create actions made - and removes one from the
 * record (`DELETE .../created-objects/:createdObjectId`), refetching after.
 * @param websiteId - The owning website's cuid
 * @returns The record, the request states, and the remove function
 */
export function useCreatedObjects(websiteId: string): CreatedObjectsState {
  const [createdObjects, setCreatedObjects] = useState<CreatedObjectRecord[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const { sendJsonRequest, isSubmitting, errorMessage: removeErrorMessage } = useJsonMutation();

  useEffect(() => {
    let cancelled = false;

    /**
     * Performs the GET and records its outcome.
     * @returns Resolves once the outcome is recorded (or discarded when cancelled)
     */
    const loadCreatedObjects = async (): Promise<void> => {
      try {
        const response = await fetch(createdObjectsApiUrl(websiteId));
        if (!response.ok) throw new Error(await readResponseErrorMessage(response));
        // The API is the contract for this shape; see useJsonResource.
        const loadedObjects = (await response.json()) as CreatedObjectRecord[];
        if (cancelled) return;
        setCreatedObjects(loadedObjects);
        setErrorMessage(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setErrorMessage(describeError(err));
      }
    };

    void loadCreatedObjects();
    return () => {
      cancelled = true;
    };
  }, [websiteId, reloadCount]);

  const removeCreatedObject = useCallback(
    async (createdObjectId: string): Promise<boolean> => {
      const result = await sendJsonRequest("DELETE", createdObjectApiUrl(websiteId, createdObjectId));
      if (result.succeeded) setReloadCount((previousCount) => previousCount + 1);
      return result.succeeded;
    },
    [sendJsonRequest, websiteId],
  );

  return {
    createdObjects,
    isLoading: createdObjects === null && errorMessage === null,
    errorMessage,
    removeCreatedObject,
    isRemoving: isSubmitting,
    removeErrorMessage,
  };
}
