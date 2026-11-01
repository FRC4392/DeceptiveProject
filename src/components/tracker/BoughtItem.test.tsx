import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation } from "convex/react";
import { getFunctionName } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { BoughtItemDetail, BoughtItemDialog } from "./BoughtItem";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  // The dialog offers a subsystem picker when it isn't told which one.
  useQuery: vi.fn(() => [
    { _id: "sub_int", name: "Intake", code: "INT", order: 0 },
  ]),
}));

const setStatus = vi.fn().mockResolvedValue(undefined);
const create = vi.fn().mockResolvedValue("c_new");
const update = vi.fn().mockResolvedValue(undefined);
const remove = vi.fn().mockResolvedValue(undefined);

const SUBSYSTEM = "sub_int" as Id<"subsystems">;

function item(overrides: Partial<Doc<"cotsItems">> = {}) {
  return {
    _id: "c_1" as Id<"cotsItems">,
    _creationTime: 0,
    seasonId: "se_1" as Id<"seasons">,
    subsystemId: SUBSYSTEM,
    name: 'Compliant wheel, 2"',
    qtyNeeded: 12,
    status: "needed",
    ...overrides,
  } as Doc<"cotsItems">;
}

beforeEach(() => {
  for (const fn of [setStatus, create, update, remove]) fn.mockClear();
  vi.mocked(useMutation).mockImplementation(((ref: never) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.cots.setStatus)) return setStatus;
    if (name === getFunctionName(api.cots.create)) return create;
    if (name === getFunctionName(api.cots.update)) return update;
    if (name === getFunctionName(api.cots.remove)) return remove;
    return vi.fn();
  }) as unknown as typeof useMutation);
});

function openDetail(item: Doc<"cotsItems">, canEdit = true) {
  return render(
    <BoughtItemDetail
      item={item}
      subsystemName="Intake"
      open
      onOpenChange={() => {}}
      canEdit={canEdit}
    />,
  );
}

describe("opening a bought item", () => {
  it("moves it on with one button, worded like a part's", async () => {
    const user = userEvent.setup();
    openDetail(item());
    await user.click(
      screen.getByRole("button", { name: "Placed the order → Ordered" }),
    );
    expect(setStatus).toHaveBeenCalledWith({ id: "c_1", status: "ordered" });
  });

  it("the next press is the one that makes it ready to assemble", async () => {
    const user = userEvent.setup();
    openDetail(item({ status: "ordered" }));
    await user.click(
      screen.getByRole("button", { name: "It turned up → Arrived" }),
    );
    expect(setStatus).toHaveBeenCalledWith({ id: "c_1", status: "arrived" });
  });

  it("offers nothing to press once it's here", () => {
    openDetail(item({ status: "arrived" }));
    expect(
      screen.getByText("In the shop, and ready to go on."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /turned up|Placed the order/ }),
    ).not.toBeInTheDocument();
  });

  it("shows what was bought and what it cost", () => {
    openDetail(
      item({ vendor: "AndyMark", vendorPartNumber: "am-1234", cost: 4.5 }),
    );
    expect(screen.getByText("AndyMark")).toBeInTheDocument();
    expect(screen.getByText("am-1234")).toBeInTheDocument();
    // Twelve at 4.50 — the number somebody has to justify.
    expect(screen.getByText("4.50 each · 54.00 total")).toBeInTheDocument();
  });

  it("lets a lead move it back", async () => {
    const user = userEvent.setup();
    openDetail(item({ status: "ordered", eta: 1800000000000 }));
    await user.click(screen.getByRole("button", { name: "Move it back" }));
    // The server clears the stamps; the button just says which way to go.
    expect(setStatus).toHaveBeenCalledWith({ id: "c_1", status: "needed" });
  });

  it("doesn't offer moving back or deleting to anyone else", () => {
    openDetail(item({ status: "ordered" }), false);
    expect(
      screen.queryByRole("button", { name: "Move it back" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    // Editing is still there — anyone can correct a quantity.
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("deletes when a lead says so", async () => {
    const user = userEvent.setup();
    openDetail(item());
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith({ id: "c_1" });
  });

  it("shows no dates on something nobody has bought yet", () => {
    openDetail(item());
    expect(
      screen.queryByLabelText(/was ordered|is expected|arrived/),
    ).not.toBeInTheDocument();
  });

  it("shows when it was ordered, and when it's expected", () => {
    openDetail(item({ status: "ordered", orderedAt: 1800000000000 }));
    expect(
      screen.getByLabelText('When Compliant wheel, 2" was ordered'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('When Compliant wheel, 2" is expected'),
    ).toBeInTheDocument();
  });

  it("shows when it arrived, and stops asking when it's expected", () => {
    openDetail(
      item({
        status: "arrived",
        orderedAt: 1800000000000,
        arrivedAt: 1800100000000,
      }),
    );
    expect(
      screen.getByLabelText('When Compliant wheel, 2" arrived'),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('When Compliant wheel, 2" is expected'),
    ).not.toBeInTheDocument();
  });

  it("a date can be corrected afterwards", async () => {
    const user = userEvent.setup();
    openDetail(item({ status: "arrived", arrivedAt: 1800000000000 }));
    const field = screen.getByLabelText('When Compliant wheel, 2" arrived');
    await user.clear(field);
    await user.type(field, "2026-03-03");
    expect(setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "c_1", status: "arrived" }),
    );
  });

  it("says so when the move is refused", async () => {
    const user = userEvent.setup();
    setStatus.mockRejectedValueOnce(new Error("Nope."));
    openDetail(item());
    await user.click(
      screen.getByRole("button", { name: "Placed the order → Ordered" }),
    );
    expect(await screen.findByText("Nope.")).toBeInTheDocument();
  });
});

describe("adding one", () => {
  it("needs only a name", async () => {
    const user = userEvent.setup();
    render(
      <BoughtItemDialog open onOpenChange={() => {}} subsystemId={SUBSYSTEM} />,
    );
    await user.type(screen.getByLabelText("What is it"), "Bearing");
    await user.click(screen.getByRole("button", { name: "Add it" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        subsystemId: SUBSYSTEM,
        name: "Bearing",
        qtyNeeded: 1,
      }),
    );
  });

  it("won't add one with no name", () => {
    render(
      <BoughtItemDialog open onOpenChange={() => {}} subsystemId={SUBSYSTEM} />,
    );
    expect(screen.getByRole("button", { name: "Add it" })).toBeDisabled();
  });

  it("keeps the vendor details when they're given", async () => {
    const user = userEvent.setup();
    render(
      <BoughtItemDialog open onOpenChange={() => {}} subsystemId={SUBSYSTEM} />,
    );
    await user.type(screen.getByLabelText("What is it"), "Bearing");
    await user.type(screen.getByLabelText("Vendor"), "REV");
    await user.type(screen.getByLabelText("Their part number"), "REV-11-1234");
    await user.click(screen.getByRole("button", { name: "Add it" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: "REV",
        vendorPartNumber: "REV-11-1234",
      }),
    );
  });

  it("edits an existing one instead of adding another", async () => {
    const user = userEvent.setup();
    render(
      <BoughtItemDialog
        open
        onOpenChange={() => {}}
        subsystemId={SUBSYSTEM}
        item={item({ vendor: "AndyMark" })}
      />,
    );
    expect(screen.getByLabelText("Vendor")).toHaveValue("AndyMark");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c_1", qtyNeeded: 12 }),
    );
    expect(create).not.toHaveBeenCalled();
  });
});
