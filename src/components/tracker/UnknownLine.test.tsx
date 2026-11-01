import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { UnknownLine } from "./UnknownLine";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

const applyLine = vi.fn().mockResolvedValue(null);
const createCotsItem = vi.fn().mockResolvedValue("c_new");

const SUBSYSTEM = "sub_int" as Id<"subsystems">;
const ROUTER = "pt_router" as Id<"processTypes">;
const BOUGHT = "pt_bought" as Id<"processTypes">;

function line(overrides: Partial<Doc<"releaseIntakeLines">> = {}) {
  return {
    _id: "rl_1" as Id<"releaseIntakeLines">,
    _creationTime: 0,
    intakeId: "ri_1" as Id<"releaseIntakes">,
    name: "Compliant wheel",
    kind: "unknown",
    subsystemId: SUBSYSTEM,
    ...overrides,
  } as Doc<"releaseIntakeLines">;
}

beforeEach(() => {
  applyLine.mockClear();
  createCotsItem.mockClear();
  vi.mocked(useMutation).mockImplementation(((ref: never) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.intake.applyLine)) return applyLine;
    if (name === getFunctionName(api.intake.createCotsItemFromLine))
      return createCotsItem;
    return vi.fn();
  }) as unknown as typeof useMutation);
  vi.mocked(useQuery).mockImplementation(((ref: never) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.subsystems.list))
      return [{ _id: SUBSYSTEM, name: "Intake", code: "INT", order: 0 }];
    if (name === getFunctionName(api.shop.listProcessTypes))
      return [
        { _id: ROUTER, name: "CNC router", needsDrawing: true, order: 0 },
        { _id: BOUGHT, name: "Bought (COTS)", isBought: true, order: 5 },
      ];
    return undefined;
  }) as unknown as typeof useQuery);
});

describe("answering a line the tracker doesn't know", () => {
  it("asks whether the team makes it or buys it", () => {
    render(<UnknownLine line={line()} />);
    expect(screen.getByRole("button", { name: "We make it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "We buy it" })).toBeTruthy();
  });

  it("starts on Make it, with the fields a part needs", () => {
    render(<UnknownLine line={line()} />);
    expect(
      screen
        .getByRole("button", { name: "We make it" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByLabelText("Made on")).toBeTruthy();
    expect(screen.getByText("Spares")).toBeTruthy();
  });

  it("stops offering a bought process, now that Buy it exists", async () => {
    // Picking it used to make a part at "Ready to assemble" — in the bin, as
    // far as the tracker was concerned, before anybody had ordered it.
    const user = userEvent.setup();
    render(<UnknownLine line={line()} />);
    await user.click(screen.getByLabelText("Made on"));
    expect(screen.getByText("CNC router")).toBeTruthy();
    expect(screen.queryByText("Bought (COTS)")).toBeNull();
  });

  it("drops the process and spares once it's something bought", async () => {
    const user = userEvent.setup();
    render(<UnknownLine line={line()} />);
    await user.click(screen.getByRole("button", { name: "We buy it" }));

    expect(screen.queryByLabelText("Made on")).toBeNull();
    expect(screen.queryByText("Spares")).toBeNull();
    expect(screen.getByText("Vendor")).toBeTruthy();
    expect(screen.getByText("How many")).toBeTruthy();
  });

  it("sends what the lead typed to the Ordering board", async () => {
    const user = userEvent.setup();
    render(<UnknownLine line={line({ quantity: 4, partNumber: "am-3104" })} />);
    await user.click(screen.getByRole("button", { name: "We buy it" }));
    await user.type(screen.getByLabelText("Vendor"), "AndyMark");
    await user.click(screen.getByRole("button", { name: "Add to Ordering" }));

    expect(createCotsItem).toHaveBeenCalledWith({
      lineId: "rl_1",
      subsystemId: SUBSYSTEM,
      qtyNeeded: 4,
      vendor: "AndyMark",
      vendorPartNumber: "am-3104",
    });
    expect(applyLine).not.toHaveBeenCalled();
  });

  it("answers Buy it first when the BOM named a vendor", () => {
    render(<UnknownLine line={line({ vendor: "McMaster" })} />);
    expect(
      screen
        .getByRole("button", { name: "We buy it" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByLabelText("Vendor").getAttribute("value")).toBe(
      "McMaster",
    );
  });

  it("answers Buy it first for library hardware out of the CAD", () => {
    render(<UnknownLine line={line({ standardContent: true })} />);
    expect(
      screen
        .getByRole("button", { name: "We buy it" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("still makes a part the normal way", async () => {
    const user = userEvent.setup();
    render(<UnknownLine line={line({ quantity: 2 })} />);
    await user.click(screen.getByRole("button", { name: "Add to the board" }));

    expect(applyLine).toHaveBeenCalledWith(
      expect.objectContaining({
        lineId: "rl_1",
        decision: "created",
        qtyNeeded: 2,
        qtySpares: 0,
      }),
    );
    expect(createCotsItem).not.toHaveBeenCalled();
  });

  it("shows what went wrong rather than failing silently", async () => {
    createCotsItem.mockRejectedValueOnce(new Error("That subsystem is gone."));
    const user = userEvent.setup();
    render(<UnknownLine line={line()} />);
    await user.click(screen.getByRole("button", { name: "We buy it" }));
    await user.click(screen.getByRole("button", { name: "Add to Ordering" }));

    expect(await screen.findByText("That subsystem is gone.")).toBeTruthy();
  });
});
