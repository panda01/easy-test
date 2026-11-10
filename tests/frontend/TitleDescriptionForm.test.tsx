import { describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import TitleDescriptionForm, {
  describeLogInAsHelp,
  describeLoginPageHelp,
  type LoginActionOption,
  type LoginChoices,
  type TitleDescriptionFormProps,
} from "../../src/components/TitleDescriptionForm";
import { type WebsiteItemRequestBody } from "../../src/hooks/useWebsiteItems";
import { ACTION_KIND_HELP } from "../../src/utils/actionObjectRole";
import { buildActionObjectRoleRecord } from "./support/frontendTestHelpers";

/**
 * Renders the title / description form with blank fields and spy callbacks,
 * letting a test override any prop.
 * @param overrides - Props to replace in the default blank form
 * @returns The submit and cancel spies, and the rendered form element
 */
function renderTitleDescriptionForm(overrides: Partial<TitleDescriptionFormProps> = {}): {
  onSubmit: Mock<(values: WebsiteItemRequestBody) => void>;
  onCancel: Mock<() => void>;
  formElement: HTMLFormElement;
} {
  const onSubmit = vi.fn<(values: WebsiteItemRequestBody) => void>();
  const onCancel = vi.fn<() => void>();
  const { container } = render(
    <TitleDescriptionForm
      initialValues={{ title: "", description: "" }}
      submitLabel="Create use case"
      isSubmitting={false}
      errorMessage={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  const formElement = container.querySelector("form");
  if (formElement === null) throw new Error("TitleDescriptionForm did not render a <form>");
  return { onSubmit, onCancel, formElement };
}

/** The website's login page, which a Login action with none of its own uses. */
const WEBSITE_LOGIN_URL = "https://example.com/login";

/** The website's one Login action, as the form names it. */
const WEBSITE_LOGIN_ACTION: LoginActionOption = { id: "login-action-1", title: "Sign in" };

/**
 * What the login fields offer by default: two credentials (for any other
 * action's "Log in as"), the website's Login action (which those actions log
 * in through), and the website's login page.
 */
const LOGIN_CHOICES: LoginChoices = {
  credentials: [
    { id: "credential-2", name: "Viewer" },
    { id: "credential-1", name: "Admin" },
  ],
  loginAction: WEBSITE_LOGIN_ACTION,
  websiteLoginUrl: WEBSITE_LOGIN_URL,
};

/**
 * The same choices for a website without a Login action yet - as on the
 * page creating its Login action, or editing it (the page leaves the edited
 * action out), where the Kind select still offers Login.
 */
const LOGIN_CHOICES_WITHOUT_LOGIN_ACTION: LoginChoices = { ...LOGIN_CHOICES, loginAction: null };

/** A filled-in title and description, so submit is enabled. */
const FILLED_VALUES = { title: "Log in", description: "Sign in" };

/** The login fields a submit sends for an action that runs logged out: every one null. */
const LOGGED_OUT_LOGIN_FIELDS = {
  credentialId: null,
  loginUrl: null,
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
};

/** What an action form sends for its object role when every choice is left on "Detect". */
const DETECT_EVERY_ROLE_CHOICE = { userActionKind: null, userObjectTypeKey: null, userNameParameterKey: null };

/**
 * Picks an option from one of the form's selects.
 * @param user - The user-event session
 * @param selectName - The select's label
 * @param optionName - The option's text
 */
async function pickOption(user: UserEvent, selectName: RegExp, optionName: string | RegExp): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/**
 * Picks an option from any other action's "Log in as" select.
 * @param user - The user-event session
 * @param optionName - The option's text: a credential's name, or "Logged out (no login)"
 */
async function pickCredential(user: UserEvent, optionName: string): Promise<void> {
  await pickOption(user, /^Log in as/, optionName);
}

/**
 * Finds a text field by its label, ignoring the required-field asterisk.
 * @param label - The field's label, e.g. "Login page URL"
 * @returns The field's input
 */
function getField(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${label}\\W*$`));
}

/**
 * Finds the form's submit button by the label the tests give it.
 * @returns The "Create use case" button
 */
function getSubmitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Create use case" });
}

describe("TitleDescriptionForm", () => {
  it("seeds the fields from initialValues", () => {
    renderTitleDescriptionForm({
      initialValues: { title: "Log in", description: "Sign in with a valid account" },
    });
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Log in");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Sign in with a valid account",
    );
  });

  it("disables submit while both fields are blank", () => {
    renderTitleDescriptionForm();
    expect(getSubmitButton()).toBeDisabled();
  });

  it("keeps submit disabled while only one field is filled", async () => {
    const user = userEvent.setup();
    renderTitleDescriptionForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Log in");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Steps");
    expect(getSubmitButton()).toBeDisabled();
  });

  it("treats a whitespace-only title or description as blank", async () => {
    const user = userEvent.setup();
    renderTitleDescriptionForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "   ");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Steps");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Log in");
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "  ");
    expect(getSubmitButton()).toBeDisabled();
  });

  it("enables submit and sends the typed values once both fields are filled", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Log in");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Sign in");
    expect(getSubmitButton()).toBeEnabled();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in" });
  });

  it("ignores a submit event while a required field is blank (e.g. Enter)", () => {
    const { onSubmit, formElement } = renderTitleDescriptionForm({
      initialValues: { title: "Log in", description: "" },
    });
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit and ignores submit events while a save is in flight", () => {
    const { onSubmit, formElement } = renderTitleDescriptionForm({
      initialValues: { title: "Log in", description: "Sign in" },
      isSubmitting: true,
    });
    expect(getSubmitButton()).toBeDisabled();
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the save error in an alert", () => {
    renderTitleDescriptionForm({ errorMessage: "title is required" });
    expect(screen.getByRole("alert")).toHaveTextContent("title is required");
  });

  it("shows no alert without a save error", () => {
    renderTitleDescriptionForm();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked, without submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderTitleDescriptionForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts a plus on the submit button when told to, as the create page does", () => {
    renderTitleDescriptionForm({ submitButtonShowsPlus: true });

    const submitButton = screen.getByRole("button", { name: "Create use case" });
    expect(within(submitButton).getByTestId("AddIcon")).toBeInTheDocument();
  });

  it("leaves the plus off the submit button by default, as the edit page's Save changes has it", () => {
    renderTitleDescriptionForm({ submitLabel: "Save changes" });

    const submitButton = screen.getByRole("button", { name: "Save changes" });
    expect(within(submitButton).queryByTestId("AddIcon")).not.toBeInTheDocument();
  });

  it("asks how to log in only when given login choices, and leaves the login fields out otherwise", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({ initialValues: FILLED_VALUES });

    expect(screen.queryByRole("combobox", { name: /^Log in as/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Login page URL/)).not.toBeInTheDocument();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in" });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("credentialId");
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("loginUrl");
  });

  it("starts logged out, offers each credential, and explains what the pick does", async () => {
    const user = userEvent.setup();
    renderTitleDescriptionForm({ initialValues: FILLED_VALUES, loginChoices: LOGIN_CHOICES });

    const credentialSelect = screen.getByRole("combobox", { name: /^Log in as/ });
    expect(credentialSelect).toHaveTextContent("Logged out (no login)");
    expect(screen.getByText("Each run starts logged out")).toBeInTheDocument();
    // An action that is not the Login action has none of the Login action's own fields.
    expect(screen.queryByLabelText(/^Login page URL/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Login form selectors (optional)" })).not.toBeInTheDocument();

    await user.click(credentialSelect);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Logged out (no login)", "Viewer", "Admin"]);
    await user.click(screen.getByRole("option", { name: "Admin" }));
    expect(
      screen.getByText('Before each run, the browser logs in as this credential with the login action "Sign in"'),
    ).toBeInTheDocument();
  });

  it("submits logged out when the website has no credentials, saying how to add one", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({
      initialValues: FILLED_VALUES,
      loginChoices: { ...LOGIN_CHOICES, credentials: [] },
    });

    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Logged out (no login)");
    expect(
      screen.getByText("This website has no credentials yet - add one on its Credentials tab to run logged in"),
    ).toBeInTheDocument();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in", ...LOGGED_OUT_LOGIN_FIELDS });
  });

  it("warns that a run cannot log in while the website has no Login action, but still saves the picked credential", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({
      initialValues: { ...FILLED_VALUES, credentialId: "credential-1" },
      loginChoices: LOGIN_CHOICES_WITHOUT_LOGIN_ACTION,
    });

    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Admin");
    expect(screen.getByText(describeLogInAsHelp(true, null, true))).toBeInTheDocument();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Log in",
      description: "Sign in",
      ...LOGGED_OUT_LOGIN_FIELDS,
      credentialId: "credential-1",
    });
  });

  it("starts on the saved credential and submits the one picked, with the Login-only fields null", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({
      initialValues: { ...FILLED_VALUES, credentialId: "credential-1" },
      loginChoices: LOGIN_CHOICES,
    });
    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Admin");

    await pickCredential(user, "Viewer");
    await user.click(getSubmitButton());
    await pickCredential(user, "Logged out (no login)");
    await user.click(getSubmitButton());

    expect(onSubmit.mock.calls).toEqual([
      [{ title: "Log in", description: "Sign in", ...LOGGED_OUT_LOGIN_FIELDS, credentialId: "credential-2" }],
      [{ title: "Log in", description: "Sign in", ...LOGGED_OUT_LOGIN_FIELDS }],
    ]);
  });

  it("shows and submits a saved credential that is no longer offered as logged out", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({
      initialValues: { ...FILLED_VALUES, credentialId: "deleted-credential" },
      loginChoices: LOGIN_CHOICES,
    });

    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Logged out (no login)");
    expect(screen.getByText("Each run starts logged out")).toBeInTheDocument();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in", ...LOGGED_OUT_LOGIN_FIELDS });
  });

  describe("describeLoginPageHelp", () => {
    it("says a blank login page uses the website's, naming it", () => {
      expect(describeLoginPageHelp("https://example.com/login")).toBe(
        "Leave blank to use the website's login page (https://example.com/login)",
      );
    });

    it("asks for the login page when the website has none", () => {
      expect(describeLoginPageHelp(null)).toBe(
        "This website has no login page URL yet - enter it here (a successful crawl login will also save it to the website)",
      );
    });
  });

  describe("describeLogInAsHelp", () => {
    it("says how to add a credential when the website has none, whatever else is true", () => {
      const noCredentialsHelp = "This website has no credentials yet - add one on its Credentials tab to run logged in";
      expect(describeLogInAsHelp(false, null, false)).toBe(noCredentialsHelp);
      expect(describeLogInAsHelp(false, WEBSITE_LOGIN_ACTION, false)).toBe(noCredentialsHelp);
    });

    it("says a run cannot log in while the website has credentials but no Login action", () => {
      const noLoginActionHelp =
        "This website has no login action yet, so a run cannot log in - look for a login form on its Credentials tab, or add an action with the kind Login";
      expect(describeLogInAsHelp(true, null, false)).toBe(noLoginActionHelp);
      expect(describeLogInAsHelp(true, null, true)).toBe(noLoginActionHelp);
    });

    it("says each run starts logged out while Logged out is picked", () => {
      expect(describeLogInAsHelp(true, WEBSITE_LOGIN_ACTION, false)).toBe("Each run starts logged out");
    });

    it("says the browser logs in as the picked credential with the website's Login action, naming it", () => {
      expect(describeLogInAsHelp(true, WEBSITE_LOGIN_ACTION, true)).toBe(
        'Before each run, the browser logs in as this credential with the login action "Sign in"',
      );
    });
  });

  describe("object role choices (actions)", () => {
    /** The website's one object type. */
    const OBJECT_TYPES = [{ key: "/projects/{project}", name: "Project" }];

    /** A role detected as Create, of a Project, that does not delete. */
    const DETECTED_CREATE_ROLE = buildActionObjectRoleRecord({
      kind: "create",
      detectedKind: {
        kind: "create",
        reason: "won",
        confidence: "high",
        confidenceShare: 1,
        scores: { create: 3, read: 0, update: 0, delete: 0 },
        evidence: ["create", "adds"],
      },
      objectTypeKey: "/projects/{project}",
      objectTypeName: "Project",
      objectTypeSource: "detected",
      detectedObjectType: {
        objectTypeKey: "/projects/{project}",
        objectTypeName: "Project",
        confidence: "high",
        confidenceShare: 1,
        evidence: ["project"],
      },
    });

    it("starts every choice on Detect, naming what the detection picks, and submits nulls", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderTitleDescriptionForm({
        initialValues: { ...FILLED_VALUES, credentialId: null, userNameParameterKey: "projectName" },
        loginChoices: LOGIN_CHOICES,
        objectRoleChoices: { objectTypes: OBJECT_TYPES, detectedRole: DETECTED_CREATE_ROLE },
      });

      expect(screen.getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Detect — Create (High: create, adds)");
      expect(
        screen.getByText("The action makes a new object, which each run records and its delete action cleans up."),
      ).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /^Object type/ })).toHaveTextContent("Detect — Project (High)");
      // Delete is a kind now; there is no separate "deletes" choice.
      expect(screen.queryByRole("combobox", { name: /^Deletes the object/ })).not.toBeInTheDocument();

      await user.click(getSubmitButton());
      expect(onSubmit).toHaveBeenCalledWith({
        ...FILLED_VALUES,
        ...LOGGED_OUT_LOGIN_FIELDS,
        userActionKind: null,
        userObjectTypeKey: null,
        userNameParameterKey: "projectName",
      });
    });

    it("lists the six kinds and submits the kind and type the user picks", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderTitleDescriptionForm({
        initialValues: { ...FILLED_VALUES, credentialId: null },
        loginChoices: LOGIN_CHOICES_WITHOUT_LOGIN_ACTION,
        objectRoleChoices: { objectTypes: OBJECT_TYPES, detectedRole: DETECTED_CREATE_ROLE },
      });

      await user.click(screen.getByRole("combobox", { name: /^Kind/ }));
      const kindOptions = await screen.findAllByRole("option");
      expect(kindOptions.map((option) => option.textContent)).toEqual([
        "Detect — Create (High: create, adds)",
        "Parameters",
        "Create",
        "Read",
        "Update",
        "Delete",
        "Login",
      ]);
      await user.click(screen.getByRole("option", { name: "Delete" }));
      expect(
        screen.getByText("The action deletes the object its create action makes; it shares that action's parameters, and a passed run marks the object deleted."),
      ).toBeInTheDocument();
      await pickOption(user, /^Object type/, "Project");
      await user.click(getSubmitButton());
      expect(onSubmit).toHaveBeenLastCalledWith({
        ...FILLED_VALUES,
        ...LOGGED_OUT_LOGIN_FIELDS,
        userActionKind: "delete",
        userObjectTypeKey: "/projects/{project}",
        userNameParameterKey: null,
      });

      await pickOption(user, /^Kind/, "Read");
      expect(screen.getByRole("combobox", { name: /^Object type/ })).toBeInTheDocument();
      await pickOption(user, /^Kind/, "Parameters");
      expect(screen.queryByRole("combobox", { name: /^Object type/ })).not.toBeInTheDocument();
    });

    it("offers Login disabled, naming the website's Login action, while the website already has one", async () => {
      const user = userEvent.setup();
      renderTitleDescriptionForm({
        initialValues: { ...FILLED_VALUES, credentialId: null },
        loginChoices: LOGIN_CHOICES,
        objectRoleChoices: { objectTypes: OBJECT_TYPES, detectedRole: DETECTED_CREATE_ROLE },
      });

      await user.click(screen.getByRole("combobox", { name: /^Kind/ }));
      const kindOptions = await screen.findAllByRole("option");
      expect(kindOptions.map((option) => option.textContent)).toEqual([
        "Detect — Create (High: create, adds)",
        "Parameters",
        "Create",
        "Read",
        "Update",
        "Delete",
        'Login (this website already has one: "Sign in")',
      ]);
      const loginKindOption = screen.getByRole("option", { name: 'Login (this website already has one: "Sign in")' });
      expect(loginKindOption).toHaveAttribute("aria-disabled", "true");
      const readKindOption = screen.getByRole("option", { name: "Read" });
      expect(readKindOption).not.toHaveAttribute("aria-disabled");
    });

    it("keeps saved choices, including a type the latest crawl no longer finds", () => {
      renderTitleDescriptionForm({
        initialValues: {
          ...FILLED_VALUES,
          credentialId: null,
          userActionKind: "update",
          userObjectTypeKey: "/gone/{gone}",
        },
        loginChoices: LOGIN_CHOICES,
        objectRoleChoices: { objectTypes: OBJECT_TYPES, detectedRole: null },
      });

      expect(screen.getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Update");
      expect(screen.getByRole("combobox", { name: /^Object type/ })).toHaveTextContent(
        "/gone/{gone} (no longer found by the latest crawl)",
      );
    });

    it("on a new action, offers every choice before anything is detected", () => {
      renderTitleDescriptionForm({
        initialValues: { ...FILLED_VALUES, credentialId: null },
        loginChoices: LOGIN_CHOICES,
        objectRoleChoices: { objectTypes: OBJECT_TYPES, detectedRole: null },
      });

      expect(screen.getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Detect from the title and description");
      expect(screen.getByRole("combobox", { name: /^Object type/ })).toHaveTextContent(
        "Detect from the title, description, and addresses",
      );
    });

    it("names the cancel button as asked, for step 2 of a Create action", async () => {
      const user = userEvent.setup();
      const { onCancel } = renderTitleDescriptionForm({ cancelLabel: "Skip for now" });

      await user.click(screen.getByRole("button", { name: "Skip for now" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });

    it("shows the role's warnings", () => {
      renderTitleDescriptionForm({
        initialValues: { ...FILLED_VALUES, credentialId: null },
        loginChoices: LOGIN_CHOICES,
        objectRoleChoices: {
          objectTypes: [],
          detectedRole: { ...DETECTED_CREATE_ROLE, warnings: ["Pick the kind of object this action works on - none was detected"] },
        },
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Pick the kind of object this action works on");
    });
  });

  describe("a Login action (Kind = Login)", () => {
    /** The website's one object type. */
    const OBJECT_TYPES = [{ key: "/projects/{project}", name: "Project" }];

    /** A saved Login action's values, as the edit page seeds them: it has no credential. */
    const SAVED_LOGIN_ACTION_VALUES: WebsiteItemRequestBody = {
      title: "Sign in",
      description: "Sign in through the website's login form",
      credentialId: null,
      loginUrl: "https://example.com/admin/login",
      usernameSelector: "#email",
      passwordSelector: null,
      submitSelector: "button.sign-in",
      userActionKind: "login",
      userObjectTypeKey: null,
      userNameParameterKey: null,
    };

    /**
     * Renders an action's form with the login and object role fields, for a
     * website without a Login action yet (so the Kind select offers Login),
     * letting a test override any prop.
     * @param overrides - Props to replace
     * @returns The submit and cancel spies, and the rendered form element
     */
    function renderActionForm(overrides: Partial<TitleDescriptionFormProps> = {}): ReturnType<
      typeof renderTitleDescriptionForm
    > {
      return renderTitleDescriptionForm({
        initialValues: FILLED_VALUES,
        loginChoices: LOGIN_CHOICES_WITHOUT_LOGIN_ACTION,
        objectRoleChoices: { objectTypes: OBJECT_TYPES, detectedRole: null },
        ...overrides,
      });
    }

    it("puts the Kind select before the login fields", () => {
      renderActionForm();

      const kindSelect = screen.getByRole("combobox", { name: /^Kind/ });
      const credentialSelect = screen.getByRole("combobox", { name: /^Log in as/ });
      const loginFieldFollowsKind =
        kindSelect.compareDocumentPosition(credentialSelect) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(loginFieldFollowsKind).toBeTruthy();
    });

    it("swaps Log in as for the Login action's own fields, and hides the object type, once Login is picked", async () => {
      const user = userEvent.setup();
      renderActionForm();

      await pickOption(user, /^Kind/, "Login");

      expect(screen.getByText(ACTION_KIND_HELP.login)).toBeInTheDocument();
      // The Login action has no credential of its own: whoever logs in is picked elsewhere.
      expect(screen.queryByRole("combobox", { name: /^Log in as/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: /^Object type/ })).not.toBeInTheDocument();
      expect(
        screen.getByText(/^Logs in as whichever credential the action or crawl picks: it opens the login page/),
      ).toBeInTheDocument();
      expect(getField("Login page URL")).toHaveValue("");
      expect(screen.getByRole("heading", { name: "Login form selectors (optional)" })).toBeInTheDocument();
      expect(getField("Username field selector")).toHaveValue("");
      expect(getField("Password field selector")).toHaveValue("");
      expect(getField("Submit button selector")).toHaveValue("");
    });

    it("can be submitted without picking a credential, and submits none", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderActionForm({
        initialValues: { ...FILLED_VALUES, userActionKind: "login" },
        loginChoices: { ...LOGIN_CHOICES_WITHOUT_LOGIN_ACTION, credentials: [] },
      });

      expect(getSubmitButton()).toBeEnabled();
      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ credentialId: null, userActionKind: "login" }));
    });

    it("submits a null credential even for a Login action saved with one", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderActionForm({
        initialValues: { ...SAVED_LOGIN_ACTION_VALUES, credentialId: "credential-1" },
      });

      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith(SAVED_LOGIN_ACTION_VALUES);
    });

    it("makes the login page optional when the website has one, offering it, and submits a blank one as null", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderActionForm({
        initialValues: { ...FILLED_VALUES, userActionKind: "login" },
      });

      const loginUrlField = getField("Login page URL");
      expect(loginUrlField).not.toBeRequired();
      expect(loginUrlField).toHaveAttribute("placeholder", WEBSITE_LOGIN_URL);
      expect(loginUrlField).toHaveAccessibleDescription(describeLoginPageHelp(WEBSITE_LOGIN_URL));
      await user.type(getField("Username field selector"), "   ");
      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith({
        ...FILLED_VALUES,
        credentialId: null,
        loginUrl: null,
        usernameSelector: null,
        passwordSelector: null,
        submitSelector: null,
        userActionKind: "login",
        userObjectTypeKey: null,
        userNameParameterKey: null,
      });
    });

    it("requires the login page when the website has none, then submits the typed one trimmed", async () => {
      const user = userEvent.setup();
      const { onSubmit, formElement } = renderActionForm({
        initialValues: { ...FILLED_VALUES, userActionKind: "login" },
        loginChoices: { ...LOGIN_CHOICES_WITHOUT_LOGIN_ACTION, websiteLoginUrl: null },
      });

      const loginUrlField = getField("Login page URL");
      expect(loginUrlField).toBeRequired();
      expect(loginUrlField).toHaveAttribute("placeholder", "https://example.com/login");
      expect(loginUrlField).toHaveAccessibleDescription(describeLoginPageHelp(null));
      expect(getSubmitButton()).toBeDisabled();
      fireEvent.submit(formElement);
      expect(onSubmit).not.toHaveBeenCalled();

      await user.type(loginUrlField, "   ");
      expect(getSubmitButton()).toBeDisabled();
      await user.paste("https://example.com/sign-in  ");
      expect(getSubmitButton()).toBeEnabled();
      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ credentialId: null, loginUrl: "https://example.com/sign-in" }),
      );
    });

    it("starts a saved Login action on its login page and selectors, and submits the edits trimmed", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderActionForm({ initialValues: SAVED_LOGIN_ACTION_VALUES });

      expect(screen.getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Login");
      expect(getField("Login page URL")).toHaveValue("https://example.com/admin/login");
      expect(getField("Username field selector")).toHaveValue("#email");
      expect(getField("Password field selector")).toHaveValue("");
      expect(getField("Submit button selector")).toHaveValue("button.sign-in");

      await user.type(getField("Password field selector"), "  #password  ");
      await user.clear(getField("Submit button selector"));
      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith({
        ...SAVED_LOGIN_ACTION_VALUES,
        passwordSelector: "#password",
        submitSelector: null,
      });
    });

    it("sends the Login-only fields null, and the picked credential, once the kind is switched away from Login", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderActionForm({ initialValues: SAVED_LOGIN_ACTION_VALUES });

      await pickOption(user, /^Kind/, "Read");
      expect(screen.queryByLabelText(/^Login page URL/)).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Logged out (no login)");
      await pickCredential(user, "Viewer");
      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith({
        ...SAVED_LOGIN_ACTION_VALUES,
        ...LOGGED_OUT_LOGIN_FIELDS,
        credentialId: "credential-2",
        userActionKind: "read",
      });
    });

    it("drops the picked credential and object type once the kind is switched to Login", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderActionForm({
        initialValues: {
          ...FILLED_VALUES,
          credentialId: "credential-1",
          userActionKind: "read",
          userObjectTypeKey: "/projects/{project}",
        },
      });
      expect(screen.getByRole("combobox", { name: /^Object type/ })).toHaveTextContent("Project");
      expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Admin");

      await pickOption(user, /^Kind/, "Login");
      await user.click(getSubmitButton());

      expect(onSubmit).toHaveBeenCalledWith({
        ...FILLED_VALUES,
        ...LOGGED_OUT_LOGIN_FIELDS,
        ...DETECT_EVERY_ROLE_CHOICE,
        userActionKind: "login",
      });
    });
  });
});
