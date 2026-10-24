import { describe, it, expect } from "vitest";
import {
  describeConfidence,
  detectActionKind,
  detectDeletesObject,
  detectObjectType,
  findWordMatches,
  isOneTypoApart,
  readActionKind,
  resolveActionObjectRole,
  scoreWordMatch,
  splitIntoWords,
  stemWord,
  sumWordMatches,
  CREATE_WORDS,
  OBJECT_WORDS,
  type ObjectTypeCandidate,
} from "../../../server/utils/scoreActionObjectRole.js";

/** The website's object types: Projects, and crawl runs (a two-word name). */
const CANDIDATES: ObjectTypeCandidate[] = [
  { objectTypeKey: "/projects/{project}", name: "Project", addressPatternKeys: ["/projects/{project}", "/projects/new"] },
  { objectTypeKey: "/crawl-runs/{crawlRun}", name: "Crawl run", addressPatternKeys: ["/crawl-runs/{crawlRun}"] },
  { objectTypeKey: "/schools/{school}", name: "School", addressPatternKeys: ["/schools/{school}"] },
];

describe("word matching", () => {
  it("splits text into lower case words", () => {
    expect(splitIntoWords("Create a New-Project, 2 times!")).toEqual(["create", "a", "new", "project", "2", "times"]);
  });

  it("stems words so their forms match", () => {
    expect(stemWord("creates")).toBe(stemWord("create"));
    expect(stemWord("creation")).toBe(stemWord("create"));
    expect(stemWord("created")).toBe(stemWord("creating"));
    expect(stemWord("added")).toBe(stemWord("add"));
    expect(stemWord("submitted")).toBe(stemWord("submit"));
    expect(stemWord("modifies")).toBe(stemWord("modify"));
    expect(stemWord("opens")).toBe("open");
    expect(stemWord("is")).toBe("is");
  });

  it("finds words one typo apart", () => {
    expect(isOneTypoApart("craete", "create")).toBe(true);
    expect(isOneTypoApart("crate", "create")).toBe(true);
    expect(isOneTypoApart("creates", "create")).toBe(true);
    expect(isOneTypoApart("crbate", "create")).toBe(true);
    expect(isOneTypoApart("create", "create")).toBe(false);
    expect(isOneTypoApart("cretae", "create")).toBe(true);
    expect(isOneTypoApart("ecrtae", "create")).toBe(false);
    expect(isOneTypoApart("crates", "create")).toBe(false);
    expect(isOneTypoApart("cr", "create")).toBe(false);
  });

  it("weighs exact, same-stem, and typo matches, forgiving typos only in longer words", () => {
    expect(scoreWordMatch("create", "create")).toBe(1);
    expect(scoreWordMatch("creates", "create")).toBe(0.9);
    expect(scoreWordMatch("craete", "create")).toBe(0.6);
    expect(scoreWordMatch("ad", "add")).toBe(0);
    expect(scoreWordMatch("edt", "edit")).toBe(0);
  });

  it("matches two-word phrases as phrases and skips stop words", () => {
    const matches = findWordMatches("Go to the page and sign up", [...OBJECT_WORDS, ...CREATE_WORDS], true);
    expect(matches.map((match) => [match.word, match.listWord])).toEqual([
      ["go to", "go to"],
      ["sign up", "sign up"],
    ]);
    expect(sumWordMatches(matches)).toBe(4);
  });

  it("names confidence levels from the winner's share", () => {
    expect(describeConfidence(0.75)).toBe("high");
    expect(describeConfidence(0.5)).toBe("medium");
    expect(describeConfidence(0.49)).toBe("low");
  });
});

describe("detectActionKind", () => {
  it.each([
    ["Create a school", "Adds a new school", "create", "high"],
    ["Open a project", "", "object", "high"],
    ["Craete a projct", "", "create", "high"],
  ] as const)("detects %s / %s as %s (%s)", (title, description, kind, confidence) => {
    expect(detectActionKind(title, description)).toMatchObject({ kind, reason: "won", confidence });
  });

  it("scores the title twice and stems the description: Rename a project is Object, High (76%)", () => {
    const detection = detectActionKind("Rename a project", "Opens the project and creates a label");

    expect(detection).toMatchObject({ kind: "object", confidence: "high", objectScore: 2.9, createScore: 0.9 });
    expect(detection.confidenceShare).toBeCloseTo(2.9 / 3.8);
    expect(detection.evidence).toEqual(["rename", "opens"]);
  });

  it("calls a tie Parameters, with both sides' words", () => {
    expect(detectActionKind("Project labels", "Add or remove labels")).toEqual({
      kind: "parameters",
      reason: "tie",
      confidence: "low",
      confidenceShare: 0.5,
      objectScore: 1,
      createScore: 1,
      evidence: ["remove", "add"],
    });
  });

  it("calls no match at all Parameters", () => {
    expect(detectActionKind("Check the footer", "")).toMatchObject({ kind: "parameters", reason: "noMatch", evidence: [] });
  });

  it("says Medium when the winner's share is below High", () => {
    expect(detectActionKind("Create a class", "Find the school, open it, then make a class")).toMatchObject({
      kind: "create",
      confidence: "medium",
    });
  });
});

