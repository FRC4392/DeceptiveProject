// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

function identity(subject: string, role: "mentor" | "student" = "student") {
  return { subject, issuer: ISSUER, email: `${subject}@example.com`, role };
}

/** A mentor, and the 2027 season first run would have given them. */
async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  return mentor;
}

type Mentor = Awaited<ReturnType<typeof setup>>;

/** The part number a fresh part in `code` gets, to prove which year is live. */
async function makePart(mentor: Mentor, code: string, name: string) {
  const subsystems = await mentor.query(api.subsystems.list, {});
  const processes = await mentor.query(api.shop.listProcessTypes, {});
  const { partNumber } = await mentor.mutation(api.parts.createWithNumber, {
    subsystemId: subsystems.find((s) => s.code === code)!._id,
    name,
    processTypeId: processes.find((p) => p.name === "CNC router")!._id,
    qtyNeeded: 1,
  });
  return partNumber;
}

describe("what a season is seeded with", () => {
  test("no bought process, so nothing can be made Ready to assemble unbought", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const processes = await mentor.query(api.shop.listProcessTypes, {});

    // A bought process used to be seeded, and picking it put a part straight
    // at stage 5 — in the bin, as far as "Can we build it yet?" was
    // concerned, before anybody had ordered the thing. Bought items go to the
    // Ordering board now.
    expect(processes.some((p) => p.isBought)).toBe(false);
    expect(processes.map((p) => p.name)).toEqual([
      "CNC router",
      "Mill",
      "Lathe",
      "Bandsaw + drill",
      "3D print",
    ]);
  });
});

describe("adding a season", () => {
  test("a new year starts with Drivetrain and its 000 assembly, and nothing else", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);

    await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
      makeActive: true,
    });

    const subsystems = await mentor.query(api.subsystems.list, {});
    expect(subsystems.map((s) => s.code)).toEqual(["DRV"]);

    const assemblies = await mentor.query(api.subAssemblies.list, {
      subsystemId: subsystems[0]._id,
    });
    expect(assemblies).toHaveLength(1);
    expect(assemblies[0].assembly.partNumber).toBe("28-DRV-000");
    expect(assemblies[0].assembly.isDefault).toBe(true);

    // Nothing is carried across — a new year is a clean board.
    expect(await mentor.query(api.parts.list, {})).toEqual([]);
  });

  test("first run still lays down the usual five", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);

    const subsystems = await mentor.query(api.subsystems.list, {});
    expect(subsystems.map((s) => s.code)).toEqual([
      "DRV",
      "INT",
      "ELV",
      "SHT",
      "CLB",
    ]);
  });

  test("adding a season doesn't switch the team onto it", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);

    await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });

    const active = await mentor.query(api.seasons.active, {});
    expect(active?.year).toBe("27");
    // Still looking at 2027, so still five subsystems.
    const subsystems = await mentor.query(api.subsystems.list, {});
    expect(subsystems).toHaveLength(5);
  });

  test("two seasons can't share a year", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);

    await expect(
      mentor.mutation(api.seasons.create, { year: "27", name: "Again" }),
    ).rejects.toThrow(/already exists/);
    // Whitespace doesn't buy you a second 27 either.
    await expect(
      mentor.mutation(api.seasons.create, { year: " 27 ", name: "Again" }),
    ).rejects.toThrow(/already exists/);
  });

  test("a season keeps the right to its own year, but can't take another's", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });

    // Renaming 28 to 28 is a no-op, not a clash with itself.
    await mentor.mutation(api.seasons.update, { id: id28, year: "28" });
    await expect(
      mentor.mutation(api.seasons.update, { id: id28, year: "27" }),
    ).rejects.toThrow(/already exists/);
  });

  test("only a mentor may add a season or switch", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });

    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    await expect(
      student.mutation(api.seasons.create, { year: "29", name: "2029" }),
    ).rejects.toThrow(/mentor/);
    await expect(
      student.mutation(api.seasons.setActive, { id: id28 }),
    ).rejects.toThrow(/mentor/);
  });

  test("list puts the newest year first", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    await mentor.mutation(api.seasons.create, { year: "28", name: "2028" });
    await mentor.mutation(api.seasons.create, { year: "26", name: "2026" });

    const seasons = await mentor.query(api.seasons.list, {});
    expect(seasons.map((s) => s.year)).toEqual(["28", "27", "26"]);
  });
});

