import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";

/**
 * No test here starts a process or a browser. `spawn` returns a fake child
 * (an EventEmitter with stdout / stderr streams) that each test drives by
 * emitting output and `close`; `node:fs/promises` is replaced so nothing
 * touches the disk. Real runs are proven by the manual verification run.
 */
const { mockSpawn, mockMkdir, mockWriteFile, mockAccess } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockAccess: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mockSpawn }));
vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  access: mockAccess,
}));

import {
  SCRIPT_KILL_GRACE_MS,
  SCRIPT_OUTPUT_CHARACTER_LIMIT,
  SCRIPT_RUN_TIMEOUT_MS,
  runPlaywrightScript,
} from "../../../server/services/scriptRunnerService.js";

const RUN_DIRECTORY = "/project/action-scripts/website-1/run-1";
const SCRIPT_CODE = "import { chromium } from 'playwright';\n";
const CHILD_PROCESS_ID = 4242;

/** A stand-in for the ChildProcess `spawn` returns. */
class FakeChildProcess extends EventEmitter {
  pid: number | undefined = CHILD_PROCESS_ID;
  stdout = new PassThrough();
  stderr = new PassThrough();

  /**
   * Emits one chunk on stdout, the way a `data` listener receives it.
   * @param text - What the script printed
   */
  printToStdout(text: string): void {
    this.stdout.emit("data", text);
  }

  /**
   * Emits one chunk on stderr.
   * @param text - What the script printed
   */
  printToStderr(text: string): void {
    this.stderr.emit("data", text);
  }

  /**
   * Ends the process the way Node reports it once both streams are drained.
   * @param exitCode - The exit code, or null when killed by a signal
   * @param exitSignal - The signal, or null when it exited on its own
   */
  finish(exitCode: number | null, exitSignal: string | null = null): void {
    this.emit("close", exitCode, exitSignal);
  }
}

let fakeChild: FakeChildProcess;
let processKillSpy: ReturnType<typeof vi.spyOn>;

/**
 * Starts a run and waits until the fake child has been spawned, so the test
 * can drive it. The pending result is wrapped in an object: returning the bare
 * promise from an async function would make the caller's `await` wait for the
 * whole run, which never ends until the test drives the child.
 * @returns The pending run result, wrapped
 */
async function startRun(): Promise<{ runResult: ReturnType<typeof runPlaywrightScript> }> {
  const runResult = runPlaywrightScript(SCRIPT_CODE, RUN_DIRECTORY);
  // Let the mocked mkdir / writeFile settle WITHOUT moving the fake clock
  // (vi.waitFor would advance it, eating into the time limit under test).
  for (let microtaskTurn = 0; microtaskTurn < 20; microtaskTurn += 1) {
    const childWasSpawned = mockSpawn.mock.calls.length > 0;
    if (childWasSpawned) break;
    await Promise.resolve();
  }
  expect(mockSpawn).toHaveBeenCalled();
  return { runResult };
}

