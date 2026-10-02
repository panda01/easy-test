import { describe, it, expect } from "vitest";
import { describeError } from "../../../server/utils/describeError.js";

describe("describeError", () => {
  it("returns the message of an Error", () => {
    expect(describeError(new Error("connection refused"))).toBe("connection refused");
  });

  it("returns the message of an Error subclass", () => {
    expect(describeError(new TypeError("not a function"))).toBe("not a function");
  });

  it("returns a thrown string unchanged", () => {
    expect(describeError("database offline")).toBe("database offline");
  });

  it("stringifies a thrown plain object instead of reading a message from it", () => {
    expect(describeError({ message: "looks like an error but is not one" })).toBe(
      "[object Object]",
    );
  });

  it("stringifies a thrown number", () => {
    expect(describeError(42)).toBe("42");
  });

  it("stringifies a thrown undefined", () => {
    expect(describeError(undefined)).toBe("undefined");
  });

  it("stringifies a thrown null", () => {
    expect(describeError(null)).toBe("null");
  });
});
