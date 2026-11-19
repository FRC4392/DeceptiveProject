// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";
const DAY = 24 * 60 * 60 * 1000;
// Schedule days are calendar dates, stored as Date.UTC of the date.
const MAR_1 = Date.UTC(2027, 2, 1);

function identity(subject: string, role: "mentor" | "student" = "student") {
  return { subject, issuer: ISSUER, email: `${subject}@example.com`, role };
}

async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  const student = t.withIdentity(identity("student_1"));
  await student.mutation(api.auth.storeCurrentUser, {});
  const lead = t.withIdentity(identity("lead_1"));
  await lead.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.shop.setUserRole, {
    userId: "lead_1",
    role: "lead",
  });
  return { mentor, student, lead };
}

describe("who can change the schedule", () => {
  test("a student reads it but can't change it", async () => {
    const t = convexTest(schema, modules);
    const { student, lead } = await setup(t);
    const phaseId = await lead.mutation(api.schedule.createPhase, {
      name: "Design",
    });
    const taskId = await lead.mutation(api.schedule.createTask, {
      phaseId,
      name: "Drivetrain CAD",
      start: MAR_1,
      end: MAR_1 + 6 * DAY,
    });

    const seen = await student.query(api.schedule.get, {});
    expect(seen.phases.map((p) => p.name)).toEqual(["Design"]);
    expect(seen.tasks.map((t) => t.name)).toEqual(["Drivetrain CAD"]);

    const refused = /lead or mentor/i;
    await expect(
      student.mutation(api.schedule.createPhase, { name: "Build" }),
    ).rejects.toThrow(refused);
    await expect(
      student.mutation(api.schedule.updateTask, { id: taskId, done: true }),
    ).rejects.toThrow(refused);
    await expect(
      student.mutation(api.schedule.removeTask, { id: taskId }),
    ).rejects.toThrow(refused);
    await expect(
      student.mutation(api.schedule.removePhase, { id: phaseId }),
    ).rejects.toThrow(refused);
  });

  test("nobody signed out sees anything", async () => {
    const t = convexTest(schema, modules);
    const { lead } = await setup(t);
    await lead.mutation(api.schedule.createPhase, { name: "Design" });
    expect(await t.query(api.schedule.get, {})).toEqual({
      phases: [],
      tasks: [],
      milestones: [],
    });
  });
});

