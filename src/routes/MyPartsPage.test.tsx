import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { MyPartsPage } from "./MyPartsPage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => vi.fn()),
}));

const MINE = [
  {
    _id: "pt_1" as Id<"parts">,
    _creationTime: 0,
    partNumber: "27-INT-104",
    name: "Intake Side Plate",
    stage: 3,
    qtyNeeded: 2,
    qtySpares: 0,
    qtyMade: 0,
    claimedByUserId: "user_1",
    processTypeId: "p_router" as Id<"processTypes">,
    flags: [],
  } as unknown as Doc<"parts">,
];

const ASSEMBLIES = [
  {
    assembly: {
      _id: "sa_1",
      _creationTime: 0,
      subsystemId: "sub_int",
      partNumber: "27-INT-005",
      name: "Intake frame",
      order: 1,
    },
    subsystemName: "Intake",
    ready: false,
    summary: "27-INT-002 not in the bin yet",
  },
] as unknown as never[];

const ROSTER = [
  {
    _id: "u1" as Id<"users">,
    _creationTime: 0,
    authId: "user_1",
    name: "Dana Lopez",
    email: "dana@example.com",
  } as Doc<"users">,
];

beforeEach(() => {
  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
  ) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.parts.listMine)) return MINE;
    if (name === getFunctionName(api.subAssemblies.listMine)) return ASSEMBLIES;
    if (name === getFunctionName(api.users.list)) return ROSTER;
    if (name === getFunctionName(api.shop.listProcessTypes)) {
      return [{ _id: "p_router", name: "CNC router", order: 0 }];
    }
    // The signed-in person, which the cards read to tell "mine" from theirs.
    if (name === getFunctionName(api.auth.currentUser)) {
      return {
        id: "user_1",
        email: "dana@example.com",
        name: "Dana Lopez",
        role: "student",
      };
    }
    return [];
  }) as unknown as typeof useQuery);
});

describe("My parts", () => {
  it("lists the sub-assemblies you've claimed alongside the parts", () => {
    render(
      <MemoryRouter>
        <MyPartsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Sub-assemblies")).toBeInTheDocument();
    expect(screen.getByText("Intake frame")).toBeInTheDocument();
    expect(screen.getByText("27-INT-005")).toBeInTheDocument();
    // It says why it can't go together yet, not just that it can't.
    expect(
      screen.getByText("27-INT-002 not in the bin yet"),
    ).toBeInTheDocument();
  });

  it("names you on your own parts rather than calling them up for grabs", () => {
    render(
      <MemoryRouter>
        <MyPartsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Intake Side Plate")).toBeInTheDocument();
    expect(screen.getByText("Dana Lopez")).toBeInTheDocument();
    expect(screen.queryByText("Up for grabs")).not.toBeInTheDocument();
  });
});
