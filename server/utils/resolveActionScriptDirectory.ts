import path from "node:path";
import { resolveConfiguredDirectory } from "./resolveConfiguredDirectory.js";

/**
 * Resolves the directory script runs are written to, from `ACTION_SCRIPT_DIR`.
 * Each run gets its own folder in it holding `script.mjs` and, when the script
 * fails, `failure.png`.
 *
 * Same rules as `resolveConfiguredDirectory` (required; relative values
 * resolve against the project root), plus one more: the directory must sit
 * INSIDE the project root. Generated scripts `import { chromium } from
 * 'playwright'`, and Node resolves that bare import by walking up from the
 * script file's own folder looking for `node_modules/playwright` - so a
 * script written outside the project could not find Playwright at all.
 * `NODE_PATH` does not help: ES modules ignore it.
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
