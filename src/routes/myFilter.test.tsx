import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { PartsBoardPage } from "./PartsBoardPage";
import { TodoBoardPage } from "./TodoBoardPage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => vi.fn()),
}));

const part = (id: string, name: string, claimedByUserId?: string) =>
  ({
    _id: id as Id<"parts">,
    _creationTime: 0,
    partNumber: `27-INT-10${id.slice(-1)}`,
    name,
    stage: 3,
    qtyNeeded: 1,
    qtySpares: 0,
    qtyMade: 0,
    claimedByUserId,
    subsystemId: "sub_int" as Id<"subsystems">,
    processTypeId: "p_router" as Id<"processTypes">,
    flags: [],
  }) as unknown as Doc<"parts">;

const todo = (id: string, title: string, claimedByUserId?: string) =>
  ({
    _id: id as Id<"todos">,
    _creationTime: 0,
    seasonId: "s1" as Id<"seasons">,
    title,
    tagIds: [],
    priority: "medium",
    claimedByUserId,
  }) as unknown as Doc<"todos">;

/** `signedIn` undefined means the signed-in person is still loading. */
function world(signedIn: "dana" | undefined) {
  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
  ) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.auth.currentUser)) {
      return (
        signedIn && { id: signedIn, email: "", name: "Dana", role: "student" }
      );
    }
    if (name === getFunctionName(api.seasons.active)) {
      return { _id: "s1", year: "27", name: "2027", active: true };
    }
    if (name === getFunctionName(api.parts.list)) {
      return [
        part("pt_1", "UNCLAIMED PART"),
        part("pt_2", "DANAS PART", "dana"),
        part("pt_3", "SAMS PART", "sam"),
      ];
    }
    if (name === getFunctionName(api.todos.list)) {
      return [
        todo("td_1", "UNCLAIMED TODO"),
        todo("td_2", "DANAS TODO", "dana"),
        todo("td_3", "SAMS TODO", "sam"),
      ];
    }
    return [];
  }) as unknown as typeof useQuery);
}

const shown = (names: string[]) =>
  names.filter((n) => screen.queryByText(n) !== null);

describe("the 'My parts' filter", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReset();
  });

  it("shows only your parts", async () => {
    world("dana");
    render(
      <MemoryRouter>
        <PartsBoardPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("My parts"));
    expect(shown(["UNCLAIMED PART", "DANAS PART", "SAMS PART"])).toEqual([
      "DANAS PART",
    ]);
  });

  // An unclaimed part's claimant is `undefined`, and so was "you" until you
  // loaded — so this used to show every unclaimed part and hide your own.
  it("shows nothing rather than every unclaimed part while you're loading", async () => {
    world(undefined);
    render(
      <MemoryRouter>
        <PartsBoardPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("My parts"));
    expect(shown(["UNCLAIMED PART", "DANAS PART", "SAMS PART"])).toEqual([]);
  });
});

describe("the 'mine' filter on the to-do list", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReset();
  });

  it("shows only your to-dos", async () => {
    world("dana");
    render(
      <MemoryRouter>
        <TodoBoardPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /mine/i }));
    expect(shown(["UNCLAIMED TODO", "DANAS TODO", "SAMS TODO"])).toEqual([
      "DANAS TODO",
    ]);
  });

  it("shows nothing rather than every unclaimed to-do while you're loading", async () => {
    world(undefined);
    render(
      <MemoryRouter>
        <TodoBoardPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /mine/i }));
    expect(shown(["UNCLAIMED TODO", "DANAS TODO", "SAMS TODO"])).toEqual([]);
  });
});
