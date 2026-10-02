import { describe, it, expect } from "vitest";
import { describeError, readResponseErrorMessage } from "../../src/utils/describeError";
import { buildJsonResponse, buildUnparseableResponse } from "./support/frontendTestHelpers";

describe("describeError", () => {
  it("returns an Error's message", () => {
    expect(describeError(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("returns the message of an Error subclass", () => {
    expect(describeError(new TypeError("NetworkError when attempting to fetch"))).toBe(
      "NetworkError when attempting to fetch",
    );
  });

  it("returns a thrown string unchanged", () => {
    expect(describeError("socket hang up")).toBe("socket hang up");
  });

  it.each([
    { thrownValue: 42, expectedText: "42" },
    { thrownValue: undefined, expectedText: "undefined" },
    { thrownValue: null, expectedText: "null" },
    { thrownValue: { code: "E_FAIL" }, expectedText: "[object Object]" },
  ])("stringifies a non-Error value ($expectedText)", ({ thrownValue, expectedText }) => {
    expect(describeError(thrownValue)).toBe(expectedText);
  });
});

describe("readResponseErrorMessage", () => {
  it("returns the server's { error } text", async () => {
    const response = buildJsonResponse(404, { error: "Website not found" });
    await expect(readResponseErrorMessage(response)).resolves.toBe("Website not found");
  });

  it("falls back to the status when the body has no error field", async () => {
    const response = buildJsonResponse(500, { message: "Internal" });
    await expect(readResponseErrorMessage(response)).resolves.toBe("Server responded with 500");
  });

  it("falls back to the status when the error field is not a string", async () => {
    const response = buildJsonResponse(422, { error: { field: "url" } });
    await expect(readResponseErrorMessage(response)).resolves.toBe("Server responded with 422");
  });

  it("falls back to the status when the body is JSON null", async () => {
    const response = buildJsonResponse(400, null);
    await expect(readResponseErrorMessage(response)).resolves.toBe("Server responded with 400");
  });

  it("falls back to the status when the body is a bare JSON string", async () => {
    const response = buildJsonResponse(400, "Bad request");
    await expect(readResponseErrorMessage(response)).resolves.toBe("Server responded with 400");
  });

  it("falls back to the status when the body is not JSON at all", async () => {
    const response = buildUnparseableResponse(502);
    await expect(readResponseErrorMessage(response)).resolves.toBe("Server responded with 502");
  });
});
