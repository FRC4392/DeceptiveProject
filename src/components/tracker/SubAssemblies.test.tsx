import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import {
  AssemblyMembers,
  BuiltCounter,
  type AssemblyRow,
} from "./SubAssemblies";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useMutation: vi.fn(), useQuery: vi.fn() }));

const setMembers = vi.fn().mockResolvedValue(undefined);
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

const EMPTY_DEMAND = {
  units: [],
  shortfalls: [],
  underbuilt: [],
  allowance: [],
  loose: [],
};

beforeEach(() => {
  setMembers.mockClear();
  setQtyBuilt.mockClear();
  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
  ) => {
    if (getFunctionName(ref) === getFunctionName(api.subAssemblies.demand)) {
      return EMPTY_DEMAND;
    }
    return undefined;
  }) as unknown as typeof useQuery);
  vi.mocked(useMutation).mockImplementation((ref) => {
    const name = getFunctionName(ref);
    if (name === getFunctionName(api.subAssemblies.setMembers))
      return setMembers as never;
    if (name === getFunctionName(api.subAssemblies.setQtyBuilt))
      return setQtyBuilt as never;
    return vi.fn() as never;
  });
});

/** Point the demand query at a specific set of per-member ceilings. */
function withAllowance(allowance: { refId: string; max: number }[]) {
  vi.mocked(useQuery).mockImplementation(((
    ref: Parameters<typeof useQuery>[0],
  ) => {
    if (getFunctionName(ref) === getFunctionName(api.subAssemblies.demand)) {
      return { ...EMPTY_DEMAND, allowance };
    }
    return undefined;
  }) as unknown as typeof useQuery);
}

function renderMembers(rows: AssemblyRow[] = [ROOT, FRAME], selected = 0) {
  return render(
    <AssemblyMembers
      selected={rows[selected]}
      rows={rows}
      parts={PARTS}
      cots={COTS}
    />,
  );
}

describe("what a sub-assembly is made of", () => {
  it("offers the subsystem's parts and bought items", () => {
    renderMembers();
    expect(screen.getByText("Side Plate")).toBeInTheDocument();
    expect(screen.getByText("Roller Shaft")).toBeInTheDocument();
    expect(screen.getByText("Compliant wheel")).toBeInTheDocument();
  });

  it("adds a part, keeping the children it already holds", async () => {
    const user = userEvent.setup();
    renderMembers([
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
    renderMembers();
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
    renderMembers([
      ROOT,
      { ...FRAME, childIds: ["sa_root"] as Id<"subAssemblies">[] },
    ]);
    expect(screen.getByText("holds this one")).toBeInTheDocument();
  });

  it("says where else a part is used, and still offers it", async () => {
    const user = userEvent.setup();
    renderMembers([
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
    renderMembers([
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

  it("select all leaves alone what the plan has none of left", async () => {
    const user = userEvent.setup();
    // Frame has taken the only Side Plate going; two Roller Shafts are free.
    withAllowance([
      { refId: "pt_1", max: 0 },
      { refId: "pt_2", max: 2 },
      { refId: "c_1", max: 1 },
    ]);
    renderMembers([
      { ...ROOT, partIds: [] },
      { ...FRAME, partIds: ["pt_1"] as Id<"parts">[] },
    ]);

    await user.click(screen.getByLabelText("Select every part"));

    // pt_1 is absent entirely rather than quietly taken at one, which is how
    // it used to end up promised twice.
    expect(setMembers).toHaveBeenCalledWith({
      id: ROOT.assembly._id,
      partIds: ["pt_2"],
      cotsItemIds: ["c_1"],
      childIds: [],
      quantities: [{ refId: "pt_2", quantity: 2 }],
    });
  });

  it("counts select all against what's actually on offer", () => {
    withAllowance([
      { refId: "pt_1", max: 0 },
      { refId: "pt_2", max: 1 },
      { refId: "c_1", max: 1 },
    ]);
    renderMembers([{ ...ROOT, partIds: [] }, FRAME]);
    // Two of the three, because one has nothing left.
    expect(screen.getByText("0 of 2")).toBeInTheDocument();
  });

  it("says when there's none of something left, but still offers it", () => {
    withAllowance([
      { refId: "pt_1", max: 0 },
      { refId: "pt_2", max: 1 },
      { refId: "c_1", max: 1 },
    ]);
    renderMembers([
      { ...ROOT, partIds: [] },
      { ...FRAME, partIds: ["pt_1"] as Id<"parts">[] },
    ]);
    expect(screen.getByText(/none left/)).toBeInTheDocument();
    // Sharing stays a thing you can choose; the shortfall list is what warns.
    expect(screen.getAllByRole("checkbox")[1]).not.toBeDisabled();
  });

  it("waits for the ceilings before offering select all", () => {
    vi.mocked(useQuery).mockImplementation(
      (() => undefined) as unknown as typeof useQuery,
    );
    renderMembers();
    expect(screen.getByLabelText("Select every part")).toBeDisabled();
  });

  it("records how many of a part this assembly uses", async () => {
    const user = userEvent.setup();
    renderMembers([{ ...ROOT, partIds: ["pt_1"] as Id<"parts">[] }]);

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

  it("says when nothing is waiting on part of the subsystem", () => {
    vi.mocked(useQuery).mockImplementation(((
      ref: Parameters<typeof useQuery>[0],
    ) => {
      if (getFunctionName(ref) === getFunctionName(api.subAssemblies.demand)) {
        return {
          ...EMPTY_DEMAND,
          loose: [
            {
              refId: "pt_2",
              kind: "part" as const,
              label: "27-INT-002 Roller Shaft",
              planned: 1,
              claimed: 0,
            },
          ],
        };
      }
      return undefined;
    }) as unknown as typeof useQuery);

    renderMembers();
    expect(
      screen.getByText(/isn't fully accounted for by any sub-assembly/),
    ).toBeInTheDocument();
  });

  it("needs a second sub-assembly before one can go inside another", () => {
    renderMembers([ROOT]);
    expect(
      screen.getByText("Add another sub-assembly to put one inside this."),
    ).toBeInTheDocument();
  });
});

describe("how many of it get built", () => {
  it("counts them up the way a part counts what's been made", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BuiltCounter
        assembly={assembly("sa_root", "27-INT-000", "Intake", {
          qtyNeeded: 2,
          qtySpares: 1,
          qtyBuilt: 1,
        })}
        onChange={onChange}
      />,
    );

    // One of three: neither done nor untouched.
    expect(screen.getByText("1/3")).toBeInTheDocument();
    await user.click(screen.getByLabelText("One more built"));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("won't count past what's being built", () => {
    render(
      <BuiltCounter
        assembly={assembly("sa_root", "27-INT-000", "Intake", {
          qtyNeeded: 1,
          qtyBuilt: 1,
        })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("One more built")).toBeDisabled();
  });
});
