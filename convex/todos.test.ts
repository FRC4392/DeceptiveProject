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

async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  return { mentor };
}

describe("tags", () => {
  test("a mentor adds, renames and removes them", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);

    const id = await mentor.mutation(api.todos.createTag, {
      name: "Electrical",
    });
    expect((await mentor.query(api.todos.listTags, {}))[0].name).toBe(
      "Electrical",
    );

    await mentor.mutation(api.todos.renameTag, { id, name: "Wiring" });
    expect((await mentor.query(api.todos.listTags, {}))[0].name).toBe("Wiring");

    await mentor.mutation(api.todos.removeTag, { id });
    expect(await mentor.query(api.todos.listTags, {})).toHaveLength(0);
  });

  test("students can't change the list", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    await expect(
      student.mutation(api.todos.createTag, { name: "Sneaky" }),
    ).rejects.toThrow(/mentor/i);
  });

  test("the same tag can't be added twice", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await mentor.mutation(api.todos.createTag, { name: "Pit" });
    await expect(
      mentor.mutation(api.todos.createTag, { name: "pit" }),
    ).rejects.toThrow(/already a/i);
  });

  test("removing a tag takes it off the to-dos carrying it", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const tagId = await mentor.mutation(api.todos.createTag, { name: "Pit" });
    const todoId = await mentor.mutation(api.todos.create, {
      title: "Pack the cart",
      tagIds: [tagId],
    });

    await mentor.mutation(api.todos.removeTag, { id: tagId });

    const todo = await mentor.query(api.todos.get, { id: todoId });
    expect(todo?.tagIds).toEqual([]);
  });
});

describe("to-dos", () => {
  test("anyone can add one, and it starts unclaimed and not done", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const id = await student.mutation(api.todos.create, {
      title: "Cut bumper fabric",
    });
    const todo = await student.query(api.todos.get, { id });
    expect(todo?.title).toBe("Cut bumper fabric");
    expect(todo?.priority).toBe("medium");
    expect(todo?.claimedByUserId).toBeUndefined();
    expect(todo?.doneAt).toBeUndefined();
  });

  test("it needs a title", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await expect(
      mentor.mutation(api.todos.create, { title: "   " }),
    ).rejects.toThrow(/title/i);
  });

  test("picking one up, and putting it back", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });

    await student.mutation(api.todos.claim, { id });
    expect((await student.query(api.todos.get, { id }))?.claimedByUserId).toBe(
      "student_1",
    );

    await student.mutation(api.todos.unclaim, { id });
    expect(
      (await student.query(api.todos.get, { id }))?.claimedByUserId,
    ).toBeUndefined();
  });

  test("someone else can't take one that's spoken for", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });

    await student.mutation(api.todos.claim, { id });
    await expect(mentor.mutation(api.todos.claim, { id })).rejects.toThrow(
      /already picked this one up/i,
    );
  });

  test("a lead can put back someone else's", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });
    await student.mutation(api.todos.claim, { id });

    await mentor.mutation(api.todos.unclaim, { id });
    expect(
      (await mentor.query(api.todos.get, { id }))?.claimedByUserId,
    ).toBeUndefined();
  });

  test("done and not done again, with who did it", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });

    await student.mutation(api.todos.setDone, { id, done: true });
    let todo = await mentor.query(api.todos.get, { id });
    expect(todo?.doneAt).toBeTypeOf("number");
    expect(todo?.doneByUserId).toBe("student_1");

    await student.mutation(api.todos.setDone, { id, done: false });
    todo = await mentor.query(api.todos.get, { id });
    expect(todo?.doneAt).toBeUndefined();
    expect(todo?.doneByUserId).toBeUndefined();
  });

  test("my list is only what I picked up", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const mine = await mentor.mutation(api.todos.create, { title: "Mine" });
    await mentor.mutation(api.todos.create, { title: "Someone else's" });
    await student.mutation(api.todos.claim, { id: mine });

    const list = await student.query(api.todos.listMine, {});
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Mine");
  });

  test("done ones sink to the bottom of the list", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const first = await mentor.mutation(api.todos.create, { title: "First" });
    await mentor.mutation(api.todos.create, { title: "Second" });
    await mentor.mutation(api.todos.setDone, { id: first, done: true });

    const list = await mentor.query(api.todos.list, {});
    expect(list.map((t) => t.title)).toEqual(["Second", "First"]);
  });

  test("only a lead can delete one, and its notes go with it", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });
    await student.mutation(api.todos.addNote, { todoId: id, body: "Started" });

    await expect(student.mutation(api.todos.remove, { id })).rejects.toThrow(
      /lead or mentor/i,
    );

    await mentor.mutation(api.todos.remove, { id });
    expect(await mentor.query(api.todos.get, { id })).toBeNull();
    expect(await mentor.query(api.todos.notes, { todoId: id })).toHaveLength(0);
  });

  test("notes need something in them", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });
    await expect(
      mentor.mutation(api.todos.addNote, { todoId: id, body: "  " }),
    ).rejects.toThrow(/write something/i);
  });
});
