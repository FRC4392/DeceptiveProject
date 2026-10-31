import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { SubAssemblyEditor, type AssemblyRow } from "./SubAssemblies";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useMutation: vi.fn(), useQuery: vi.fn() }));

const create = vi
  .fn()
  .mockResolvedValue({ id: "sa_new", partNumber: "27-INT-009" });
const rename = vi.fn().mockResolvedValue(undefined);
const remove = vi.fn().mockResolvedValue(undefined);
const setMembers = vi.fn().mockResolvedValue(undefined);
const setDrawing = vi.fn().mockResolvedValue(undefined);
const setUnits = vi.fn().mockResolvedValue(undefined);
const setQtyBuilt = vi.fn().mockResolvedValue(undefined);

const SUBSYSTEM = "sub_int" as Id<"subsystems">;

function part(id: string, partNumber: string, name: string) {
  return { _id: id as Id<"parts">, partNumber, name } as Doc<"parts">;
}

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

const PARTS = [
  part("pt_1", "27-INT-001", "Side Plate"),
  part("pt_2", "27-INT-002", "Roller Shaft"),
];
const COTS = [
  {
    _id: "c_1" as Id<"cotsItems">,
    name: "Compliant wheel",
  } as Doc<"cotsItems">,
];

const ROOT: AssemblyRow = {
  assembly: assembly("sa_root", "27-INT-000", "Intake", { isDefault: true }),
  partIds: ["pt_1"] as Id<"parts">[],
  cotsItemIds: [],
  childIds: [],
  quantities: [],
};
const FRAME: AssemblyRow = {
  assembly: assembly("sa_frame", "27-INT-004", "Frame", { order: 1 }),
  partIds: [],
  cotsItemIds: [],
  childIds: [],
  quantities: [],
};

beforeEach(() => {
  for (const fn of [
    create,
    rename,
    remove,
    setMembers,
    setDrawing,
    setUnits,
    setQtyBuilt,
  ]) {
    fn.mockClear();
  }
  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
  ) => {
    if (getFunctionName(ref) === getFunctionName(api.subAssemblies.demand)) {
      return { units: [], shortfalls: [], underbuilt: [], allowance: [] };
    }
    return { partIds: [], cotsItemIds: [] };
  }) as unknown as typeof useQuery);
  vi.mocked(useMutation).mockImplementation((ref) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.subAssemblies.create))
      return create as never;
    if (name === getFunctionName(api.subAssemblies.rename))
      return rename as never;
    if (name === getFunctionName(api.subAssemblies.remove))
      return remove as never;
    if (name === getFunctionName(api.subAssemblies.setMembers))
      return setMembers as never;
    if (name === getFunctionName(api.subAssemblies.setDrawing))
      return setDrawing as never;
    if (name === getFunctionName(api.subAssemblies.setUnits))
      return setUnits as never;
    if (name === getFunctionName(api.subAssemblies.setQtyBuilt))
      return setQtyBuilt as never;
    return vi.fn() as never;
  });
});

function renderEditor(rows: AssemblyRow[] = [ROOT, FRAME]) {
  return render(
    <SubAssemblyEditor
      subsystemId={SUBSYSTEM}
      rows={rows}
      parts={PARTS}
      cots={COTS}
      onDone={vi.fn()}
    />,
  );
}