describe("editing", () => {
  test("a lead adds, moves, finishes and renames a task", async () => {
    const t = convexTest(schema, modules);
    const { lead } = await setup(t);
    const design = await lead.mutation(api.schedule.createPhase, {
      name: "Design",
    });
    const build = await lead.mutation(api.schedule.createPhase, {
      name: "Build",
    });
    const id = await lead.mutation(api.schedule.createTask, {
      phaseId: design,
      name: "  Intake CAD  ",
      start: MAR_1,
      end: MAR_1 + 6 * DAY,
    });

    await lead.mutation(api.schedule.updateTask, {
      id,
      name: "Intake CAD v2",
      start: MAR_1 + 2 * DAY,
      end: MAR_1 + 9 * DAY,
      phaseId: build,
      done: true,
    });
    let [task] = (await lead.query(api.schedule.get, {})).tasks;
    expect(task.name).toBe("Intake CAD v2");
    expect(task.start).toBe(MAR_1 + 2 * DAY);
    expect(task.end).toBe(MAR_1 + 9 * DAY);
    expect(task.phaseId).toBe(build);
    expect(task.doneAt).toBeTypeOf("number");

    // Only the end moves; the start it already had stays.
    await lead.mutation(api.schedule.updateTask, {
      id,
      end: MAR_1 + 12 * DAY,
      done: false,
    });
    [task] = (await lead.query(api.schedule.get, {})).tasks;
    expect(task.start).toBe(MAR_1 + 2 * DAY);
    expect(task.end).toBe(MAR_1 + 12 * DAY);
    expect(task.doneAt).toBeUndefined();
  });

  test("a task can't end before it starts, or go unnamed", async () => {
    const t = convexTest(schema, modules);
    const { lead } = await setup(t);
    const phaseId = await lead.mutation(api.schedule.createPhase, {
      name: "Design",
    });
    await expect(
      lead.mutation(api.schedule.createTask, {
        phaseId,
        name: "Backwards",
        start: MAR_1 + DAY,
        end: MAR_1,
      }),
    ).rejects.toThrow(/can't end before it starts/i);

    const id = await lead.mutation(api.schedule.createTask, {
      phaseId,
      name: "One day",
      start: MAR_1,
      end: MAR_1,
    });
    // Moving only the end, behind the start it already has.
    await expect(
      lead.mutation(api.schedule.updateTask, { id, end: MAR_1 - DAY }),
    ).rejects.toThrow(/can't end before it starts/i);
    await expect(
      lead.mutation(api.schedule.updateTask, { id, name: "   " }),
    ).rejects.toThrow(/give the task a name/i);
    await expect(
      lead.mutation(api.schedule.createPhase, { name: "" }),
    ).rejects.toThrow(/give the phase a name/i);
  });

  test("moving swaps a row with its neighbour", async () => {
    const t = convexTest(schema, modules);
    const { lead } = await setup(t);
    const a = await lead.mutation(api.schedule.createPhase, { name: "A" });
    const b = await lead.mutation(api.schedule.createPhase, { name: "B" });
    const names = async () =>
      (await lead.query(api.schedule.get, {})).phases.map((p) => p.name);

    await lead.mutation(api.schedule.movePhase, { id: b, direction: "up" });
    expect(await names()).toEqual(["B", "A"]);
    // Already at the top: nothing to swap with, and no error.
    await lead.mutation(api.schedule.movePhase, { id: b, direction: "up" });
    expect(await names()).toEqual(["B", "A"]);

    const x = await lead.mutation(api.schedule.createTask, {
      phaseId: a,
      name: "X",
      start: MAR_1,
      end: MAR_1,
    });
    await lead.mutation(api.schedule.createTask, {
      phaseId: a,
      name: "Y",
      start: MAR_1,
      end: MAR_1,
    });
    await lead.mutation(api.schedule.moveTask, { id: x, direction: "down" });
    expect(
      (await lead.query(api.schedule.get, {})).tasks.map((t) => t.name),
    ).toEqual(["Y", "X"]);
  });

  test("removing a phase takes its tasks with it", async () => {
    const t = convexTest(schema, modules);
    const { lead } = await setup(t);
    const design = await lead.mutation(api.schedule.createPhase, {
      name: "Design",
    });
    const build = await lead.mutation(api.schedule.createPhase, {
      name: "Build",
    });
    for (const phaseId of [design, design, build]) {
      await lead.mutation(api.schedule.createTask, {
        phaseId,
        name: "Task",
        start: MAR_1,
        end: MAR_1,
      });
    }

    await lead.mutation(api.schedule.removePhase, { id: design });
    const after = await lead.query(api.schedule.get, {});
    expect(after.phases.map((p) => p.name)).toEqual(["Build"]);
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0].phaseId).toBe(build);
  });
});

describe("seasons", () => {
  test("a schedule belongs to its season", async () => {
    const t = convexTest(schema, modules);
    const { mentor, lead } = await setup(t);
    const phaseId = await lead.mutation(api.schedule.createPhase, {
      name: "Design",
    });
    const taskId = await lead.mutation(api.schedule.createTask, {
      phaseId,
      name: "CAD",
      start: MAR_1,
      end: MAR_1,
    });

    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: id28 });

    const seen = await lead.query(api.schedule.get, {});
    expect(seen.phases).toEqual([]);
    expect(seen.tasks).toEqual([]);

    // A screen left open on last season can't change it from this one.
    await expect(
      lead.mutation(api.schedule.updateTask, { id: taskId, done: true }),
    ).rejects.toThrow(/another season/i);
    await expect(
      lead.mutation(api.schedule.createTask, {
        phaseId,
        name: "Sneaky",
        start: MAR_1,
        end: MAR_1,
      }),
    ).rejects.toThrow(/another season/i);
  });

  test("the season's events come back as milestones", async () => {
    const t = convexTest(schema, modules);
    const { mentor, student } = await setup(t);
    await mentor.mutation(api.competitions.create, {
      name: "Week 1",
      date: MAR_1 + 20 * DAY,
    });
    const { milestones } = await student.query(api.schedule.get, {});
    expect(milestones.map((m) => m.name)).toEqual(["Week 1"]);
  });
});

