import { useEffect, useState } from "react";
import { type JsonResourceState } from "./useJsonResource";
import { describeError, readResponseErrorMessage } from "../utils/describeError";

/** What `usePolledJsonResource` hands back: a `JsonResourceState` plus re-poll trouble. */
export interface PolledJsonResourceState<TData> extends JsonResourceState<TData> {
  /**
   * Why the latest RE-poll failed, while the last good `data` stays shown and
   * polling carries on; null when the latest poll succeeded. (A failed FIRST
   * load is `errorMessage`, as in `useJsonResource`.)
   */
  pollErrorMessage: string | null;
}

/** What the last finished poll produced, remembered with the url it was for. */
interface FinishedPoll {
  resourceUrl: string;
  data: unknown;
  errorMessage: string | null;
  pollErrorMessage: string | null;
}

/**
 * Builds what a failed poll leaves behind. A failed RE-poll keeps the last
 * good data for the same url and only records why it failed, so a brief
 * outage (e.g. the dev server restarting) does not blank the page or stop
 * the polling. A failed first load has no data to keep.
 * @param previousPoll - The poll before this one, or null
 * @param resourceUrl - The url this poll was for
 * @param failureMessage - Why this poll failed
 * @returns The poll result to store
 */
function buildFailedPoll(
  previousPoll: FinishedPoll | null,
  resourceUrl: string,
  failureMessage: string,
): FinishedPoll {
  const previousPollHasDataForThisUrl =
    previousPoll !== null && previousPoll.resourceUrl === resourceUrl && previousPoll.data !== null;
  if (previousPollHasDataForThisUrl) {
    return { ...previousPoll, pollErrorMessage: failureMessage };
  }
  return { resourceUrl, data: null, errorMessage: failureMessage, pollErrorMessage: null };
}

/**
 * Like `useJsonResource`, but GETs the url again every `pollIntervalMs` for
 * as long as `keepPolling(data)` says so - e.g. while a crawl is running.
 *
 * Re-polls replace `data` in place: `isLoading` is only true until the FIRST
 * response for the current url, so the page never flashes a spinner. Each
 * poll is scheduled only after the previous one finished (no overlapping
 * requests), and the timer is cleared on unmount or url change. A failed
 * re-poll keeps the last good data and keeps polling (see
 * `pollErrorMessage`). Polling stops for good once `keepPolling` returns
 * false, or when the first load fails.
 *
 * `keepPolling` is read on every render rather than being an effect
 * dependency, so callers may pass an inline function.
 * @param resourceUrl - Relative API url to GET; null to stay idle
 * @param keepPolling - Given the latest data, whether to fetch again
 * @param pollIntervalMs - How long to wait after each response before the next GET
 * @returns The loading / error / data state for that url, plus `pollErrorMessage`
 */
export function usePolledJsonResource(
  resourceUrl: string | null,
  keepPolling: (data: unknown) => boolean,
  pollIntervalMs: number,
): PolledJsonResourceState<unknown> {
  const [finishedPoll, setFinishedPoll] = useState<FinishedPoll | null>(null);
  const [pollNumber, setPollNumber] = useState(0);

  useEffect(() => {
    const thereIsNothingToFetch = resourceUrl === null;
    if (thereIsNothingToFetch) return;
    let cancelled = false;

    /**
     * Performs one GET and records its outcome for `resourceUrl`.
     * @returns Resolves once the outcome is recorded (or discarded when cancelled)
     */
    const pollResource = async (): Promise<void> => {
      try {
        const response = await fetch(resourceUrl);
        const responseIsOk = response.ok;
        if (!responseIsOk) {
          throw new Error(await readResponseErrorMessage(response));
        }
        const data: unknown = await response.json();
        if (cancelled) return;
        setFinishedPoll({ resourceUrl, data, errorMessage: null, pollErrorMessage: null });
      } catch (err: unknown) {
        if (cancelled) return;
        const failureMessage = describeError(err);
        setFinishedPoll((previousPoll) =>
          buildFailedPoll(previousPoll, resourceUrl, failureMessage),
        );
      }
    };

    void pollResource();

    return () => {
      cancelled = true;
    };
  }, [resourceUrl, pollNumber]);

  const finishedPollIsForCurrentUrl =
    finishedPoll !== null && resourceUrl !== null && finishedPoll.resourceUrl === resourceUrl;
  const currentData = finishedPollIsForCurrentUrl ? finishedPoll.data : null;
  const shouldPollAgain = currentData !== null && keepPolling(currentData);

  useEffect(() => {
    if (!shouldPollAgain) return;
    const pollTimeoutId = setTimeout(() => {
      setPollNumber((previousPollNumber) => previousPollNumber + 1);
    }, pollIntervalMs);
    return () => {
      clearTimeout(pollTimeoutId);
    };
    // `finishedPoll` is a dependency so every finished poll schedules the next.
  }, [shouldPollAgain, finishedPoll, pollIntervalMs]);

  const hookIsIdle = resourceUrl === null;
  if (hookIsIdle) {
    return { data: null, isLoading: false, errorMessage: null, pollErrorMessage: null };
  }
  if (!finishedPollIsForCurrentUrl) {
    return { data: null, isLoading: true, errorMessage: null, pollErrorMessage: null };
  }
  return {
    data: finishedPoll.data,
    isLoading: false,
    errorMessage: finishedPoll.errorMessage,
    pollErrorMessage: finishedPoll.pollErrorMessage,
  };
}
