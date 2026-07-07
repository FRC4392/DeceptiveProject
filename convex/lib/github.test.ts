import { describe, expect, it } from "vitest";
import { derivePriority, normalizeIssueNode, normalizeRepo } from "./github";

describe("derivePriority", () => {
  it("maps urgent/critical/high labels to high", () => {
    expect(derivePriority(["bug", "priority: high"])).toBe("high");
    expect(derivePriority(["Critical"])).toBe("high");
    expect(derivePriority(["P0"])).toBe("high");
    expect(derivePriority(["urgent"])).toBe("high");
  });

  it("maps low/minor labels to low", () => {
    expect(derivePriority(["minor"])).toBe("low");
    expect(derivePriority(["priority: low"])).toBe("low");
    expect(derivePriority(["P3"])).toBe("low");
  });

  it("defaults to medium", () => {
    expect(derivePriority([])).toBe("medium");
    expect(derivePriority(["bug", "documentation"])).toBe("medium");
  });
});

describe("normalizeRepo", () => {
  it("strips URL and .git suffixes", () => {
    expect(normalizeRepo("https://github.com/deceivers/robot.git")).toBe(
      "deceivers/robot",
    );
    expect(normalizeRepo("  deceivers/robot/ ")).toBe("deceivers/robot");
  });
});

describe("normalizeIssueNode", () => {
  it("maps a webhook issue node into upsert args", () => {
    const args = normalizeIssueNode(
      "deceivers/robot",
      {
        id: 42,
        number: 7,
        title: "Drive motor stalls",
        body: "Repro steps…",
        state: "open",
        html_url: "https://github.com/deceivers/robot/issues/7",
        labels: [{ name: "bug" }, { name: "urgent" }],
        assignees: [{ login: "alice" }, { login: "bob" }],
        user: { login: "carol" },
      },
      false,
    );
    expect(args).not.toBeNull();
    expect(args).toMatchObject({
      repo: "deceivers/robot",
      number: 7,
      githubId: 42,
      title: "Drive motor stalls",
      state: "open",
      labels: ["bug", "urgent"],
      assigneeLogins: ["alice", "bob"],
      authorLogin: "carol",
      isPullRequest: false,
    });
  });

  it("flags an issues-event node that is actually a PR", () => {
    const args = normalizeIssueNode(
      "deceivers/robot",
      { number: 9, title: "Add climber", state: "open", pull_request: {} },
      false,
    );
    expect(args?.isPullRequest).toBe(true);
  });

  it("returns null when the node has no number", () => {
    expect(normalizeIssueNode("deceivers/robot", { title: "x" }, false)).toBeNull();
  });
});
