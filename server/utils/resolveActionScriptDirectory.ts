import path from "node:path";
import { resolveConfiguredDirectory } from "./resolveConfiguredDirectory.js";

/**
 * Resolves the directory plan runs are written to, from `ACTION_SCRIPT_DIR`.
 * Each run gets its own folder in it holding, when the run fails,
 * `failure.png`; "Upload file" steps pick their files from its `uploads/`
 * folder.
 *
 * Same rules as `resolveConfiguredDirectory` (required; relative values
 * resolve against the project root), plus one more: the directory must sit
 * INSIDE the project root. That rule dates from generated `.mjs` scripts,
 * which imported `playwright` from this project's `node_modules`; it is kept
 * so run files and the uploads folder stay inside the project.
 *
 * Pure: it only reads the environment and does path math.
 * @returns The absolute path of the action script directory
 * @throws {Error} When `ACTION_SCRIPT_DIR` is unset, empty, the project root itself, or outside the project root
 */
export function resolveActionScriptDirectory(): string {
  const actionScriptDirectory = resolveConfiguredDirectory("ACTION_SCRIPT_DIR");
  const projectRoot = process.cwd();
  const pathFromProjectRoot = path.relative(projectRoot, actionScriptDirectory);

  const directoryIsTheProjectRoot = pathFromProjectRoot === "";
  // A leading ".." SEGMENT means outside; a folder merely named "..runs" is inside.
  const firstSegmentIsParent =
    pathFromProjectRoot === ".." || pathFromProjectRoot.startsWith(`..${path.sep}`);
  const directoryClimbsOutOfTheProject =
    firstSegmentIsParent || path.isAbsolute(pathFromProjectRoot);
  const directoryIsInsideTheProject =
    !directoryIsTheProjectRoot && !directoryClimbsOutOfTheProject;
  if (!directoryIsInsideTheProject) {
    throw new Error(
      `ACTION_SCRIPT_DIR must be a folder inside the project (${projectRoot}), because generated scripts import 'playwright' from the project's node_modules; got ${actionScriptDirectory}`,
    );
  }

  return actionScriptDirectory;
}
