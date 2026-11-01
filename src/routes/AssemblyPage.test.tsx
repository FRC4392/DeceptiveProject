import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { AssemblyPage } from "./AssemblyPage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useMutation: vi.fn(), useQuery: vi.fn() }));

const rename = vi.fn().mockResolvedValue(undefined);
const remove = vi.fn().mockResolvedValue(undefined);
const setDrawing = vi.fn().mockResolvedValue(undefined);
const setUnits = vi.fn().mockResolvedValue(undefined);
const setQtyBuilt = vi.fn().mockResolvedValue(undefined);
const addNote = vi.fn().mockResolvedValue(undefined);

const SUBSYSTEM = "sub_int" as Id<"subsystems">;
const ROOT_ID = "sa_root" as Id<"subAssemblies">;
const FRAME_ID = "sa_frame" as Id<"subAssemblies">;

function assembly(
  id: string,
  partNumber: string,
  name: string,
  extra: Partial<Doc<"subAssemblies">> = {},
) {
  return {
    _id: id as Id<"subAssemblies">,
    _creationTime: 0,
    subsystemId: SUBSYSTEM,
    partNumber,
    name,
    order: 0,
    ...extra,
  } as Doc<"subAssemblies">;
}

const ROOT = assembly("sa_root", "27-INT-000", "Intake", { isDefault: true });
const FRAME = assembly("sa_frame", "27-INT-004", "Frame", { order: 1 });

/** What the page sees. Each test tweaks a field or two. */
let world: {
  assembly: Doc<"subAssemblies"> | null | undefined;
  rows: unknown[];
  role: string;
};

function row(a: Doc<"subAssemblies">, childIds: string[] = []) {
  return {
    assembly: a,
    partIds: [],
    cotsItemIds: [],
    childIds,
    quantities: [],
  };
}

beforeEach(() => {
  for (const fn of [
    rename,
    remove,
    setDrawing,
    setUnits,
    setQtyBuilt,
    addNote,
  ]) {
    fn.mockClear();
  }
  world = { assembly: ROOT, rows: [row(ROOT), row(FRAME)], role: "lead" };

  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
  ) => {
    const name = ref ? getFunctionName(ref) : "";
    if (name === getFunctionName(api.subAssemblies.get)) return world.assembly;
    if (name === getFunctionName(api.subAssemblies.list)) return world.rows;
    if (name === getFunctionName(api.subAssemblies.notes)) return [];
    if (name === getFunctionName(api.subAssemblies.history)) return [];
    if (name === getFunctionName(api.subAssemblies.demand)) {
      return {
        units: [],
        shortfalls: [],
        underbuilt: [],
        allowance: [],
        loose: [],
      };
    }
    if (name === getFunctionName(api.parts.list)) return [];
    if (name === getFunctionName(api.cots.list)) return [];
    if (name === getFunctionName(api.subsystems.list)) {
      return [{ _id: SUBSYSTEM, code: "INT", name: "Intake", order: 0 }];
    }
    if (name === getFunctionName(api.users.list)) return [];
    if (name === getFunctionName(api.auth.currentUser)) {
      return {
        id: "user_1",
        email: "lead@example.com",
        name: "Sam Lead",
        role: world.role,
      };
    }
    return undefined;
  }) as unknown as typeof useQuery);

  vi.mocked(useMutation).mockImplementation((ref) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.subAssemblies.rename))
      return rename as never;
    if (name === getFunctionName(api.subAssemblies.remove))
      return remove as never;
    if (name === getFunctionName(api.subAssemblies.setDrawing))
      return setDrawing as never;
    if (name === getFunctionName(api.subAssemblies.setUnits))
      return setUnits as never;
    if (name === getFunctionName(api.subAssemblies.setQtyBuilt))
      return setQtyBuilt as never;
    if (name === getFunctionName(api.subAssemblies.addNote))
      return addNote as never;
    return vi.fn() as never;
  });
});

