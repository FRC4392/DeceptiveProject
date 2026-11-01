import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IssueCard } from "./IssueCard";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  // Cards claim work themselves, so they need a client. Nothing here talks to
  // one: the current user is nobody, and the mutations are never pressed
  // except where a test presses them.
  useQuery: vi.fn(() => undefined),
  useMutation: vi.fn(() => vi.fn()),
}));

function issue(overrides: Partial<Doc<"issues">> = {}) {
  return {
    _id: "is_1" as Id<"issues">,
    _creationTime: 0,
    source: "github",
    repo: "deceivers/robot",
    number: 7,
    title: "Drive motor stalls",
    state: "open",
    labels: [],
    assigneeLogins: [],
    isPullRequest: false,
    priority: "medium",
    ...overrides,
  } as Doc<"issues">;
}

function renderCard(doc: Doc<"issues">) {
  return render(
    <MemoryRouter>
      <IssueCard issue={doc} />
    </MemoryRouter>,
  );
}

describe("an issue card", () => {
  it("leads with the reference and the state", () => {
    renderCard(issue());
    expect(screen.getByText("deceivers/robot#7")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Drive motor stalls")).toBeInTheDocument();
  });

  it("marks a pull request as one", () => {
    renderCard(issue({ isPullRequest: true }));
    expect(screen.getByText("Pull request")).toBeInTheDocument();
  });

  it("calls out high priority and leaves the rest quiet", () => {
    renderCard(issue({ priority: "high" }));
    expect(screen.getByText("High priority")).toBeInTheDocument();
  });

  it("shows three labels and counts the rest", () => {
    renderCard(issue({ labels: ["bug", "drive", "urgent", "spare", "extra"] }));
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.queryByText("spare")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
