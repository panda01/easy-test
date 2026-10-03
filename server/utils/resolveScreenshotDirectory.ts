import { resolveConfiguredDirectory } from "./resolveConfiguredDirectory.js";

/**
 * Resolves the directory screenshot PNGs are written to and served from, from
 * `SCREENSHOT_DIR`.
 *
 * A relative value is resolved against `process.cwd()` - the same project
 * root `../bootEnv.ts` loads `.env` from - so the committed default
 * `SCREENSHOT_DIR=screenshots` means `<repo>/screenshots`. An absolute value
 * is returned normalized. `~` is NOT expanded; use an absolute path instead.
 * The shared rule lives in `resolveConfiguredDirectory`.
 *
 * Deliberately a hard failure rather than a default, mirroring
 * `resolveServerPort`: a missing setting surfaces as a one-line startup error
 * instead of screenshots silently landing somewhere unexpected.
 *
 * Pure: it only reads the environment and does path math. Creating the
 * directory is the Playwright service's job, right before it writes a file.
 * @returns The absolute path of the screenshot directory
 * @throws {Error} When `SCREENSHOT_DIR` is unset, empty, or only whitespace
 */
export function resolveScreenshotDirectory(): string {
  return resolveConfiguredDirectory("SCREENSHOT_DIR");
}