describe("waiting for other tasks", () => {
  async function chain(t: ReturnType<typeof convexTest>) {
    const { lead, student } = await setup(t);
    const phaseId = await lead.mutation(api.schedule.createPhase, {
      name: "Build",
    });
    const add = (name: string, from: number, days: number) =>
      lead.mutation(api.schedule.createTask, {
        phaseId,
        name,
        start: MAR_1 + from * DAY,
        end: MAR_1 + (from + days - 1) * DAY,
      });
    // Frame: Mar 1–5. Wiring: Mar 8–10. Testing: Mar 20–21.
    const frame = await add("Frame", 0, 5);
    const wiring = await add("Wiring", 7, 3);
    const testing = await add("Testing", 19, 2);
    const get = async () => {
      const { tasks } = await lead.query(api.schedule.get, {});
      return Object.fromEntries(tasks.map((x) => [x.name, x]));
    };
    return { lead, student, frame, wiring, testing, get };
  }

  test("waiting for a task lines it up the day after, keeping its length", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, get } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: wiring,
      dependsOn: [frame],
    });
    const { Wiring } = await get();
    expect(Wiring.dependsOn).toEqual([frame]);
    expect(Wiring.start).toBe(MAR_1 + 5 * DAY);
    expect(Wiring.end).toBe(MAR_1 + 7 * DAY);
  });

  test("a delay pushes everything downstream, and finishing early pulls it back", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, testing, get } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: wiring,
      dependsOn: [frame],
    });
    await lead.mutation(api.schedule.updateTask, {
      id: testing,
      dependsOn: [wiring],
    });
    // Wiring Mar 6–8, so Testing Mar 9–10.
    expect((await get()).Testing.start).toBe(MAR_1 + 8 * DAY);

    // Frame slips three days.
    await lead.mutation(api.schedule.updateTask, {
      id: frame,
      end: MAR_1 + 7 * DAY,
    });
    let now = await get();
    expect(now.Wiring.start).toBe(MAR_1 + 8 * DAY);
    expect(now.Wiring.end).toBe(MAR_1 + 10 * DAY);
    expect(now.Testing.start).toBe(MAR_1 + 11 * DAY);
    expect(now.Testing.end).toBe(MAR_1 + 12 * DAY);

    // Then comes in two days early: everything follows it back.
    await lead.mutation(api.schedule.updateTask, {
      id: frame,
      end: MAR_1 + 2 * DAY,
    });
    now = await get();
    expect(now.Wiring.start).toBe(MAR_1 + 3 * DAY);
    expect(now.Testing.start).toBe(MAR_1 + 6 * DAY);
  });

  test("a task waits for the last of several to finish", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, testing, get } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: testing,
      dependsOn: [frame, wiring],
    });
    // Wiring ends Mar 10, after Frame's Mar 5.
    expect((await get()).Testing.start).toBe(MAR_1 + 10 * DAY);
  });

  test("moving a waiting task too early is kept, not refused", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, get } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: wiring,
      dependsOn: [frame],
    });
    await lead.mutation(api.schedule.updateTask, {
      id: wiring,
      start: MAR_1 + 2 * DAY,
      end: MAR_1 + 4 * DAY,
    });
    const { Wiring } = await get();
    expect(Wiring.start).toBe(MAR_1 + 2 * DAY);
  });

  test("a finished task stays where it was, and stops the push there", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, testing, get } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: wiring,
      dependsOn: [frame],
    });
    await lead.mutation(api.schedule.updateTask, {
      id: testing,
      dependsOn: [wiring],
    });
    await lead.mutation(api.schedule.updateTask, { id: wiring, done: true });
    const before = await get();
    await lead.mutation(api.schedule.updateTask, {
      id: frame,
      end: MAR_1 + 9 * DAY,
    });
    const after = await get();
    expect(after.Wiring.start).toBe(before.Wiring.start);
    expect(after.Testing.start).toBe(before.Testing.start);
  });

  test("two tasks can't wait for each other, even the long way round", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, testing } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: wiring,
      dependsOn: [frame],
    });
    await lead.mutation(api.schedule.updateTask, {
      id: testing,
      dependsOn: [wiring],
    });
    await expect(
      lead.mutation(api.schedule.updateTask, {
        id: frame,
        dependsOn: [testing],
      }),
    ).rejects.toThrow(/"Testing" already waits for "Frame"/);
    await expect(
      lead.mutation(api.schedule.updateTask, { id: frame, dependsOn: [frame] }),
    ).rejects.toThrow(/can't wait for itself/);
  });

  test("removing a task, or its phase, takes it off what waited for it", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame, wiring, testing, get } = await chain(t);
    await lead.mutation(api.schedule.updateTask, {
      id: testing,
      dependsOn: [frame, wiring],
    });
    const start = (await get()).Testing.start;
    await lead.mutation(api.schedule.removeTask, { id: wiring });
    let now = await get();
    expect(now.Testing.dependsOn).toEqual([frame]);
    // Losing what it waited for doesn't move it.
    expect(now.Testing.start).toBe(start);

    const other = await lead.mutation(api.schedule.createPhase, {
      name: "Other",
    });
    await lead.mutation(api.schedule.updateTask, {
      id: frame,
      phaseId: other,
    });
    await lead.mutation(api.schedule.removePhase, { id: other });
    now = await get();
    expect(now.Testing.dependsOn).toBeUndefined();
  });

  test("a student can't change what a task waits for", async () => {
    const t = convexTest(schema, modules);
    const { student, frame, wiring } = await chain(t);
    await expect(
      student.mutation(api.schedule.updateTask, {
        id: wiring,
        dependsOn: [frame],
      }),
    ).rejects.toThrow(/lead or mentor/i);
  });

  test("dates that aren't whole days are refused", async () => {
    const t = convexTest(schema, modules);
    const { lead, frame } = await chain(t);
    await expect(
      lead.mutation(api.schedule.updateTask, {
        id: frame,
        start: MAR_1 + 5 * 60 * 60 * 1000,
      }),
    ).rejects.toThrow(/don't look right/);
  });
});

test("old local-midnight dates round to the same calendar day", async () => {
  const t = convexTest(schema, modules);
  const { lead } = await setup(t);
  const phaseId = await lead.mutation(api.schedule.createPhase, {
    name: "Old",
  });
  const id = await lead.mutation(api.schedule.createTask, {
    phaseId,
    name: "Saved before",
    start: MAR_1,
    end: MAR_1,
  });
  // As saved from UTC-5 and UTC+2 under the old format.
  await t.run((ctx) =>
    ctx.db.patch(id, {
      start: MAR_1 + 5 * 60 * 60 * 1000,
      end: MAR_1 + 3 * DAY - 2 * 60 * 60 * 1000,
    }),
  );
  expect(await t.mutation(internal.schedule.roundToDays, {})).toEqual({
    rounded: 1,
  });
  const [task] = (await lead.query(api.schedule.get, {})).tasks;
  expect(task.start).toBe(MAR_1);
  expect(task.end).toBe(MAR_1 + 3 * DAY);
  expect(await t.mutation(internal.schedule.roundToDays, {})).toEqual({
    rounded: 0,
  });
});
