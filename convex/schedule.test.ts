// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";
const DAY = 24 * 60 * 60 * 1000;
const MAR_1 = new Date(2027, 2, 1).getTime();

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