describe("runPlaywrightScript", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fakeChild = new FakeChildProcess();
    mockSpawn.mockReturnValue(fakeChild);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    // No failure.png unless a test says so.
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(4500.4);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes script.mjs into the run folder before starting node there with no environment", async () => {
    const { runResult } = await startRun();
    fakeChild.finish(0);
    await runResult;

    expect(mockMkdir).toHaveBeenCalledWith(RUN_DIRECTORY, { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(RUN_DIRECTORY, "script.mjs"),
      SCRIPT_CODE,
      "utf8",
    );
    expect(mockWriteFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockSpawn.mock.invocationCallOrder[0],
    );
    expect(mockSpawn).toHaveBeenCalledWith(process.execPath, ["script.mjs"], {
      cwd: RUN_DIRECTORY,
      env: {},
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("reports a clean exit with no failure screenshot as a pass, with the output in arrival order", async () => {
    const { runResult } = await startRun();
    fakeChild.printToStdout("▶ Open the site\n");
    fakeChild.printToStderr("warning: slow\n");
    fakeChild.printToStdout("✔ Use case completed\n");
    fakeChild.finish(0);

    expect(await runResult).toEqual({
      succeeded: true,
      exitCode: 0,
      exitSignal: null,
      timedOut: false,
      output: "▶ Open the site\nwarning: slow\n✔ Use case completed\n",
      outputWasTruncated: false,
      failureScreenshotWasCaptured: false,
      durationMs: 3500,
    });
    expect(mockAccess).toHaveBeenCalledWith(path.join(RUN_DIRECTORY, "failure.png"));
  });

  it("reports a non-zero exit as a failure", async () => {
    const { runResult } = await startRun();
    fakeChild.printToStderr("✘ Stopped: Timeout 10000ms exceeded.\n");
    fakeChild.finish(1);

    expect(await runResult).toMatchObject({ succeeded: false, exitCode: 1, timedOut: false });
  });

  it("reports a run that wrote failure.png as a failure even when it exited 0", async () => {
    mockAccess.mockResolvedValue(undefined);
    const { runResult } = await startRun();
    fakeChild.finish(0);

    expect(await runResult).toMatchObject({
      succeeded: false,
      exitCode: 0,
      failureScreenshotWasCaptured: true,
    });
  });

  it("keeps only the tail of very long output, marking what was dropped", async () => {
    const { runResult } = await startRun();
    fakeChild.printToStdout("x".repeat(SCRIPT_OUTPUT_CHARACTER_LIMIT));
    fakeChild.printToStdout("0123456789");
    fakeChild.finish(0);

    const { output, outputWasTruncated } = await runResult;
    expect(outputWasTruncated).toBe(true);
    expect(output.startsWith("[... 10 earlier characters dropped ...]\n")).toBe(true);
    expect(output.endsWith("x0123456789")).toBe(true);
    expect(output.length).toBe(
      SCRIPT_OUTPUT_CHARACTER_LIMIT + "[... 10 earlier characters dropped ...]\n".length,
    );
  });

  it("removes NUL characters, which Postgres text columns reject", async () => {
    const { runResult } = await startRun();
    fakeChild.printToStdout("a\u0000b");
    fakeChild.finish(0);

    expect((await runResult).output).toBe("ab");
  });

  it("stops a run at the time limit with SIGTERM to its process group, then SIGKILL after the grace period", async () => {
    const { runResult } = await startRun();

    await vi.advanceTimersByTimeAsync(SCRIPT_RUN_TIMEOUT_MS - 1);
    expect(processKillSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(processKillSpy).toHaveBeenCalledWith(-CHILD_PROCESS_ID, "SIGTERM");

    await vi.advanceTimersByTimeAsync(SCRIPT_KILL_GRACE_MS - 1);
    expect(processKillSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(processKillSpy).toHaveBeenLastCalledWith(-CHILD_PROCESS_ID, "SIGKILL");

    fakeChild.finish(null, "SIGKILL");
    expect(await runResult).toMatchObject({
      succeeded: false,
      timedOut: true,
      exitCode: null,
      exitSignal: "SIGKILL",
    });
  });

  it("does not SIGKILL a timed-out run that closes within the grace period", async () => {
    const { runResult } = await startRun();
    await vi.advanceTimersByTimeAsync(SCRIPT_RUN_TIMEOUT_MS);
    fakeChild.finish(null, "SIGTERM");
    const result = await runResult;

    await vi.advanceTimersByTimeAsync(SCRIPT_KILL_GRACE_MS * 2);

    expect(result).toMatchObject({ timedOut: true, exitSignal: "SIGTERM" });
    expect(processKillSpy).toHaveBeenCalledTimes(1);
    expect(processKillSpy).toHaveBeenCalledWith(-CHILD_PROCESS_ID, "SIGTERM");
  });

  it("clears the time limit when the run finishes first", async () => {
    const { runResult } = await startRun();
    fakeChild.finish(0);
    await runResult;

    await vi.advanceTimersByTimeAsync(SCRIPT_RUN_TIMEOUT_MS * 2);

    expect(processKillSpy).not.toHaveBeenCalled();
  });

  it("ignores a kill that fails because the process already exited", async () => {
    processKillSpy.mockImplementation(() => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    const { runResult } = await startRun();

    await vi.advanceTimersByTimeAsync(SCRIPT_RUN_TIMEOUT_MS + SCRIPT_KILL_GRACE_MS);
    fakeChild.finish(null, "SIGTERM");

    expect(await runResult).toMatchObject({ timedOut: true });
    expect(processKillSpy).toHaveBeenCalledTimes(2);
  });

  it("sends no signal when the process never got an id", async () => {
    fakeChild.pid = undefined;
    const { runResult } = await startRun();

    await vi.advanceTimersByTimeAsync(SCRIPT_RUN_TIMEOUT_MS + SCRIPT_KILL_GRACE_MS);
    fakeChild.finish(null, "SIGTERM");
    await runResult;

    expect(processKillSpy).not.toHaveBeenCalled();
  });

  it("rejects when node cannot be started, and stops the time limit", async () => {
    const { runResult } = await startRun();
    fakeChild.emit("error", new Error("spawn ENOENT"));

    await expect(runResult).rejects.toThrow("spawn ENOENT");
    await vi.advanceTimersByTimeAsync(SCRIPT_RUN_TIMEOUT_MS * 2);
    expect(processKillSpy).not.toHaveBeenCalled();
  });

  it("rejects without starting anything when the run folder cannot be created", async () => {
    mockMkdir.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(runPlaywrightScript(SCRIPT_CODE, RUN_DIRECTORY)).rejects.toThrow(
      "EACCES: permission denied",
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
