import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Sidebar, type NavSection } from "./Sidebar";

const sections: NavSection[] = [
  {
    label: "Parts",
    items: [{ to: "/parts", label: "Parts board", badge: 3 }],
  },
  {
    label: "Team",
    items: [
      { to: "/dashboard", label: "Dashboard" },
      { to: "/boards", label: "Boards" },
    ],
  },
];

function renderSidebar(initialPath: string, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Sidebar sections={sections} open onClose={onClose} />
      </MemoryRouter>,
    ),
  };
}

describe("Sidebar", () => {
  it("renders every nav item and marks the active route", () => {
    renderSidebar("/boards");
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    const boardsLink = screen.getByRole("link", { name: "Boards" });
    expect(boardsLink).toHaveClass("bg-brand-core");
  });

  it("groups items under their section heading and shows badges", () => {
    renderSidebar("/parts");
    expect(screen.getByText("Parts")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Parts board/ })).toHaveTextContent(
      "3",
    );
  });

  it("calls onClose when a nav item is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSidebar("/dashboard");
    await user.click(screen.getByRole("link", { name: "Boards" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
