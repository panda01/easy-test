import { describe, it, expect } from "vitest";
import { findVersionNumberOfScriptId } from "../../src/utils/findVersionNumberOfScriptId";
import { buildActionScriptRecord } from "./support/frontendTestHelpers";

/** Three versions, newest first, as the version list arrives. */
const SCRIPTS_NEWEST_FIRST = [
  buildActionScriptRecord({ id: "script-3" }),
  buildActionScriptRecord({ id: "script-2" }),
  buildActionScriptRecord({ id: "script-1" }),
];

describe("findVersionNumberOfScriptId", () => {
  it("numbers versions oldest first from a newest-first list", () => {
    expect(findVersionNumberOfScriptId(SCRIPTS_NEWEST_FIRST, "script-3")).toBe(3);
    expect(findVersionNumberOfScriptId(SCRIPTS_NEWEST_FIRST, "script-1")).toBe(1);
  });

  it("gives no number when there is no id, or the version is no longer listed", () => {
    expect(findVersionNumberOfScriptId(SCRIPTS_NEWEST_FIRST, null)).toBeNull();
    expect(findVersionNumberOfScriptId(SCRIPTS_NEWEST_FIRST, "deleted-script")).toBeNull();
  });
});