describe("detectDeletesObject", () => {
  it("finds the delete words", () => {
    expect(detectDeletesObject("Delete a project", "Removes it")).toEqual({ deletesObject: true, evidence: ["delete", "removes"] });
    expect(detectDeletesObject("Open a project", "")).toEqual({ deletesObject: false, evidence: [] });
  });
});

describe("detectObjectType", () => {
  it("finds the type the title names, singular or plural", () => {
    expect(detectObjectType("Create a project", "Lists projects", CANDIDATES, [])).toMatchObject({
      objectTypeKey: "/projects/{project}",
      objectTypeName: "Project",
      confidence: "high",
      evidence: ["project", "projects"],
    });
  });

  it("matches a two-word name only with its first word in place", () => {
    expect(detectObjectType("Open a crawl run", "", CANDIDATES, [])?.objectTypeKey).toBe("/crawl-runs/{crawlRun}");
    expect(detectObjectType("Open a run", "", CANDIDATES, [])).toBeNull();
  });

  it("adds the version's addresses, which can decide on their own", () => {
    expect(detectObjectType("Do the thing", "", CANDIDATES, ["https://example.com/projects/new"])).toMatchObject({
      objectTypeKey: "/projects/{project}",
      evidence: ["address"],
    });
  });

  it("picks nothing when nothing matches or two types tie", () => {
    expect(detectObjectType("Check the footer", "", CANDIDATES, [])).toBeNull();
    expect(detectObjectType("Compare a project and a school", "", CANDIDATES, [])).toBeNull();
    expect(detectObjectType("Create a project", "", [{ objectTypeKey: "/", name: "", addressPatternKeys: [] }], [])).toBeNull();
  });

  it("says how sure it is when another type also matched", () => {
    expect(detectObjectType("Open a project", "of the school", CANDIDATES, [])).toMatchObject({
      objectTypeKey: "/projects/{project}",
      confidence: "medium",
    });
  });
});

describe("resolveActionObjectRole", () => {
  /** An action left on "detect" for everything. */
  const detectEverything = { userActionKind: null, userObjectTypeKey: null, userDeletesObject: null };

  it("detects every choice left on detect", () => {
    const role = resolveActionObjectRole(
      { title: "Delete a project", description: "", ...detectEverything },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({
      kind: "object",
      kindSource: "detected",
      objectTypeKey: "/projects/{project}",
      objectTypeName: "Project",
      objectTypeSource: "detected",
      deletesObject: true,
      deletesObjectSource: "detected",
      warnings: [],
    });
  });

  it("lets the user's choices win, and keeps a chosen type the crawl no longer finds", () => {
    const role = resolveActionObjectRole(
      {
        title: "Delete a project",
        description: "",
        userActionKind: "object",
        userObjectTypeKey: "/gone/{gone}",
        userDeletesObject: false,
      },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({
      kind: "object",
      kindSource: "you",
      objectTypeKey: "/gone/{gone}",
      objectTypeName: null,
      objectTypeSource: "you",
      deletesObject: false,
      deletesObjectSource: "you",
    });
    expect(role.warnings).toEqual(["The chosen kind of object is no longer found by the latest crawl; pick it again"]);
  });

  it("gives a Parameters action no type and never deletes", () => {
    const role = resolveActionObjectRole(
      { title: "Delete a project", description: "", userActionKind: "parameters", userObjectTypeKey: "/projects/{project}", userDeletesObject: true },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({ kind: "parameters", objectTypeKey: null, objectTypeSource: null, deletesObject: false });
  });

  it("warns about a tie, a missing type, and an unsure type", () => {
    expect(
      resolveActionObjectRole({ title: "Project labels", description: "Add or remove labels", ...detectEverything }, CANDIDATES, []).warnings,
    ).toEqual(["Check this: the object words and the create words tied (remove, add), so it was set to Parameters"]);
    expect(resolveActionObjectRole({ title: "Create a widget", description: "", ...detectEverything }, CANDIDATES, []).warnings).toEqual([
      "Pick the kind of object this action works on - none was detected",
    ]);
    const unsureCandidates: ObjectTypeCandidate[] = [
      { objectTypeKey: "/projects/{project}", name: "Project", addressPatternKeys: [] },
      { objectTypeKey: "/teams/{team}", name: "Team", addressPatternKeys: [] },
      { objectTypeKey: "/users/{user}", name: "User", addressPatternKeys: [] },
    ];
    expect(
      resolveActionObjectRole(
        { title: "Create a projct", description: "for the team and user", ...detectEverything },
        unsureCandidates,
        [],
      ).warnings,
    ).toEqual(["Check the kind of object - the detection is not sure"]);
  });

  it("reads only a known stored kind", () => {
    expect(readActionKind("create")).toBe("create");
    expect(readActionKind("destroy")).toBeNull();
    expect(readActionKind(null)).toBeNull();
  });
});