describe("the sub-assembly editor", () => {
  it("edits one at a time, starting with the default", () => {
    renderEditor();
    expect(screen.getByLabelText("Sub-assembly name")).toHaveValue("Intake");
    expect(screen.getByText("whole thing")).toBeInTheDocument();
  });

  it("offers the subsystem's parts and bought items", () => {
    renderEditor();
    expect(screen.getByText("Side Plate")).toBeInTheDocument();
    expect(screen.getByText("Roller Shaft")).toBeInTheDocument();
    expect(screen.getByText("Compliant wheel")).toBeInTheDocument();
  });

  it("adds a part, keeping the children it already holds", async () => {
    const user = userEvent.setup();
    renderEditor([
      { ...ROOT, childIds: ["sa_frame"] as Id<"subAssemblies">[] },
      FRAME,
    ]);
    // Box 0 is select-all; 1 and 2 are the parts.
    await user.click(screen.getAllByRole("checkbox")[2]);

    expect(setMembers).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      partIds: ["pt_1", "pt_2"],
      cotsItemIds: [],
      childIds: ["sa_frame"],
      quantities: [],
    });
  });

  it("puts one sub-assembly inside another", async () => {
    const user = userEvent.setup();
    renderEditor();
    // select-all, two parts, one bought item, then the children.
    await user.click(screen.getAllByRole("checkbox")[4]);

    expect(setMembers).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      partIds: ["pt_1"],
      cotsItemIds: [],
      childIds: ["sa_frame"],
      quantities: [],
    });
  });

  it("won't offer one that already holds this one", () => {
    // Frame holds the root, so the root can't also hold Frame.
    renderEditor([
      ROOT,
      { ...FRAME, childIds: ["sa_root"] as Id<"subAssemblies">[] },
    ]);
    expect(screen.getByText("holds this one")).toBeInTheDocument();
  });

  it("says where else a part is used, and still offers it", async () => {
    const user = userEvent.setup();
    renderEditor([
      { ...ROOT, partIds: [] },
      { ...FRAME, partIds: ["pt_1"] as Id<"parts">[] },
    ]);
    // Frame uses pt_1. That's worth knowing, not worth forbidding.
    expect(screen.getByText("also in Frame")).toBeInTheDocument();

    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(setMembers).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      partIds: ["pt_1"],
      cotsItemIds: [],
      childIds: [],
      quantities: [],
    });
  });

  it("select all takes everything, shared or not", async () => {
    const user = userEvent.setup();
    renderEditor([
      { ...ROOT, partIds: [] },
      { ...FRAME, partIds: ["pt_1"] as Id<"parts">[] },
    ]);
    await user.click(screen.getByLabelText("Select every part"));
    expect(setMembers).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      partIds: ["pt_1", "pt_2"],
      cotsItemIds: ["c_1"],
      childIds: [],
      quantities: [],
    });
  });

  it("records how many of a part this assembly uses", async () => {
    const user = userEvent.setup();
    renderEditor([{ ...ROOT, partIds: ["pt_1"] as Id<"parts">[] }]);

    const box = screen.getByLabelText("How many 27-INT-001");
    await user.clear(box);
    await user.type(box, "2");

    expect(setMembers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: ROOT.assembly._id,
        quantities: [{ refId: "pt_1", quantity: 2 }],
      }),
    );
  });

  it("the default has no remove control", () => {
    renderEditor();
    expect(screen.queryByLabelText("Remove Intake")).not.toBeInTheDocument();
  });

  it("adds a new sub-assembly", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText("New sub-assembly"), "Rollers");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(create).toHaveBeenCalledWith({
      subsystemId: SUBSYSTEM,
      name: "Rollers",
    });
  });

  it("saves a drawing link when the field loses focus", async () => {
    const user = userEvent.setup();
    renderEditor();
    const field = screen.getByLabelText("Assembly drawing link");
    await user.type(field, "https://example.com/intake.pdf");
    await user.tab();
    expect(setDrawing).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      url: "https://example.com/intake.pdf",
    });
  });

  it("says when there's no CAD linked yet", () => {
    renderEditor();
    expect(screen.getByText(/No CAD linked yet/)).toBeInTheDocument();
  });

  it("links the CAD once a sync has filled the ids in", () => {
    renderEditor([
      {
        ...ROOT,
        assembly: assembly("sa_root", "27-INT-000", "Intake", {
          isDefault: true,
          onshapeDocumentId: "doc1",
          onshapeVersionId: "v1",
          onshapeElementId: "el1",
        }),
      },
    ]);
    expect(screen.getByRole("link", { name: /Assembly CAD/ })).toHaveAttribute(
      "href",
      "https://cad.onshape.com/documents/doc1/v/v1/e/el1",
    );
  });
});

describe("how many of it get built", () => {
  it("takes the number on the robot and the number of spares", async () => {
    const user = userEvent.setup();
    renderEditor();

    const onRobot = screen.getByLabelText("How many go on the robot");
    await user.clear(onRobot);
    await user.type(onRobot, "2");
    await user.tab();
    expect(setUnits).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      qtyNeeded: 2,
    });

    const spares = screen.getByLabelText("Spare units to build");
    await user.clear(spares);
    await user.type(spares, "1");
    await user.tab();
    expect(setUnits).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      qtySpares: 1,
    });
  });

  it("counts them up the way a part counts what's been made", async () => {
    const user = userEvent.setup();
    renderEditor([
      {
        ...ROOT,
        assembly: {
          ...ROOT.assembly,
          qtyNeeded: 2,
          qtySpares: 1,
          qtyBuilt: 1,
        },
      },
    ]);

    // One of three: neither done nor untouched.
    expect(screen.getByText("1/3")).toBeInTheDocument();
    await user.click(screen.getByLabelText("One more built"));
    expect(setQtyBuilt).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      qtyBuilt: 2,
    });
  });

  it("won't count past what's being built", () => {
    renderEditor([
      {
        ...ROOT,
        assembly: { ...ROOT.assembly, qtyNeeded: 1, qtyBuilt: 1 },
      },
    ]);
    expect(screen.getByLabelText("One more built")).toBeDisabled();
  });
});