describe("switching seasons", () => {
  test("the whole team moves, and everything comes back on the way home", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);

    const subsystems = await mentor.query(api.subsystems.list, {});
    const intake = subsystems.find((s) => s.code === "INT")!;
    await makePart(mentor, "INT", "Side plate");
    await mentor.mutation(api.todos.create, { title: "Pack the cart" });
    await mentor.mutation(api.cots.create, {
      subsystemId: intake._id,
      name: "Bearing",
      qtyNeeded: 4,
    });

    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: id28 });

    expect(await mentor.query(api.parts.list, {})).toEqual([]);
    expect(await mentor.query(api.todos.list, {})).toEqual([]);
    expect(await mentor.query(api.cots.list, {})).toEqual([]);
    expect(
      (await mentor.query(api.subsystems.list, {})).map((s) => s.code),
    ).toEqual(["DRV"]);

    const seasons = await mentor.query(api.seasons.list, {});
    const id27 = seasons.find((s) => s.year === "27")!._id;
    await mentor.mutation(api.seasons.setActive, { id: id27 });

    expect(await mentor.query(api.parts.list, {})).toHaveLength(1);
    expect(await mentor.query(api.todos.list, {})).toHaveLength(1);
    expect(await mentor.query(api.cots.list, {})).toHaveLength(1);
    expect(await mentor.query(api.subsystems.list, {})).toHaveLength(5);
  });

  test("exactly one season is active after a switch", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });

    await mentor.mutation(api.seasons.setActive, { id: id28 });

    const seasons = await mentor.query(api.seasons.list, {});
    expect(seasons.filter((s) => s.active).map((s) => s.year)).toEqual(["28"]);
  });

  test("a new number gets the year of whichever season is current", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);

    expect(await makePart(mentor, "DRV", "Rail")).toBe("27-DRV-001");

    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: id28 });

    // The accepted cost of switching: work added now lands in 2028. And the
    // counter is per season, so 2028 starts at 001 of its own accord.
    expect(await makePart(mentor, "DRV", "Rail")).toBe("28-DRV-001");
  });
});

describe("how numbers are shaped and where they start", () => {
  test("a subsystem can be told where to carry on from", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const subsystems = await mentor.query(api.subsystems.list, {});
    const drv = subsystems.find((s) => s.code === "DRV")!;

    await mentor.mutation(api.subsystems.setNextNumber, {
      subsystemId: drv._id,
      next: 120,
    });

    expect(await makePart(mentor, "DRV", "Rail")).toBe("27-DRV-120");
    expect(await makePart(mentor, "DRV", "Rail two")).toBe("27-DRV-121");
  });

  test("the counter only ever moves forward", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const subsystems = await mentor.query(api.subsystems.list, {});
    const drv = subsystems.find((s) => s.code === "DRV")!;
    await makePart(mentor, "DRV", "Rail");
    await makePart(mentor, "DRV", "Rail two");

    // Winding it back would hand out 27-DRV-001 a second time.
    await expect(
      mentor.mutation(api.subsystems.setNextNumber, {
        subsystemId: drv._id,
        next: 1,
      }),
    ).rejects.toThrow(/never reused/);
  });

  test("only a mentor may seed it", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const subsystems = await mentor.query(api.subsystems.list, {});
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    await expect(
      student.mutation(api.subsystems.setNextNumber, {
        subsystemId: subsystems[0]._id,
        next: 50,
      }),
    ).rejects.toThrow(/mentor/);
  });

  test("widening the padding restamps the 000s and holds for new numbers", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const season = (await mentor.query(api.seasons.active, {}))!;

    await mentor.mutation(api.seasons.update, {
      id: season._id,
      numberPad: 4,
    });

    const rows = await mentor.query(api.subAssemblies.list, {
      subsystemId: (await mentor.query(api.subsystems.list, {}))[0]._id,
    });
    expect(rows[0].assembly.partNumber).toBe("27-DRV-0000");
    expect(await makePart(mentor, "DRV", "Rail")).toBe("27-DRV-0001");
  });

  test("the padding is fixed once the season has issued a number", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const season = (await mentor.query(api.seasons.active, {}))!;
    await makePart(mentor, "DRV", "Rail");

    // Mixing 27-DRV-001 and 27-DRV-0002 would stop "1" finding the first.
    await expect(
      mentor.mutation(api.seasons.update, { id: season._id, numberPad: 4 }),
    ).rejects.toThrow(/already issued/);
  });

  test("a silly padding is refused", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const season = (await mentor.query(api.seasons.active, {}))!;
    await expect(
      mentor.mutation(api.seasons.update, { id: season._id, numberPad: 0 }),
    ).rejects.toThrow(/between 1 and 6/);
  });
});
