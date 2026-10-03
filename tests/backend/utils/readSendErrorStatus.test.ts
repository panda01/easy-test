import { describe, it, expect } from "vitest";
import { readSendErrorStatus } from "../../../server/utils/readSendErrorStatus.js";

describe("readSendErrorStatus", () => {
  it("returns the numeric status send attached to the error", () => {
    expect(readSendErrorStatus(Object.assign(new Error("Not Found"), { status: 404 }))).toBe(404);
  });

  it("returns null when the error carries no status", () => {
    expect(readSendErrorStatus(new Error("EISDIR, read"))).toBeNull();
  });

  it("returns null when the attached status is not a number", () => {
    expect(readSendErrorStatus(Object.assign(new Error("odd"), { status: "404" }))).toBeNull();
  });
});
