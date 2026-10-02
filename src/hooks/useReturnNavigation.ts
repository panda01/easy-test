import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * The history state that links into a form or a detail page carry: the path
 * of the page the link was clicked on, i.e. the history entry directly
 * underneath the new one.
 */
export interface ReturnState {
  returnTo: string;
}

/**
 * Reads `returnTo` out of a history entry's state, which can be anything (or
 * nothing, after a deep link or a page reload of an entry without state).
 * @param locationState - `location.state` of the current history entry
 * @returns The `returnTo` path, or null when the state does not carry one
 */
function readReturnTo(locationState: unknown): string | null {
  if (
    typeof locationState === "object" &&
    locationState !== null &&
    "returnTo" in locationState &&
    typeof locationState.returnTo === "string"
  ) {
    return locationState.returnTo;
  }
  return null;
}

/**
 * Builds the `state` to put on a link so the page it opens knows which page
 * is underneath it in history. Pass it as `<Link to=... state={...}>`.
 * @returns `{ returnTo: <the current path> }`
 */
export function useReturnToHereState(): ReturnState {
  const location = useLocation();
  return { returnTo: location.pathname };
}

/**
 * Leaves a form or a just-deleted record's page without leaving a stale entry
 * in browser history, so Back and Forward keep making sense.
 *
 * `returnTo(targetPath)`: used by Cancel, by Save on an edit form, and after a
 * delete. When the entry underneath is exactly `targetPath` (the link that
 * opened this page said so via `ReturnState`), it goes BACK to that entry -
 * history stays `[..., target]` instead of growing a duplicate
 * `[..., target, target]`. Otherwise (deep link, reload without state) it
 * REPLACES the current entry with `targetPath`, so the form or deleted page is
 * still not left behind.
 *
 * `replaceKeepingReturnState(targetPath)`: used by Save on a create form. It
 * swaps the form's entry for the new record's page and carries the form's
 * `ReturnState` over, because the entry underneath has not changed - so a
 * later delete on that new page can still go back instead of duplicating.
 * @returns The two navigation functions described above
 */
export function useReturnNavigation(): {
  returnTo: (targetPath: string) => void;
  replaceKeepingReturnState: (targetPath: string) => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState: unknown = location.state;

  const returnTo = useCallback(
    /**
     * Goes back to `targetPath` when it is the entry underneath, otherwise
     * replaces the current entry with it.
     * @param targetPath - The page to end up on
     */
    (targetPath: string): void => {
      const entryUnderneathIsTarget = readReturnTo(locationState) === targetPath;
      if (entryUnderneathIsTarget) {
        void navigate(-1);
        return;
      }
      void navigate(targetPath, { replace: true });
    },
    [navigate, locationState],
  );

  const replaceKeepingReturnState = useCallback(
    /**
     * Replaces the current entry with `targetPath`, keeping this entry's state.
     * @param targetPath - The page to end up on
     */
    (targetPath: string): void => {
      void navigate(targetPath, { replace: true, state: locationState });
    },
    [navigate, locationState],
  );

  return { returnTo, replaceKeepingReturnState };
}