function renderPage(id: Id<"subAssemblies"> = ROOT_ID) {
  return render(
    <MemoryRouter initialEntries={[`/assemblies/${id}`]}>
      <Routes>
        <Route path="/assemblies/:assemblyId" element={<AssemblyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("a sub-assembly's own page", () => {
  it("names it, numbers it, and says where it's up to", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Intake", level: 1 }),
    ).toBeInTheDocument();
    // Breadcrumb and header chip both carry it, the way a part page does.
    expect(screen.getAllByText("27-INT-000").length).toBeGreaterThan(0);
    expect(screen.getByText("The whole subsystem")).toBeInTheDocument();
  });

  it("says plainly when the id isn't a sub-assembly", () => {
    world.assembly = null;
    renderPage();
    expect(
      screen.getByText("That sub-assembly isn't in the tracker."),
    ).toBeInTheDocument();
  });

  it("saves a new name when the field loses focus", async () => {
    const user = userEvent.setup();
    renderPage();
    const field = screen.getByLabelText("Sub-assembly name");
    await user.clear(field);
    await user.type(field, "Intake v2");
    await user.tab();
    expect(rename).toHaveBeenCalledWith({ id: ROOT_ID, name: "Intake v2" });
  });

  it("saves a drawing link when the field loses focus", async () => {
    const user = userEvent.setup();
    renderPage();
    const field = screen.getByLabelText("Assembly drawing link");
    await user.type(field, "https://example.com/intake.pdf");
    await user.tab();
    expect(setDrawing).toHaveBeenCalledWith({
      id: ROOT_ID,
      url: "https://example.com/intake.pdf",
    });
  });

  it("takes the number on the robot and the number of spares", async () => {
    const user = userEvent.setup();
    renderPage();

    const onRobot = screen.getByLabelText("How many go on the robot");
    await user.clear(onRobot);
    await user.type(onRobot, "2");
    await user.tab();
    expect(setUnits).toHaveBeenCalledWith({ id: ROOT_ID, qtyNeeded: 2 });

    const spares = screen.getByLabelText("Spare units to build");
    await user.clear(spares);
    await user.type(spares, "1");
    await user.tab();
    expect(setUnits).toHaveBeenCalledWith({ id: ROOT_ID, qtySpares: 1 });
  });

  it("counts what's built from the page itself", async () => {
    const user = userEvent.setup();
    world.assembly = assembly("sa_root", "27-INT-000", "Intake", {
      isDefault: true,
      qtyNeeded: 2,
      qtyBuilt: 0,
    });
    world.rows = [row(world.assembly), row(FRAME)];
    renderPage();

    await user.click(screen.getByLabelText("One more built"));
    expect(setQtyBuilt).toHaveBeenCalledWith({ id: ROOT_ID, qtyBuilt: 1 });
  });

  it("keeps the 000 undeletable", () => {
    renderPage();
    expect(screen.queryByText("Delete this sub-assembly")).toBeNull();
  });

  it("lets a lead delete any other one", () => {
    world.assembly = FRAME;
    renderPage(FRAME_ID);
    expect(screen.getByText("Delete this sub-assembly")).toBeInTheDocument();
  });

  it("says when nothing holds it", () => {
    world.assembly = FRAME;
    renderPage(FRAME_ID);
    expect(
      screen.getByText("Not in any sub-assembly, so nothing is waiting on it."),
    ).toBeInTheDocument();
  });

  it("names the assembly that holds it, and how many it takes", () => {
    world.assembly = FRAME;
    world.rows = [
      {
        ...row(ROOT, ["sa_frame"]),
        quantities: [{ refId: "sa_frame", quantity: 2 }],
      },
      row(FRAME),
    ];
    renderPage(FRAME_ID);
    // Scoped: the breadcrumb links the subsystem, which the 000 is named for.
    const whereItGoes = screen
      .getByRole("heading", { name: "Where it goes" })
      .closest("section")!;
    expect(
      within(whereItGoes).getByRole("link", { name: /Intake/ }),
    ).toBeInTheDocument();
    expect(within(whereItGoes).getByText("× 2")).toBeInTheDocument();
  });

  it("links the CAD once a sync has filled the ids in", () => {
    world.assembly = assembly("sa_root", "27-INT-000", "Intake", {
      isDefault: true,
      onshapeDocumentId: "doc1",
      onshapeVersionId: "v1",
      onshapeElementId: "el1",
    });
    world.rows = [row(world.assembly), row(FRAME)];
    renderPage();
    expect(screen.getByRole("link", { name: /Assembly CAD/ })).toHaveAttribute(
      "href",
      "https://cad.onshape.com/documents/doc1/v/v1/e/el1",
    );
  });

  it("keeps the details and the member pickers away from a student", () => {
    world.role = "student";
    renderPage();
    expect(screen.queryByLabelText("Sub-assembly name")).toBeNull();
    expect(screen.queryByLabelText("Select every part")).toBeNull();
    // They can still read what it's made of.
    expect(screen.getByText("What it's made of")).toBeInTheDocument();
  });

  it("takes a note", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(
      screen.getByPlaceholderText("Questions, tips, problems…"),
      "Scrapped the first one",
    );
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    expect(addNote).toHaveBeenCalledWith({
      subAssemblyId: ROOT_ID,
      body: "Scrapped the first one",
    });
  });
});
