import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { MyPartsPage } from "./MyPartsPage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));

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
    if (name === getFunctionName(api.users.list)) return ROSTER;
    if (name === getFunctionName(api.shop.listProcessTypes)) {
      return [{ _id: "p_router", name: "CNC router", order: 0 }];
    }
    return [];
  }) as unknown as typeof useQuery);
});

describe("My parts", () => {
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
