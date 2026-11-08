import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import DeleteActionStep from "../../src/components/DeleteActionStep";
import {
  buildActionObjectRoleRecord,
  buildWebsiteItemRecord,
  countRequests,
  stubFetchRoutes,
  type FetchStub,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const PROPOSAL_API_URL = "/api/websites/website-1/actions/item-1/delete-action/proposal";
const DELETE_ACTION_API_URL = "/api/websites/website-1/actions/item-1/delete-action";

/** The Create action the step works for. */
const createAction = buildWebsiteItemRecord({
  title: "Create a project",
  objectRole: buildActionObjectRoleRecord({ kind: "create" }),
});

/** What Claude proposes. */
const proposal = {
  title: "Delete the project",
  description: "Open Projects, open the project, delete it, confirm, check it is gone.",
  modelId: "claude-opus-5-5",
};

/**
 * Stubs the proposal and the create routes, plus any replacements.
 * @param extraRoutes - More replies
 * @returns The installed fetch stub
 */
function stubRoutes(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`POST ${PROPOSAL_API_URL}`]: { status: 200, body: proposal },
    [`POST ${DELETE_ACTION_API_URL}`]: {
      status: 201,
      body: buildWebsiteItemRecord({ id: "item-2", title: "Delete the project" }),
    },
    ...extraRoutes,
  });
}

/**
 * Renders the step with spies for both outcomes.
 * @returns The spies
 */
function renderStep(): { onCreated: ReturnType<typeof vi.fn>; onSkip: ReturnType<typeof vi.fn> } {
  const onCreated = vi.fn();
  const onSkip = vi.fn();
  render(<DeleteActionStep websiteId="website-1" createAction={createAction} onCreated={onCreated} onSkip={onSkip} />);
  return { onCreated, onSkip };
}

describe("DeleteActionStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for the proposal once, explains the step, and pre-fills the form with it", async () => {
    const fetchStub = stubRoutes();
    renderStep();

    expect(screen.getByRole("progressbar", { name: "Proposing the delete action" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Delete the project");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(proposal.description);
    expect(screen.getByText(/Every run of/)).toHaveTextContent("Create a project");
    expect(screen.getByRole("button", { name: "Create delete action" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    expect(countRequests(fetchStub, "POST", PROPOSAL_API_URL)).toBe(1);
  });

  it("POSTs the (edited) delete action and hands the new action back", async () => {
    const user = userEvent.setup();
    const fetchStub = stubRoutes();
    const { onCreated } = renderStep();

    const titleField = await screen.findByRole("textbox", { name: "Title" });
    await user.clear(titleField);
    await user.type(titleField, "Remove the project");
    await user.click(screen.getByRole("button", { name: "Create delete action" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "item-2" }));
    });
    expect(fetchStub).toHaveBeenCalledWith(DELETE_ACTION_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Remove the project", description: proposal.description }),
    });
  });

  it("skips with Skip for now, creating nothing", async () => {
    const user = userEvent.setup();
    const fetchStub = stubRoutes();
    const { onSkip, onCreated } = renderStep();

    await user.click(await screen.findByRole("button", { name: "Skip for now" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(countRequests(fetchStub, "POST", DELETE_ACTION_API_URL)).toBe(0);
  });

  it("shows why the proposal failed, offers Try again, and still lets the user write it by hand", async () => {
    const user = userEvent.setup();
    const fetchStub = stubRoutes({
      [`POST ${PROPOSAL_API_URL}`]: { status: 502, body: { error: "Claude declined to write the delete action" } },
    });
    renderStep();

    expect(
      await screen.findByText(/Claude could not propose the delete action: Claude declined to write the delete action/),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create delete action" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(countRequests(fetchStub, "POST", PROPOSAL_API_URL)).toBe(2);
    });
  });

  it("shows the server's reason when the delete action cannot be created", async () => {
    const user = userEvent.setup();
    stubRoutes({
      [`POST ${DELETE_ACTION_API_URL}`]: { status: 409, body: { error: "This action already has a delete action" } },
    });
    const { onCreated } = renderStep();

    await screen.findByRole("textbox", { name: "Title" });
    await user.click(screen.getByRole("button", { name: "Create delete action" }));

    expect(await screen.findByText("This action already has a delete action")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
