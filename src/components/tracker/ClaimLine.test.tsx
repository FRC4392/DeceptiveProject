import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { CLAIM_COPY } from "./ClaimLine";
import { PartCard } from "./PartCard";
import { TodoCard } from "./TodoCard";
import { IssueCard } from "./IssueCard";
import { SubAssemblyCard } from "./SubAssemblyCard";

const ME = "user_me";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => ({
    id: ME,
    email: "me@example.com",
    name: "Dana Lopez",
    role: "student",
  })),
  useMutation: vi.fn(() => vi.fn()),
}));

function part(overrides: Partial<Doc<"parts">> = {}) {
  return {
    _id: "pt_1" as Id<"parts">,
    _creationTime: 0,
    partNumber: "27-INT-104",
    name: "Intake Side Plate",
    stage: 3,
    qtyNeeded: 2,
    qtySpares: 0,
    qtyMade: 0,
    flags: [],
    ...overrides,
  } as Doc<"parts">;
}

function todo(overrides: Partial<Doc<"todos">> = {}) {
  return {
    _id: "td_1" as Id<"todos">,
    _creationTime: 0,
    title: "Order more rivets",
    priority: "medium",
    tagIds: [],
    ...overrides,
  } as Doc<"todos">;
}

function issue(overrides: Partial<Doc<"issues">> = {}) {
  return {
    _id: "is_1" as Id<"issues">,
    _creationTime: 0,
    source: "manual",
    title: "Drive code stalls",
    state: "open",
    labels: [],
    assigneeLogins: [],
    isPullRequest: false,
    priority: "medium",
    ...overrides,
  } as Doc<"issues">;
}

function assembly(overrides: Partial<Doc<"subAssemblies">> = {}) {
  return {
    _id: "sa_1" as Id<"subAssemblies">,
    _creationTime: 0,
    subsystemId: "sub_int" as Id<"subsystems">,
    seasonId: "se_1" as Id<"seasons">,
    partNumber: "27-INT-005",
    partNumberKey: "27INT005",
    name: "Intake frame",
    order: 1,
    isDefault: false,
    ...overrides,
  } as Doc<"subAssemblies">;
}

const status = {
  id: "sa_1",
  ready: false,
  done: false,
  members: [],
  blocking: [],
};

function show(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/**
 * Hand the cards a stand-in for whatever mutation they reach for, and return
 * it so a test can see what it was called with. The real hook's return value
 * carries `withOptimisticUpdate`, which nothing here needs.
 */
function stubMutation(impl?: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.mocked(useMutation).mockReturnValue(
    fn as unknown as ReactMutation<FunctionReference<"mutation">>,
  );
  return fn;
}

/**
 * The four things a person can pick up live in four tables and four screens.
 * These sweep all of them at once, because the bug being guarded against
 * isn't any single card being wrong — it's them drifting apart, which only
 * shows up when you put them side by side.
 */
const CARDS: Array<{
  what: string;
  unclaimed: () => React.ReactElement;
  claimed: () => React.ReactElement;
  finished: () => React.ReactElement;
}> = [
  {
    what: "a part",
    unclaimed: () => <PartCard part={part()} />,
    claimed: () => (
      <PartCard part={part({ claimedByUserId: ME })} claimantName="Dana" />
    ),
    // Past the bin a part goes on with its assembly, so it stops being
    // anyone's to pick up.
    finished: () => <PartCard part={part({ stage: 6 })} />,
  },
  {
    what: "a to-do",
    unclaimed: () => <TodoCard todo={todo()} tags={[]} />,
    claimed: () => (
      <TodoCard
        todo={todo({ claimedByUserId: ME })}
        tags={[]}
        claimantName="Dana"
      />
    ),
    finished: () => <TodoCard todo={todo({ doneAt: 1 })} tags={[]} />,
  },
  {
    what: "an issue",
    unclaimed: () => <IssueCard issue={issue()} />,
    claimed: () => (
      <IssueCard issue={issue({ claimedByUserId: ME })} claimantName="Dana" />
    ),
    finished: () => <IssueCard issue={issue({ state: "closed" })} />,
  },
  {
    what: "a sub-assembly",
    unclaimed: () => (
      <SubAssemblyCard
        assembly={assembly()}
        status={status}
        canComplete={false}
        isLead={false}
      />
    ),
    claimed: () => (
      <SubAssemblyCard
        assembly={assembly({ claimedByUserId: ME })}
        status={status}
        claimantName="Dana"
        canComplete={false}
        isLead={false}
      />
    ),
    finished: () => (
      <SubAssemblyCard
        assembly={assembly()}
        status={{ ...status, done: true }}
        canComplete={false}
        isLead={false}
      />
    ),
  },
];

describe("every card that can be picked up", () => {
  it.each(CARDS)("$what says when nobody has it", ({ unclaimed }) => {
    show(unclaimed());
    expect(screen.getByText(CLAIM_COPY.nobody)).toBeInTheDocument();
  });

  it.each(CARDS)("$what offers a one-press claim", ({ unclaimed }) => {
    show(unclaimed());
    expect(
      screen.getByRole("button", { name: CLAIM_COPY.claim }),
    ).toBeInTheDocument();
  });

  it.each(CARDS)("$what names whoever has it instead", ({ claimed }) => {
    show(claimed());
    expect(screen.getByText(/Dana/)).toBeInTheDocument();
    expect(screen.queryByText(CLAIM_COPY.nobody)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: CLAIM_COPY.claim }),
    ).not.toBeInTheDocument();
  });

  it.each(CARDS)("$what lets you hand yours back", ({ claimed }) => {
    show(claimed());
    expect(
      screen.getByRole("button", { name: CLAIM_COPY.release }),
    ).toBeInTheDocument();
  });

  it.each(CARDS)(
    "$what stops asking for a volunteer once it's finished",
    ({ finished }) => {
      show(finished());
      expect(screen.queryByText(CLAIM_COPY.nobody)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: CLAIM_COPY.claim }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("pressing it", () => {
  it("claims without opening the card it sits on", async () => {
    // The card body is a link; the button inside it must not navigate.
    const claimed = stubMutation();

    show(<PartCard part={part()} />);
    await userEvent.click(
      screen.getByRole("button", { name: CLAIM_COPY.claim }),
    );

    expect(claimed).toHaveBeenCalledWith({ partId: "pt_1" });
    expect(window.location.pathname).toBe("/");
  });

  it("says so when the claim is refused", async () => {
    stubMutation(() =>
      Promise.reject(new Error("Someone else already has it.")),
    );

    show(<PartCard part={part()} />);
    await userEvent.click(
      screen.getByRole("button", { name: CLAIM_COPY.claim }),
    );

    expect(
      await screen.findByText("Someone else already has it."),
    ).toBeInTheDocument();
  });
});

describe("the row itself", () => {
  it("disappears rather than leaving an empty line under a finished card", () => {
    // A done sub-assembly nobody claimed, seen by someone who can't reopen
    // it: there is nothing to say and nothing to offer.
    const { container } = show(
      <SubAssemblyCard
        assembly={assembly()}
        status={{ ...status, done: true }}
        canComplete={false}
        isLead={false}
      />,
    );
    expect(container.querySelector(".border-t")).toBeNull();
  });

  it("still draws when a finished card has something left to offer", () => {
    const { container } = show(
      <SubAssemblyCard
        assembly={assembly()}
        status={{ ...status, done: true }}
        canComplete={false}
        isLead
      />,
    );
    expect(container.querySelector(".border-t")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });
});
