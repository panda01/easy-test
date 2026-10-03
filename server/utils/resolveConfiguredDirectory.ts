import path from "node:path";

/**
 * Resolves a directory setting from the environment variable it names: the
 * shared rule behind `SCREENSHOT_DIR` and `ACTION_SCRIPT_DIR`.
 *
 * A relative value is resolved against `process.cwd()` - the same project
 * root `../bootEnv.ts` loads `.env` from - so `SCREENSHOT_DIR=screenshots`
 * means `<repo>/screenshots`. An absolute value is returned normalized. `~` is
 * NOT expanded; use an absolute path instead.
 *
 * Deliberately a hard failure rather than a default, mirroring
 * `resolveServerPort`: a missing setting surfaces as a one-line startup error
 * instead of files silently landing somewhere unexpected.
 *
 * Pure: it only reads the environment and does path math. Creating the
 * directory is the job of whichever service writes into it.
 * @param environmentVariableName - The variable holding the directory, e.g. "SCREENSHOT_DIR"
 * @returns The absolute path of the directory
 * @throws {Error} When the variable is unset, empty, or only whitespace
 */
export function resolveConfiguredDirectory(environmentVariableName: string): string {
  const rawDirectory = process.env[environmentVariableName]?.trim();
  const directoryIsMissing = rawDirectory === undefined || rawDirectory === "";
  if (directoryIsMissing) {
    throw new Error(`${environmentVariableName} is not defined in environment variables`);
  }

  return path.resolve(process.cwd(), rawDirectory);
}
