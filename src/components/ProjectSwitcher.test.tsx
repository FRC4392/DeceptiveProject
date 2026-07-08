import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useActiveProject } from "@/lib/project";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("@/lib/project", () => ({
  useActiveProject: vi.fn(),
}));

const projects = [
  {
    _id: "p1" as Id<"projects">,
    _creationTime: 1,
    name: "Alpha",
    tag: "26",
    numberingMode: "auto" as const,
  },
  {
    _id: "p2" as Id<"projects">,
    _creationTime: 2,
    name: "Beta",
    tag: "SWERVE",
    numberingMode: "auto" as const,
  },
];

beforeAll(() => {
  // Radix Select needs these in jsdom (it doesn't implement layout/pointer
  // capture APIs the popper positioning relies on).
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("ProjectSwitcher", () => {
  it("shows the active project and lets you switch to another", async () => {
    const setActiveProjectId = vi.fn();
    vi.mocked(useActiveProject).mockReturnValue({
      activeProjectId: "p1" as Id<"projects">,
      setActiveProjectId,
      projects,
    });
    const user = userEvent.setup();

    render(<ProjectSwitcher />);
    await user.click(screen.getByRole("combobox", { name: "Active project" }));
    await user.click(await screen.findByRole("option", { name: /Beta/ }));

    expect(setActiveProjectId).toHaveBeenCalledWith("p2");
  });

  it("falls back to \"All projects\" when nothing is selected", async () => {
    vi.mocked(useActiveProject).mockReturnValue({
      activeProjectId: null,
      setActiveProjectId: vi.fn(),
      projects,
    });

    render(<ProjectSwitcher />);
    expect(
      screen.getByRole("combobox", { name: "Active project" }),
    ).toHaveTextContent("All projects");
  });
});
