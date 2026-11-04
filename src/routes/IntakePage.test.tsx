import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { IntakePage } from "./IntakePage";
import { api } from "../../convex/_generated/api";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => vi.fn()),
  useAction: vi.fn(() => vi.fn()),
}));

type Role = "student" | "lead" | "mentor";

/** `undefined` role means the signed-in person is still loading. */
function signedInAs(role: Role | undefined) {
  const asked: string[] = [];
  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
    args?: unknown,
  ) => {
    const name = getFunctionName(ref);
    if (args !== "skip") asked.push(name);
    if (name === getFunctionName(api.auth.currentUser)) {
      return role === undefined
        ? undefined
        : { id: "u1", email: "u1@example.com", name: "Dana", role };
    }
    if (name === getFunctionName(api.intake.list)) return [];
    return undefined;
  }) as unknown as typeof useQuery);
  return asked;
}

function renderPage() {
  render(
    <MemoryRouter>
      <IntakePage />
    </MemoryRouter>,
  );
}

describe("New from Onshape", () => {
  // A block, not an expression: Vitest calls any function `beforeEach`
  // returns as teardown, and `mockReset()` returns the mock itself.
  beforeEach(() => {
    vi.mocked(useQuery).mockReset();
  });

  it("tells a student it's for leads, rather than showing an empty queue", () => {
    const asked = signedInAs("student");
    renderPage();
    expect(screen.getByText("Leads only")).toBeInTheDocument();
    expect(screen.queryByText("Nothing waiting.")).not.toBeInTheDocument();
    // And doesn't ask for what it wouldn't be given.
    expect(asked).not.toContain(getFunctionName(api.intake.list));
    expect(asked).not.toContain(getFunctionName(api.settings.budget));
  });

  it("shows a lead the queue", () => {
    signedInAs("lead");
    renderPage();
    expect(screen.queryByText("Leads only")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing waiting.")).toBeInTheDocument();
  });

  it("doesn't flash 'leads only' at a lead before it knows who they are", () => {
    signedInAs(undefined);
    renderPage();
    expect(screen.queryByText("Leads only")).not.toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
