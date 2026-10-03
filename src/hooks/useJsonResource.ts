import { useEffect, useState } from "react";
import { describeError, readResponseErrorMessage } from "../utils/describeError";

/**
 * The three flat values a page needs to render a GET request: loading,
 * failed, or loaded. Exactly one of `isLoading`, `errorMessage !== null`, or
 * `data !== null` describes the current state - except while idle (a null
 * url), when all three are empty.
 */
export interface JsonResourceState<TData> {
  /** The parsed response body; null while loading and after a failure. */
  data: TData | null;
  /** True until the response for the CURRENT url has arrived. */
  isLoading: boolean;
  /** The failure reason (the server's `{ error }` text when present); null otherwise. */
  errorMessage: string | null;
}

/** What the last finished request produced, remembered with the url it was for. */
interface FinishedRequest {
  resourceUrl: string;
  data: unknown;
  errorMessage: string | null;
}

/**
 * Fetches `GET <resourceUrl>` on mount and again whenever the url changes, and
 * exposes the result as three flat values (see `JsonResourceState`).
 *
 * The finished result is stored together with the url it belongs to, and is
 * only reported while that url is still the current one. So when the url
 * changes - e.g. browser Back/Forward between two websites that render the same
 * page component - the hook reports loading instead of showing the previous
 * website's data for a moment.
 *
 * `data` is `unknown` on purpose: the typed wrappers in `useWebsites.ts` and
 * `useWebsiteItems.ts` name the response shape, so this hook stays generic
 * without a type parameter that would only appear in its return type.
 *
 * The `cancelled` flag stops a response that resolves after unmount, or after
 * the url has changed again, from calling setState.
 *
 * A null url means "nothing to fetch yet" (e.g. the runs of a script that
 * does not exist yet): the hook stays idle - no request, not loading, no data,
 * no error - so a page can call it unconditionally.
 * @param resourceUrl - Relative API url to GET, e.g. `/api/websites`; null to stay idle
 * @returns The loading / error / data state for that url
 */
export function useJsonResource(resourceUrl: string | null): JsonResourceState<unknown> {
  const [finishedRequest, setFinishedRequest] = useState<FinishedRequest | null>(null);

  useEffect(() => {
    const thereIsNothingToFetch = resourceUrl === null;
    if (thereIsNothingToFetch) return;
    let cancelled = false;

    /**
     * Performs the GET and records its outcome for `resourceUrl`.
     * @returns Resolves once the outcome is recorded (or discarded when cancelled)
     */
    const loadResource = async (): Promise<void> => {
      try {
        const response = await fetch(resourceUrl);
        const responseIsOk = response.ok;
        if (!responseIsOk) {
          throw new Error(await readResponseErrorMessage(response));
        }
        const data: unknown = await response.json();
        if (cancelled) return;
        setFinishedRequest({ resourceUrl, data, errorMessage: null });
      } catch (err: unknown) {
        if (cancelled) return;
        setFinishedRequest({ resourceUrl, data: null, errorMessage: describeError(err) });
      }
    };

    void loadResource();

    return () => {
      cancelled = true;
    };
  }, [resourceUrl]);

  const hookIsIdle = resourceUrl === null;
  if (hookIsIdle) {
    return { data: null, isLoading: false, errorMessage: null };
  }
  const finishedRequestIsForCurrentUrl = finishedRequest?.resourceUrl === resourceUrl;
  if (finishedRequest === null || !finishedRequestIsForCurrentUrl) {
    return { data: null, isLoading: true, errorMessage: null };
  }
  return {
    data: finishedRequest.data,
    isLoading: false,
    errorMessage: finishedRequest.errorMessage,
  };
}
