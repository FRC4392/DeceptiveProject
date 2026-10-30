import { describe, expect, test } from "vitest";
import {
  isLifecycleEvent,
  isReleasedState,
  parseWebhookEvent,
  releaseLabel,
  releaseLines,
  releasePackageId,
  releaseState,
  secretsMatch,
  trimRawPackage,
  type ReleasePackage,
} from "./onshapeRelease";

// The envelope Onshape's own sample client reads: an event name, what kind of
// thing moved, and its id. Everything else has to be fetched.
const transition = {
  timestamp: "2026-10-30T12:00:00Z",
  event: "onshape.workflow.transition",
  webhookId: "wh_1",
  messageId: "msg_1",
  objectType: "RELEASE",
  objectId: "rp_1",
  documentId: "doc_1",
  workspaceId: "ws_1",
};

describe("reading a notification", () => {
  test("pulls the fields out of a release transition", () => {
    const event = parseWebhookEvent(transition);
    expect(event?.event).toBe("onshape.workflow.transition");
    expect(event?.objectId).toBe("rp_1");
    expect(event?.messageId).toBe("msg_1");
    expect(releasePackageId(event!)).toBe("rp_1");
  });

  test("anything that isn't an event body is not one", () => {
    expect(parseWebhookEvent(null)).toBeNull();
    expect(parseWebhookEvent("onshape.workflow.transition")).toBeNull();
    expect(parseWebhookEvent({ objectId: "rp_1" })).toBeNull();
  });

  test("a transition of something that isn't a release is not ours", () => {
    const event = parseWebhookEvent({ ...transition, objectType: "DOCUMENT" })!;
    expect(releasePackageId(event)).toBeNull();
  });

  test("another event type is not a release either", () => {
    const event = parseWebhookEvent({
      ...transition,
      event: "onshape.model.lifecycle.changed",
    })!;
    expect(releasePackageId(event)).toBeNull();
  });

  test("Onshape's own register and ping traffic is recognised", () => {
    expect(isLifecycleEvent("webhook.ping")).toBe(true);
    expect(isLifecycleEvent("webhook.register")).toBe(true);
    expect(isLifecycleEvent("webhook.unregister")).toBe(true);
    expect(isLifecycleEvent("onshape.workflow.transition")).toBe(false);
  });
});

describe("the shared secret", () => {
  test("matches itself and nothing else", () => {
    expect(secretsMatch("hunter2", "hunter2")).toBe(true);
    expect(secretsMatch("hunter3", "hunter2")).toBe(false);
  });

  test("a prefix is not a match", () => {
    expect(secretsMatch("hunter", "hunter2")).toBe(false);
    expect(secretsMatch("hunter22", "hunter2")).toBe(false);
  });

  test("an unset secret never matches, including against nothing", () => {
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("anything", "")).toBe(false);
  });
});

describe("which transition counts", () => {
  test("only a released package is worth taking in", () => {
    expect(isReleasedState("RELEASED")).toBe(true);
    expect(isReleasedState("PENDING")).toBe(false);
    expect(isReleasedState("REJECTED")).toBe(false);
    expect(isReleasedState("OBSOLETE")).toBe(false);
    expect(isReleasedState("")).toBe(false);
  });

  test("the state is read case- and space-insensitively", () => {
    expect(releaseState({ workflow: { state: { name: " released " } } })).toBe(
      "RELEASED",
    );
  });

  test("a package that doesn't say has no state", () => {
    expect(releaseState({})).toBe("");
  });
});

describe("flattening a release package", () => {
  const pkg: ReleasePackage = {
    id: "rp_1",
    name: "Intake release 3",
    workflow: { state: { name: "RELEASED" } },
    items: [
      {
        documentId: "doc_1",
        elementId: "el_1",
        versionId: "v_1",
        partId: "JHD",
        properties: [
          { propertyId: "p1", name: "Part number", value: "27-INT-104" },
          { propertyId: "p2", name: "Revision", value: "B" },
          { propertyId: "p3", name: "Name", value: "Side plate" },
        ],
      },
      {
        documentId: "doc_1",
        elementId: "el_2",
        versionId: "v_1",
        elementType: "ASSEMBLY",
        name: "Roller assembly",
        properties: [
          { propertyId: "p1", name: "Part number", value: "27-INT-120" },
          { propertyId: "p2", name: "Revision", value: "A" },
        ],
      },
    ],
  };

  test("reads the part number and revision off the item's properties", () => {
    const [part] = releaseLines(pkg);
    expect(part).toMatchObject({
      partNumber: "27-INT-104",
      revision: "B",
      name: "Side plate",
      documentId: "doc_1",
      elementId: "el_1",
      versionId: "v_1",
      partId: "JHD",
      isAssembly: false,
    });
  });

  test("an item is only an assembly when Onshape says it is", () => {
    const [, assembly] = releaseLines(pkg);
    expect(assembly.isAssembly).toBe(true);
    expect(assembly.name).toBe("Roller assembly");
    // No partId and no elementType is still a part: guessing would put
    // strangers on the subsystem tree.
    const [odd] = releaseLines({ items: [{ elementId: "el_9" }] });
    expect(odd.isAssembly).toBe(false);
  });

  test("falls back to fields flattened onto the item", () => {
    const [line] = releaseLines({
      items: [{ partNumber: "27-DRV-002", revision: "C", name: "Standoff" }],
    });
    expect(line).toMatchObject({
      partNumber: "27-DRV-002",
      revision: "C",
      name: "Standoff",
    });
  });

  test("a property wins over the same field flattened on the item", () => {
    const [line] = releaseLines({
      items: [
        {
          partNumber: "stale",
          properties: [{ name: "Part number", value: "27-DRV-002" }],
        },
      ],
    });
    expect(line.partNumber).toBe("27-DRV-002");
  });

  test("an item with no name at all is still named something", () => {
    expect(
      releaseLines({ items: [{ partNumber: "27-DRV-002" }] })[0].name,
    ).toBe("27-DRV-002");
    expect(releaseLines({ items: [{}] })[0].name).toBe("Released item");
  });

  test("a package with no items flattens to nothing", () => {
    expect(releaseLines({})).toEqual([]);
  });

  test("the intake is labelled with the release's own name", () => {
    expect(releaseLabel(pkg)).toBe("Intake release 3");
    expect(releaseLabel({ id: "rp_2" })).toBe("Release rp_2");
    expect(releaseLabel({})).toBe("Onshape release");
  });
});

describe("keeping the raw package", () => {
  test("a normal package is kept whole, for checking against the docs", () => {
    const pkg = { id: "rp_1", items: [{ partNumber: "27-INT-104" }] };
    expect(trimRawPackage(pkg)).toBe(pkg);
  });

  test("one too big to store is replaced by a note, not dropped silently", () => {
    const huge: ReleasePackage = {
      id: "rp_1",
      items: Array.from({ length: 4000 }, (_, i) => ({
        partNumber: `27-INT-${i}`,
        name: "x".repeat(60),
      })),
    };
    const trimmed = trimRawPackage(huge) as {
      omitted: string;
      itemCount: number;
    };
    expect(trimmed.omitted).toMatch(/too large/);
    expect(trimmed.itemCount).toBe(4000);
  });
});
