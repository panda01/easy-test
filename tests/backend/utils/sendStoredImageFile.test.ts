import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import { sendStoredImageFile } from "../../../server/utils/sendStoredImageFile.js";

/** A stand-in response whose `sendFile` hands its callback `sendError`. */
interface FakeResponse {
  headersSent: boolean;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  sendFile: ReturnType<typeof vi.fn>;
}

/**
 * Builds a fake response whose `sendFile` finishes with the given outcome.
 * @param sendError - What `sendFile` reports to its callback (undefined when the file was sent)
 * @param headersSent - Whether the response had already started
 * @returns The fake response
 */
function buildFakeResponse(sendError: Error | undefined, headersSent = false): FakeResponse {
  const fakeResponse: FakeResponse = {
    headersSent,
    status: vi.fn(),
    json: vi.fn(),
    sendFile: vi.fn((_name: string, _options: unknown, callback: (error?: Error) => void) => {
      callback(sendError);
    }),
  };
  fakeResponse.status.mockReturnValue(fakeResponse);
  return fakeResponse;
}

/**
 * Builds the error express's `send` reports, with the status it stamps on it.
 * @param message - The error's message
 * @param status - The attached HTTP status
 * @returns The error
 */
function buildSendError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

describe("sendStoredImageFile", () => {
  it("sends the stored name from inside the root directory and answers nothing more when it was sent", () => {
    const fakeResponse = buildFakeResponse(undefined);

    sendStoredImageFile(fakeResponse as unknown as Response, "website-1/run/step-001.png", "/srv/action-scripts", "gone");

    expect(fakeResponse.sendFile).toHaveBeenCalledWith(
      "website-1/run/step-001.png",
      { root: "/srv/action-scripts" },
      expect.any(Function),
    );
    expect(fakeResponse.status).not.toHaveBeenCalled();
  });

  it("answers 404 with the given message when the file is gone from disk", () => {
    const fakeResponse = buildFakeResponse(buildSendError("ENOENT", 404));

    sendStoredImageFile(fakeResponse as unknown as Response, "a.png", "/srv", "Step screenshot file not found");

    expect(fakeResponse.status).toHaveBeenCalledWith(404);
    expect(fakeResponse.json).toHaveBeenCalledWith({ error: "Step screenshot file not found" });
  });

  it("answers 500 with the send error otherwise", () => {
    const fakeResponse = buildFakeResponse(buildSendError("Forbidden", 403));

    sendStoredImageFile(fakeResponse as unknown as Response, "../a.png", "/srv", "gone");

    expect(fakeResponse.status).toHaveBeenCalledWith(500);
    expect(fakeResponse.json).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  it("writes nothing when the response had already started (the client went away mid-stream)", () => {
    const fakeResponse = buildFakeResponse(buildSendError("ECONNABORTED", 500), true);

    sendStoredImageFile(fakeResponse as unknown as Response, "a.png", "/srv", "gone");

    expect(fakeResponse.status).not.toHaveBeenCalled();
    expect(fakeResponse.json).not.toHaveBeenCalled();
  });
});
