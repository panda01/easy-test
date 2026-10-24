import { describe, it, expect } from "vitest";
import {
  buildInitialParameterValues,
  buildStepParameterTags,
  describeParameterRequirement,
  describeParameterSource,
  describeParameterSteps,
  findParameterValueProblem,
  listChangedParameterValues,
  listParametersToFix,
  readUsedParameterValues,
} from "../../src/utils/actionParameters";
import {
  describeConfidence,
  describeDetectedDeletesChoice,
  describeDetectedKindChoice,
  describeDetectedObjectTypeChoice,
  describeObjectRole,
} from "../../src/utils/actionObjectRole";
import {
  buildActionObjectRoleRecord,
  buildVersionParameterRecord,
  buildVersionParametersRecord,
} from "./support/frontendTestHelpers";

const nameParameter = buildVersionParameterRecord();
const notesParameter = buildVersionParameterRecord({
  key: "notes",
  label: "Notes",
  source: "page",
  isRequired: false,
  defaultValue: "",
  uses: [],
  addedField: { target: { label: "Notes" }, stepAction: "fill", afterStepNumber: 1 },
});

describe("client parameter helpers", () => {
  it("starts the run form on the version's values", () => {
    expect(buildInitialParameterValues([nameParameter, notesParameter])).toEqual({ projectName: "Apollo 7", notes: "" });
  });

  it("checks a value like the server does", () => {
    expect(findParameterValueProblem("fine")).toBeNull();
    expect(findParameterValueProblem("x".repeat(1001))).toBe("At most 1000 characters");
    expect(findParameterValueProblem("{{credential.password}}")).toBe("May not contain {{");
  });

  it("lists the parameters to fix: blank required ones and broken values", () => {
    expect(listParametersToFix([nameParameter, notesParameter], {})).toEqual([]);
    expect(listParametersToFix([nameParameter, notesParameter], { projectName: "  " })).toEqual(["Project name"]);
    expect(listParametersToFix([nameParameter, notesParameter], { notes: "{{x" })).toEqual(["Notes"]);
  });

  it("sends only the values that differ from the version's own", () => {
    expect(
      listChangedParameterValues([nameParameter, notesParameter], { projectName: "Apollo 7", notes: "Hi", stray: "x" }),
    ).toEqual({ notes: "Hi" });
  });

  it("says why a parameter is required or optional", () => {
    expect(describeParameterRequirement(buildVersionParameterRecord({ requiredReason: "object" }))).toBe("Required, always");
    expect(describeParameterRequirement(buildVersionParameterRecord({ isRequired: false, requiredReason: "you" }))).toBe(
      "Optional (you chose)",
    );
    expect(describeParameterRequirement(buildVersionParameterRecord({ requiredReason: "run" }))).toBe(
      "Required (the page says so, seen on a run)",
    );
    expect(describeParameterRequirement(buildVersionParameterRecord({ requiredReason: "crawl" }))).toBe(
      "Required (the page says so, seen on a crawl)",
    );
    expect(describeParameterRequirement(nameParameter)).toBe("Required (a step types it)");
    expect(describeParameterRequirement(notesParameter)).toBe("Optional (the page doesn't say)");
  });

  it("names where a parameter came from", () => {
    expect(describeParameterSource(buildVersionParameterRecord({ kind: "object" }))).toBe("The object");
    expect(describeParameterSource(buildVersionParameterRecord({ source: "you" }))).toBe("Added by you");
    expect(describeParameterSource(notesParameter)).toBe("On the page");
    expect(describeParameterSource(nameParameter)).toBe("In the steps");
  });

  it("lists the steps a parameter is used in", () => {
    expect(describeParameterSteps(nameParameter)).toBe("steps 1, 3");
    expect(describeParameterSteps(buildVersionParameterRecord({ uses: [{ stepNumber: 2, field: "value" }] }))).toBe("step 2");
    expect(describeParameterSteps(buildVersionParameterRecord({ uses: [{ stepNumber: 0, field: "url" }] }))).toBe(
      "the start address",
    );
    expect(describeParameterSteps(notesParameter)).toBe("typed after step 1");
  });

  it("tags each step with its parameters and the confirm step", () => {
    expect(buildStepParameterTags(null).size).toBe(0);
    const tags = buildStepParameterTags(
      buildVersionParametersRecord({
        parameters: [
          nameParameter,
          buildVersionParameterRecord({ key: "object", label: "Project", uses: [{ stepNumber: 0, field: "url" }, { stepNumber: 1, field: "targetName" }] }),
        ],
        confirmStepNumber: 2,
      }),
    );
    expect(tags.get(1)).toEqual(["Project name", "Project"]);
    expect(tags.get(2)).toEqual(["Confirm"]);
    expect(tags.get(3)).toEqual(["Project name"]);
    expect(tags.has(0)).toBe(false);
  });

  it("reads a run's stored values, keeping only well-formed ones", () => {
    expect(readUsedParameterValues("not a list")).toEqual([]);
    expect(
      readUsedParameterValues([{ key: "a", label: "A", value: "1" }, { key: "b" }, null, "x", { key: 1, label: "B", value: "2" }]),
    ).toEqual([{ key: "a", label: "A", value: "1" }]);
  });
});

