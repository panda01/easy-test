import { describe, it, expect } from "vitest";
import {
  describeConfidence,
  detectActionKind,
  detectObjectType,
  findWordMatches,
  isLoginAction,
  isOneTypoApart,
  kindActsOnAnExistingObject,
  kindNeedsAnObjectType,
  kindTakesAnObjectType,
  readActionKind,
  resolveActionObjectRole,
  scoreWordMatch,
  splitIntoWords,
  stemWord,
  sumWordMatches,
  ACTION_KINDS,
  CREATE_WORDS,
  LOGIN_ACTION_KIND,
  READ_WORDS,
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
    const matches = findWordMatches("Go to the page and sign up", [...READ_WORDS, ...CREATE_WORDS], true);
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
    ["Open a project", "", "read", "high"],
    ["Rename a project", "", "update", "high"],
    ["Delete a project", "Removes it", "delete", "high"],
    ["Craete a projct", "", "create", "high"],
  ] as const)("detects %s / %s as %s (%s)", (title, description, kind, confidence) => {
    expect(detectActionKind(title, description)).toMatchObject({ kind, reason: "won", confidence });
  });

  it("scores the title twice and stems the description, scoring every object kind", () => {
    const detection = detectActionKind("Rename a project", "Opens the project and creates a label");

    expect(detection).toMatchObject({
      kind: "update",
      confidence: "medium",
      scores: { create: 0.9, read: 0.9, update: 2, delete: 0 },
    });
    expect(detection.confidenceShare).toBeCloseTo(2 / 3.8);
    expect(detection.evidence).toEqual(["rename"]);
  });

  it("calls a tie for first place Parameters, with the tied kinds' words", () => {
    expect(detectActionKind("Project labels", "Add or remove labels")).toEqual({
      kind: "parameters",
      reason: "tie",
      confidence: "low",
      confidenceShare: 0.5,
      scores: { create: 1, read: 0, update: 0, delete: 1 },
      evidence: ["add", "remove"],
    });
  });

  it("calls no match at all Parameters - so a login-style action stays Parameters", () => {
    expect(detectActionKind("Log in", "Sign in with the admin account")).toMatchObject({
      kind: "parameters",
      reason: "noMatch",
      evidence: [],
    });
  });

  it("says Medium when the winner's share is below High", () => {
    expect(detectActionKind("Create a class", "Find the school, open it, then make a class")).toMatchObject({
      kind: "create",
      confidence: "medium",
    });
  });
});

describe("the kind predicates", () => {
  it("lists Parameters first, then the four object kinds, then Login", () => {
    expect(ACTION_KINDS).toEqual(["parameters", "create", "read", "update", "delete", "login"]);
    expect(LOGIN_ACTION_KIND).toBe("login");
  });

  it("gives neither a Parameters nor a Login action an object type", () => {
    expect(kindTakesAnObjectType("parameters")).toBe(false);
    expect(kindTakesAnObjectType("login")).toBe(false);
    expect(kindNeedsAnObjectType("login")).toBe(false);
    expect(kindActsOnAnExistingObject("login")).toBe(false);
  });

  it("says an action is a Login action only when the user picked Login", () => {
    expect(isLoginAction({ userActionKind: "login" })).toBe(true);
    expect(isLoginAction({ userActionKind: "create" })).toBe(false);
    expect(isLoginAction({ userActionKind: "parameters" })).toBe(false);
    expect(isLoginAction({ userActionKind: null })).toBe(false);
  });

  it("say which kinds take, need, and act on an existing object (Delete mirrors its Create action instead)", () => {
    expect(ACTION_KINDS.filter(kindTakesAnObjectType)).toEqual(["create", "read", "update", "delete"]);
    expect(ACTION_KINDS.filter(kindNeedsAnObjectType)).toEqual(["create", "update"]);
    expect(ACTION_KINDS.filter(kindActsOnAnExistingObject)).toEqual(["read", "update"]);
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
  const detectEverything = { userActionKind: null, userObjectTypeKey: null };

  it("detects every choice left on detect", () => {
    const role = resolveActionObjectRole(
      { title: "Delete a project", description: "", ...detectEverything },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({
      kind: "delete",
      kindSource: "detected",
      objectTypeKey: "/projects/{project}",
      objectTypeName: "Project",
      objectTypeSource: "detected",
      warnings: [],
    });
  });

  it("lets the user's choices win, and keeps a chosen type the crawl no longer finds", () => {
    const role = resolveActionObjectRole(
      {
        title: "Delete a project",
        description: "",
        userActionKind: "update",
        userObjectTypeKey: "/gone/{gone}",
      },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({
      kind: "update",
      kindSource: "you",
      objectTypeKey: "/gone/{gone}",
      objectTypeName: null,
      objectTypeSource: "you",
    });
    expect(role.warnings).toEqual(["The chosen kind of object is no longer found by the latest crawl; pick it again"]);
  });

  it("gives a Parameters action no type", () => {
    const role = resolveActionObjectRole(
      { title: "Delete a project", description: "", userActionKind: "parameters", userObjectTypeKey: "/projects/{project}" },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({ kind: "parameters", objectTypeKey: null, objectTypeSource: null, warnings: [] });
  });

  it("gives a Login action no type, even when the title names one", () => {
    const role = resolveActionObjectRole(
      { title: "Log in to a project", description: "", userActionKind: "login", userObjectTypeKey: "/projects/{project}" },
      CANDIDATES,
      [],
    );
    expect(role).toMatchObject({
      kind: "login",
      kindSource: "you",
      objectTypeKey: null,
      objectTypeName: null,
      objectTypeSource: null,
      warnings: [],
    });
  });

  it("lets a Read or Delete action go without a type, but warns a Create or Update action", () => {
    expect(resolveActionObjectRole({ title: "Open the dashboard", description: "", ...detectEverything }, CANDIDATES, []).warnings).toEqual([]);
    expect(
      resolveActionObjectRole({ title: "Do the widget", description: "", userActionKind: "delete", userObjectTypeKey: null }, CANDIDATES, []).warnings,
    ).toEqual([]);
    for (const userActionKind of ["create", "update"]) {
      expect(
        resolveActionObjectRole({ title: "Do the widget", description: "", userActionKind, userObjectTypeKey: null }, CANDIDATES, []).warnings,
      ).toEqual(["Pick the kind of object this action works on - none was detected"]);
    }
  });

  it("warns about a tie, a missing type, and an unsure type", () => {
    expect(
      resolveActionObjectRole({ title: "Project labels", description: "Add or remove labels", ...detectEverything }, CANDIDATES, []).warnings,
    ).toEqual(["Check this: the kind words tied (add, remove), so it was set to Parameters"]);
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
    expect(readActionKind("login")).toBe("login");
    expect(readActionKind("destroy")).toBeNull();
    expect(readActionKind(null)).toBeNull();
  });
});
