import { describe, it, expect } from "vitest";
import { formatCount } from "../../src/utils/formatCount";

describe("formatCount", () => {
  it("uses the plural noun for zero", () => {
    expect(formatCount(0, "use case", "use cases")).toBe("0 use cases");
  });

  it("uses the singular noun for exactly one", () => {
    expect(formatCount(1, "use case", "use cases")).toBe("1 use case");
  });

  it("uses the plural noun for more than one", () => {
    expect(formatCount(2, "action", "actions")).toBe("2 actions");
    expect(formatCount(37, "action", "actions")).toBe("37 actions");
  });
});
