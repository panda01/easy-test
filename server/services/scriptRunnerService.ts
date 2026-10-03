import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** How long a run may take before it is stopped: 5 minutes (the user's choice). */
export const SCRIPT_RUN_TIMEOUT_MS = 300_000;

/**
 * How long a run gets to close after SIGTERM before it is SIGKILLed. SIGTERM
 * lets Playwright's own handler close the browser (no orphaned Chromium);
 * SIGKILL is the backstop for a script that ignores it.
 */
export const SCRIPT_KILL_GRACE_MS = 5_000;

/**
 * The most output a run keeps, in characters. When a run prints more, the
 * EARLY part is dropped, because the end holds the error and the last steps.
 */
export const SCRIPT_OUTPUT_CHARACTER_LIMIT = 200_000;

/** The name the script is saved under inside its run folder. */
export const SCRIPT_FILE_NAME = "script.mjs";

/**
 * The file the guidelines' template writes from its `catch` block, relative
 * to the working directory - which is the run folder.
 */
export const FAILURE_SCREENSHOT_FILE_NAME = "failure.png";

/** What one script run produced. */
export interface ScriptRunResult {
  /** True only for exit code 0, no timeout, and no failure screenshot. */
  succeeded: boolean;
  /** The process exit code, or null when it was killed by a signal. */
  exitCode: number | null;
  /** The signal that ended the process, or null when it exited on its own. */
  exitSignal: string | null;
  /** True when the run hit `SCRIPT_RUN_TIMEOUT_MS` and was stopped. */
  timedOut: boolean;
  /** Combined stdout + stderr in arrival order, capped to the tail. */
  output: string;
  /** True when the cap dropped the start of the output. */
  outputWasTruncated: boolean;
  /** True when the script wrote `failure.png` into its run folder. */
  failureScreenshotWasCaptured: boolean;
  /** Milliseconds from process start to process end. */
  durationMs: number;
}

/**
 * Collects a run's stdout and stderr into one string in arrival order,
 * keeping only the last `SCRIPT_OUTPUT_CHARACTER_LIMIT` characters.
 */
class RunOutputCollector {
  private collected = "";
  private droppedCharacterCount = 0;

  /**
   * Appends one chunk of output, dropping the oldest characters past the cap.
   * NUL characters are removed because Postgres text columns reject them.
   * @param chunk - Text the process printed
   */
  append(chunk: string): void {
    this.collected += chunk.replaceAll("\u0000", "");
    const overflowCharacterCount = this.collected.length - SCRIPT_OUTPUT_CHARACTER_LIMIT;
    const outputIsOverTheCap = overflowCharacterCount > 0;
    if (outputIsOverTheCap) {
      this.collected = this.collected.slice(overflowCharacterCount);
      this.droppedCharacterCount += overflowCharacterCount;
    }
  }

  /**
   * The collected output, prefixed with a marker when the cap dropped some.
   * @returns The output text and whether anything was dropped
   */
  finish(): { output: string; outputWasTruncated: boolean } {
    const outputWasTruncated = this.droppedCharacterCount > 0;
    const output = outputWasTruncated
      ? `[... ${this.droppedCharacterCount} earlier characters dropped ...]\n${this.collected}`
      : this.collected;
    return { output, outputWasTruncated };
  }
}

/**
 * Sends a signal to the run's whole process group (the script was spawned
 * `detached`, so it leads its own group). Errors are ignored: the usual one
 * is ESRCH, meaning the process already exited.
 * @param childProcess - The running script
 * @param signal - "SIGTERM" first, then "SIGKILL"
 */
function signalProcessGroup(childProcess: ChildProcess, signal: NodeJS.Signals): void {
  const processId = childProcess.pid;
  const processHasNoId = processId === undefined;
  if (processHasNoId) return;
  try {
    process.kill(-processId, signal);
  } catch {
    // Already gone - nothing to stop.
  }
}

/**
 * Checks whether a file exists.
 * @param filePath - Absolute path to check
 * @returns True when the file can be accessed
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs a stored Playwright script with plain `node`, exactly as the user would
 * with `node script.mjs`, and reports what happened. The script opens its own
 * (visible) browser window on this machine.
 *
 * - The code is written to `<runDirectory>/script.mjs` and run with that
 *   folder as the working directory, so the template's `failure.png` lands
 *   next to it. `mkdir` and `writeFile` happen before anything is spawned, so
 *   a bad directory rejects with nothing running.
 * - The process gets NO environment variables (`env: {}`): generated code
 *   never sees secrets such as ANTHROPIC_API_KEY or DATABASE_URL. Node and
 *   Playwright still find the home folder (where Chromium is installed) and
 *   `/tmp` without them.
 * - After `SCRIPT_RUN_TIMEOUT_MS` the process group gets SIGTERM (Playwright
 *   closes the browser, which also ends a waiting `page.pause()`), then
 *   SIGKILL if it is still alive `SCRIPT_KILL_GRACE_MS` later.
 *
 * Script-agnostic on purpose, so future use-case scripts can reuse it.
 * @param code - The complete `.mjs` source to run
 * @param runDirectory - Absolute path of this run's own (new) folder
 * @returns The exit details, output, and whether a failure screenshot was written
 * @throws When the folder or file cannot be written, or the process cannot be started
 */
export async function runPlaywrightScript(
  code: string,
  runDirectory: string,
): Promise<ScriptRunResult> {
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, SCRIPT_FILE_NAME), code, "utf8");

  const startedAt = performance.now();
  const outputCollector = new RunOutputCollector();
  // Kept on an object because the timers below change it from inside
  // callbacks; a plain `let` would be narrowed to its initial value.
  const timeLimit: { wasHit: boolean; killTimer: NodeJS.Timeout | undefined } = {
    wasHit: false,
    killTimer: undefined,
  };

  const childProcess = spawn(process.execPath, [SCRIPT_FILE_NAME], {
    cwd: runDirectory,
    env: {},
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  /**
   * Collects one chunk of stdout or stderr.
   * @param chunk - Text the process printed
   */
  const collectOutput = (chunk: string): void => {
    outputCollector.append(chunk);
  };
  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", collectOutput);
  childProcess.stderr.on("data", collectOutput);

  /** Last resort for a run that ignored SIGTERM. */
  const killRun = (): void => {
    signalProcessGroup(childProcess, "SIGKILL");
  };

  /** Stops a run that hit the time limit: SIGTERM now, SIGKILL after the grace period. */
  const stopTimedOutRun = (): void => {
    timeLimit.wasHit = true;
    signalProcessGroup(childProcess, "SIGTERM");
    timeLimit.killTimer = setTimeout(killRun, SCRIPT_KILL_GRACE_MS);
  };
  const timeoutTimer = setTimeout(stopTimedOutRun, SCRIPT_RUN_TIMEOUT_MS);

  /**
   * Waits for the process to end. Resolves on `close` (not `exit`) so both
   * output streams have been fully read; rejects when it could not start.
   * @param resolve - Receives the exit code and signal
   * @param reject - Receives the spawn error
   */
  const waitForClose = (
    resolve: (exit: { exitCode: number | null; exitSignal: string | null }) => void,
    reject: (error: Error) => void,
  ): void => {
    childProcess.once("error", reject);
    childProcess.once("close", (exitCode: number | null, exitSignal: NodeJS.Signals | null) => {
      resolve({ exitCode, exitSignal });
    });
  };

  try {
    const { exitCode, exitSignal } = await new Promise(waitForClose);
    const durationMs = Math.round(performance.now() - startedAt);
    const failureScreenshotWasCaptured = await fileExists(
      path.join(runDirectory, FAILURE_SCREENSHOT_FILE_NAME),
    );
    const { output, outputWasTruncated } = outputCollector.finish();

    // Exit code alone is not enough: a script can catch its own error and
    // still exit 0, but the template only writes failure.png when it failed.
    const processExitedCleanly = exitCode === 0;
    const timedOut = timeLimit.wasHit;
    const succeeded = processExitedCleanly && !timedOut && !failureScreenshotWasCaptured;

    return {
      succeeded,
      exitCode,
      exitSignal,
      timedOut,
      output,
      outputWasTruncated,
      failureScreenshotWasCaptured,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(timeLimit.killTimer);
  }
}
