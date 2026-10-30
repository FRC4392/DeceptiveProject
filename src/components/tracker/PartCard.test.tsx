import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PartCard } from "./PartCard";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

function part(overrides: Partial<Doc<"parts">> = {}) {
  return {
    _id: "pt_1" as Id<"parts">,
    _creationTime: 0,
    partNumber: "27-INT-104",
    name: "Intake Side Plate",
    stage: 3,
    qtyNeeded: 2,
    qtySpares: 1,
    qtyMade: 0,
    flags: [],
    ...overrides,
  } as Doc<"parts">;
}

function renderCard(props: Parameters<typeof PartCard>[0]) {
  return render(
    <MemoryRouter>
      <PartCard {...props} />
    </MemoryRouter>,
  );
}

describe("a part card", () => {
  it("says it's up for grabs only when nobody has it", () => {
    renderCard({ part: part() });
    expect(screen.getByText("Up for grabs")).toBeInTheDocument();
  });

  it("names whoever claimed it instead", () => {
    // The bug this pins: a claimed part whose claimant wasn't passed in fell
    // through to the empty label, so My Parts called your own work up for
    // grabs.
    renderCard({
      part: part({ claimedByUserId: "user_1" }),
      claimantName: "Dana Lopez",
    });
    expect(screen.queryByText("Up for grabs")).not.toBeInTheDocument();
    expect(screen.getByText("Dana Lopez")).toBeInTheDocument();
  });

  it("offers an unclaimed part from design onward", () => {
    for (const stage of [1, 2, 3, 4]) {
      const { unmount } = renderCard({ part: part({ stage }) });
      expect(screen.getByText("Up for grabs")).toBeInTheDocument();
      unmount();
    }
  });

  it("says nothing about grabs once it's in the bin", () => {
    renderCard({ part: part({ stage: 5 }) });
    expect(screen.queryByText("Up for grabs")).not.toBeInTheDocument();
  });

  it("shows the count made once it's being made", () => {
    renderCard({ part: part({ stage: 3, qtyMade: 1 }) });
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("shows what's needed before that", () => {
    renderCard({ part: part({ stage: 1 }) });
    expect(screen.getByText("Need 2 + 1 spare")).toBeInTheDocument();
  });
});
