import { describe, it, expect } from "vitest";
import { classifyPathSegment } from "../../../server/utils/classifyPathSegment.js";

describe("classifyPathSegment", () => {
  it.each([
    { segment: "3f2b9c1e-8d4a-4e6f-9b0c-1a2b3c4d5e6f", shape: "uuid" },
    { segment: "3F2B9C1E-8D4A-4E6F-9B0C-1A2B3C4D5E6F", shape: "uuid" },
    { segment: "42", shape: "number" },
    { segment: "20261016", shape: "number" },
    { segment: "01ARZ3NDEKTSV4RRFFQ69G5FAV", shape: "ulid" },
    { segment: "cmurhdofb000c93uhb9b32qka", shape: "cuid" },
    { segment: "clh3am8tq0000qwer1234abcd", shape: "cuid" },
    { segment: "tz4a98xxat96iws9zmbrgj3a", shape: "opaqueToken" },
    { segment: "507f1f77bcf86cd799439011", shape: "hex" },
    { segment: "9fceb02d0ae598e95dc970b74767f19372d61af8", shape: "hex" },
    { segment: "V1StGXR8_Z5jdHi6B-myT", shape: "opaqueToken" },
    { segment: "aZ3kq9WmP0xL7tRb", shape: "opaqueToken" },
  ])("recognises $segment as a $shape id", ({ segment, shape }) => {
    expect(classifyPathSegment(segment)).toBe(shape);
  });

  it.each([
    "websites",
    "edit",
    "new",
    "my-first-post",
    "2024-report",
    "v2",
    "page-12",
    "deadbeef",
    "crawl-runs",
    "release-notes-for-version-2024",
    "characteristicallyabcdefghij",
    "",
  ])("treats %j as a static segment, not an id", (segment) => {
    expect(classifyPathSegment(segment)).toBeNull();
  });
});
