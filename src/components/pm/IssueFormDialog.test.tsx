import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation } from "convex/react";
import { getFunctionName } from "convex/server";
import { IssueFormDialog } from "./IssueFormDialog";
import { api } from "../../../convex/_generated/api";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
}));


const createIssue = vi.fn().mockResolvedValue(undefined);
const updateIssue = vi.fn().mockResolvedValue(undefined);

beforeAll(() => {
  // Radix Dialog/Select need these in jsdom.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  createIssue.mockClear();
  updateIssue.mockClear();
  vi.mocked(useMutation).mockImplementation((ref) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.github.createManualIssue)) {
      return createIssue as never;
    }
    if (name === getFunctionName(api.github.update)) return updateIssue as never;
    return vi.fn() as never;
  });
});

describe("IssueFormDialog", () => {
  it("creates a manual issue with the entered title and default fields", async () => {
    const user = userEvent.setup();
    render(<IssueFormDialog trigger={<button>New issue</button>} />);

    await user.click(screen.getByRole("button", { name: "New issue" }));
    await user.type(
      await screen.findByLabelText("Title"),
      "Fix drivetrain slop",
    );
    await user.click(screen.getByRole("button", { name: "Create issue" }));

    expect(createIssue).toHaveBeenCalledWith({
      title: "Fix drivetrain slop",
      body: undefined,
      priority: "medium",
      labels: [],
      projectId: undefined,
    });
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("does not submit when the title is blank", async () => {
    const user = userEvent.setup();
    render(<IssueFormDialog trigger={<button>New issue</button>} />);

    await user.click(screen.getByRole("button", { name: "New issue" }));
    expect(await screen.findByRole("button", { name: "Create issue" })).toBeDisabled();
    expect(createIssue).not.toHaveBeenCalled();
  });
});