describe("object role helpers", () => {
  const createRole = buildActionObjectRoleRecord({
    kind: "create",
    detectedKind: {
      kind: "create",
      reason: "won",
      confidence: "high",
      confidenceShare: 1,
      objectScore: 0,
      createScore: 2,
      evidence: ["create", "adds"],
    },
    objectTypeName: "Project",
    detectedObjectType: {
      objectTypeKey: "/projects/{project}",
      objectTypeName: "Project",
      confidence: "medium",
      confidenceShare: 0.6,
      evidence: ["project"],
    },
    detectedDeletesObject: { deletesObject: true, evidence: ["delete"] },
  });

  it("names confidence levels", () => {
    expect(describeConfidence("high")).toBe("High");
    expect(describeConfidence("low")).toBe("Low");
  });

  it("describes what Detect picks for each choice", () => {
    expect(describeDetectedKindChoice(null)).toBe("Detect from the title and description");
    expect(describeDetectedKindChoice(createRole)).toBe("Detect — Create (High: create, adds)");
    expect(describeDetectedKindChoice(buildActionObjectRoleRecord())).toBe("Detect — Parameters (no object or create words)");
    expect(
      describeDetectedKindChoice(
        buildActionObjectRoleRecord({
          detectedKind: { ...createRole.detectedKind, kind: "parameters", reason: "tie", evidence: ["add", "remove"] },
        }),
      ),
    ).toBe("Detect — Parameters (tie: add, remove)");
    expect(describeDetectedObjectTypeChoice(null)).toBe("Detect from the title, description, and addresses");
    expect(describeDetectedObjectTypeChoice(createRole)).toBe("Detect — Project (Medium)");
    expect(describeDetectedObjectTypeChoice(buildActionObjectRoleRecord())).toBe("Detect — none found");
    expect(describeDetectedDeletesChoice(null)).toBe("Detect from the title and description");
    expect(describeDetectedDeletesChoice(createRole)).toBe("Detect — Yes (delete)");
    expect(describeDetectedDeletesChoice(buildActionObjectRoleRecord())).toBe("Detect — No");
  });

  it("describes the role in one line for the header", () => {
    const noDetails = { nameParameterLabel: null, confirmStepNumber: null };
    expect(describeObjectRole(buildActionObjectRoleRecord(), noDetails)).toBeNull();
    expect(describeObjectRole(createRole, { nameParameterLabel: "Project name", confirmStepNumber: 3 })).toBe(
      "Creates a Project, named by Project name, confirmed by step 3 (detected, High)",
    );
    expect(describeObjectRole({ ...createRole, kind: "object", kindSource: "you", objectTypeName: "Order" }, noDetails)).toBe(
      "Takes an Order (you chose)",
    );
    expect(describeObjectRole({ ...createRole, kind: "object", deletesObject: true, objectTypeName: null }, noDetails)).toBe(
      "Deletes an object (detected, High)",
    );
    expect(describeObjectRole(createRole, noDetails)).toBe("Creates a Project (detected, High)");
  });
});
