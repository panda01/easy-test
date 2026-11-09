import { type ActionScriptRecord } from "../hooks/useActionScripts";

/**
 * Finds the version number of a listed version by its id: versions are
 * numbered 1, 2, 3 ... oldest first, and the list arrives newest first. Used
 * for the version another one was edited or refined from, and for the
 * version a run page's run ran.
 * @param scripts - Every version, newest first
 * @param scriptId - The version's id, or null when there is none
 * @returns Its version number, or null when there is no id or it is no longer listed
 */
export function findVersionNumberOfScriptId(scripts: ActionScriptRecord[], scriptId: string | null): number | null {
  const thereIsNoVersionId = scriptId === null;
  if (thereIsNoVersionId) return null;
  const versionIndex = scripts.findIndex((listedScript) => listedScript.id === scriptId);
  const versionIsNoLongerListed = versionIndex === -1;
  return versionIsNoLongerListed ? null : scripts.length - versionIndex;
}
