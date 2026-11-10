import { describe, it, expect } from "vitest";
import {
  LOGIN_ACTION_KIND,
  buildInheritedRunValues,
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
  ACTION_KIND_HELP,
  ACTION_KIND_LABELS,
  describeConfidence,
  describeDetectedKindChoice,
  describeDetectedObjectTypeChoice,
  kindTakesAnObjectType,
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

  describe("buildInheritedRunValues", () => {
    const secretParameter = buildVersionParameterRecord({ key: "password", label: "Password", isSecret: true, defaultValue: "" });
    const optionalParameter = buildVersionParameterRecord({ key: "colour", label: "Colour", isRequired: false });
    const requiredAddedField = buildVersionParameterRecord({
      key: "notes",
      label: "Notes",
      isRequired: true,
      addedField: { target: { label: "Notes" }, stepAction: "fill", afterStepNumber: 1 },
    });
    const passedRun = {
      succeeded: true,
      parameterValues: [
        { key: "projectName", label: "Project name", value: "Voyager" },
        { key: "colour", label: "Colour", value: "Blue" },
        { key: "notes", label: "Notes", value: "Hello" },
      ],
    };

    it("takes each required parameter's value from the newest successful run, skipping newer failed ones", () => {
      const newerFailedRun = { succeeded: false, parameterValues: [{ key: "projectName", label: "Project name", value: "Zeta" }] };
      const olderPassedRun = { succeeded: true, parameterValues: [{ key: "projectName", label: "Project name", value: "Gemini" }] };

      expect(buildInheritedRunValues([nameParameter], [newerFailedRun, passedRun, olderPassedRun])).toEqual({
        projectName: "Voyager",
      });
    });

    it("leaves optional parameters, added fields, and secrets on the version's own values", () => {
      expect(
        buildInheritedRunValues([nameParameter, optionalParameter, requiredAddedField, secretParameter], [passedRun]),
      ).toEqual({ projectName: "Voyager" });
    });

    it("inherits nothing when no run passed, or the run has no value or only a blank one for it", () => {
      expect(buildInheritedRunValues([nameParameter], [])).toEqual({});
      expect(buildInheritedRunValues([nameParameter], [{ succeeded: false, parameterValues: passedRun.parameterValues }])).toEqual({});
      expect(buildInheritedRunValues([nameParameter], [{ succeeded: true, parameterValues: [] }])).toEqual({});
      expect(
        buildInheritedRunValues([nameParameter], [{ succeeded: true, parameterValues: [{ key: "projectName", label: "Project name", value: "  " }] }]),
      ).toEqual({});
      // A run recorded before parameters existed stored nothing readable.
      expect(buildInheritedRunValues([nameParameter], [{ succeeded: true, parameterValues: null }])).toEqual({});
    });
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
    expect(describeParameterSource(buildVersionParameterRecord({ source: "create" }))).toBe("From its create action");
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
      scores: { create: 2, read: 0, update: 0, delete: 0 },
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
  });

  it("names confidence levels", () => {
    expect(describeConfidence("high")).toBe("High");
    expect(describeConfidence("low")).toBe("Low");
  });

  it("describes what Detect picks for each choice", () => {
    expect(describeDetectedKindChoice(null)).toBe("Detect from the title and description");
    expect(describeDetectedKindChoice(createRole)).toBe("Detect — Create (High: create, adds)");
    expect(describeDetectedKindChoice(buildActionObjectRoleRecord())).toBe("Detect — Parameters (no kind words)");
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
  });

  it("describes the role in one line for the header", () => {
    const noDetails = { nameParameterLabel: null, confirmStepNumber: null };
    expect(describeObjectRole(buildActionObjectRoleRecord(), noDetails)).toBeNull();
    expect(describeObjectRole(createRole, { nameParameterLabel: "Project name", confirmStepNumber: 3 })).toBe(
      "Creates a Project, named by Project name, confirmed by step 3 (detected, High)",
    );
    expect(describeObjectRole({ ...createRole, kind: "read", kindSource: "you", objectTypeName: "Order" }, noDetails)).toBe(
      "Reads an Order (you chose)",
    );
    expect(describeObjectRole({ ...createRole, kind: "update", objectTypeName: "Order" }, noDetails)).toBe(
      "Updates an Order (detected, High)",
    );
    expect(describeObjectRole({ ...createRole, kind: "delete", objectTypeName: null }, noDetails)).toBe(
      "Deletes an object (detected, High)",
    );
    expect(describeObjectRole(createRole, noDetails)).toBe("Creates a Project (detected, High)");
  });

  it("describes no object role for a Login action, which touches no object", () => {
    const noDetails = { nameParameterLabel: null, confirmStepNumber: null };
    const loginRole = buildActionObjectRoleRecord({ kind: LOGIN_ACTION_KIND, kindSource: "you" });

    expect(describeObjectRole(loginRole, noDetails)).toBeNull();
  });

  it("labels and explains the Login kind, and no longer calls Parameters a login", () => {
    expect(LOGIN_ACTION_KIND).toBe("login");
    expect(ACTION_KIND_LABELS.login).toBe("Login");
    expect(ACTION_KIND_HELP.login).toBe(
      "The website's one login: it types the username and password of whichever credential an action or crawl runs as, before they start.",
    );
    expect(ACTION_KIND_HELP.parameters).toBe("The action only takes typed values; it touches no object.");
    expect(Object.keys(ACTION_KIND_LABELS)).toEqual(["parameters", "create", "read", "update", "delete", "login"]);
  });

  it("says which kinds take an object type", () => {
    expect(kindTakesAnObjectType("parameters")).toBe(false);
    expect(kindTakesAnObjectType(LOGIN_ACTION_KIND)).toBe(false);
    expect(kindTakesAnObjectType(null)).toBe(true);
    for (const kind of ["create", "read", "update", "delete"] as const) {
      expect(kindTakesAnObjectType(kind)).toBe(true);
    }
  });
});
