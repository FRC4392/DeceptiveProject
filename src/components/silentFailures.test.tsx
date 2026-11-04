// A write that doesn't go through has to say so. Each of these used to fail
// silently: the click did nothing, and nothing said why.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { QtyCounter } from "@/components/tracker/QtyCounter";
import { TodoCard } from "@/components/tracker/TodoCard";
import { IssueFormDialog } from "@/components/pm/IssueFormDialog";
import { InventoryPage } from "@/routes/InventoryPage";
import type { Doc, Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useAction: vi.fn(),
}));

/** Every mutation refuses, the way the server would. */
function everythingRefuses(message: string) {
  const refuse = vi.fn().mockRejectedValue(new Error(message));
  vi.mocked(useMutation).mockReturnValue(
    refuse as unknown as ReturnType<typeof useMutation>,
  );
  return refuse;
}

beforeEach(() => {
  vi.mocked(useQuery).mockReset();
  vi.mocked(useMutation).mockReset();
});

describe("a write that's refused says so", () => {
  it("on the made counter, next to the machine", async () => {
    everythingRefuses("That part is gone.");
    const part = {
      _id: "pt_1" as Id<"parts">,
      qtyNeeded: 2,
      qtySpares: 0,
      qtyMade: 0,
    } as unknown as Doc<"parts">;
    render(<QtyCounter part={part} />);
    await userEvent.click(screen.getByLabelText("One more made"));
    expect(await screen.findByText("That part is gone.")).toBeInTheDocument();
  });

  it("on a to-do's done box", async () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    everythingRefuses("That to-do is gone.");
    const todo = {
      _id: "td_1" as Id<"todos">,
      title: "Order bearings",
      tagIds: [],
      priority: "medium",
    } as unknown as Doc<"todos">;
    render(
      <MemoryRouter>
        <TodoCard todo={todo} tags={[]} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByLabelText("Finish Order bearings"));
    expect(await screen.findByText("That to-do is gone.")).toBeInTheDocument();
  });

  // It stays open on purpose, so nothing typed is lost — it used to stay
  // open and say nothing.
  it("in the issue form, which stays open with the text still in it", async () => {
    everythingRefuses("Write a title first.");
    const onOpenChange = vi.fn();
    render(<IssueFormDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByLabelText("Title"), "Auton drifts left");
    await userEvent.click(screen.getByRole("button", { name: "Create issue" }));

    expect(await screen.findByText("Write a title first.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Title")).toHaveValue("Auton drifts left");
  });

  it("on the inventory counter", async () => {
    vi.mocked(useQuery).mockReturnValue([
      { _id: "inv_1", name: "M5 bolts", onHandQty: 4 },
    ]);
    everythingRefuses("That item is gone.");
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByLabelText("One fewer M5 bolts"));
    expect(await screen.findByText("That item is gone.")).toBeInTheDocument();
  });
});

describe("the inventory's icon buttons", () => {
  // Icon-only, they announced themselves as just "button".
  it("each say what they do and to what", () => {
    vi.mocked(useQuery).mockReturnValue([
      { _id: "inv_1", name: "M5 bolts", onHandQty: 0 },
    ]);
    everythingRefuses("unused");
    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("One more M5 bolts")).toBeInTheDocument();
    // Nothing on the shelf, so nothing to take off.
    expect(screen.getByLabelText("One fewer M5 bolts")).toBeDisabled();
  });
});
