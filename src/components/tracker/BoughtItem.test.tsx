import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation } from "convex/react";
import { getFunctionName } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  BoughtItemActions,
  BoughtItemDialog,
  BoughtItemStatus,
} from "./BoughtItem";

vi.mock("convex/react", () => ({ useMutation: vi.fn() }));

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

describe("where a bought item is up to", () => {
  it("shows the three states with the current one pressed", () => {
    render(<BoughtItemStatus item={item({ status: "ordered" })} />);
    expect(screen.getByRole("button", { name: "Ordered" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Needed" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks one ordered in a single press", async () => {
    const user = userEvent.setup();
    render(<BoughtItemStatus item={item()} />);
    await user.click(screen.getByRole("button", { name: "Ordered" }));
    expect(setStatus).toHaveBeenCalledWith({ id: "c_1", status: "ordered" });
  });

  it("marks one arrived, which is what makes it ready to assemble", async () => {
    const user = userEvent.setup();
    render(<BoughtItemStatus item={item({ status: "ordered" })} />);
    await user.click(screen.getByRole("button", { name: "Arrived" }));
    expect(setStatus).toHaveBeenCalledWith({ id: "c_1", status: "arrived" });
  });

  it("clears the due date when it goes back to needed", async () => {
    // It isn't on its way any more, so a date for its arrival is a lie.
    const user = userEvent.setup();
    render(
      <BoughtItemStatus
        item={item({ status: "ordered", eta: 1800000000000 })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Needed" }));
    expect(setStatus).toHaveBeenCalledWith({
      id: "c_1",
      status: "needed",
      eta: null,
    });
  });

  it("only asks when it's due once something is ordered", () => {
    const { rerender } = render(<BoughtItemStatus item={item()} />);
    expect(
      screen.queryByLabelText('When Compliant wheel, 2" is due'),
    ).not.toBeInTheDocument();

    rerender(<BoughtItemStatus item={item({ status: "ordered" })} />);
    expect(
      screen.getByLabelText('When Compliant wheel, 2" is due'),
    ).toBeInTheDocument();
  });

  it("says so when the change is refused", async () => {
    const user = userEvent.setup();
    setStatus.mockRejectedValueOnce(new Error("Nope."));
    render(<BoughtItemStatus item={item()} />);
    await user.click(screen.getByRole("button", { name: "Ordered" }));
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

describe("removing one", () => {
  it("is offered to a lead", async () => {
    const user = userEvent.setup();
    render(<BoughtItemActions item={item()} canRemove />);
    await user.click(screen.getByLabelText('Remove Compliant wheel, 2"'));
    expect(remove).toHaveBeenCalledWith({ id: "c_1" });
  });

  it("isn't offered to anyone else", () => {
    render(<BoughtItemActions item={item()} canRemove={false} />);
    expect(
      screen.queryByLabelText('Remove Compliant wheel, 2"'),
    ).not.toBeInTheDocument();
    // Editing still is — anyone can correct a quantity or a vendor.
    expect(
      screen.getByLabelText('Edit Compliant wheel, 2"'),
    ).toBeInTheDocument();
  });
});
