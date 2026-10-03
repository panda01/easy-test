import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WebsiteItemSummary from "../../src/components/WebsiteItemSummary";
import { type WebsiteItemDeletion } from "../../src/hooks/useWebsiteItemDeletion";
import { ACTION_KIND } from "../../src/utils/websiteItemKinds";
import { buildWebsiteItemRecord } from "./support/frontendTestHelpers";

/**
 * Builds the delete wiring with every handler a spy and the dialog closed.
 * @param overrides - Fields to replace
 * @returns A complete WebsiteItemDeletion
 */
function buildDeletion(overrides: Partial<WebsiteItemDeletion> = {}): WebsiteItemDeletion {
  return {
    deleteDialogIsOpen: false,
    isDeleting: false,
    deleteErrorMessage: null,
    openDeleteDialog: vi.fn(),
    closeDeleteDialog: vi.fn(),
    confirmDelete: vi.fn(),
    ...overrides,
  };
}

describe("WebsiteItemSummary", () => {
  it("shows the kind, the title, an Edit link carrying the return state, and the description", () => {
    render(
      <MemoryRouter>
        <WebsiteItemSummary
          itemKind={ACTION_KIND}
          websiteId="website-1"
          item={buildWebsiteItemRecord()}
          editLinkState={{ returnTo: "/websites/website-1/actions/item-1" }}
          deletion={buildDeletion()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/websites/website-1/actions/item-1/edit",
    );
    expect(screen.getByText("Sign in with a valid account")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks to open the delete dialog, and shows it when it is open", async () => {
    const user = userEvent.setup();
    const deletion = buildDeletion();
    const { rerender } = render(
      <MemoryRouter>
        <WebsiteItemSummary
          itemKind={ACTION_KIND}
          websiteId="website-1"
          item={buildWebsiteItemRecord()}
          editLinkState={{ returnTo: "/" }}
          deletion={deletion}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deletion.openDeleteDialog).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <WebsiteItemSummary
          itemKind={ACTION_KIND}
          websiteId="website-1"
          item={buildWebsiteItemRecord()}
          editLinkState={{ returnTo: "/" }}
          deletion={buildDeletion({ deleteDialogIsOpen: true, deleteErrorMessage: "Action not found" })}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("dialog", { name: "Delete action?" })).toHaveTextContent(
      "Action not found",
    );
  });
});
