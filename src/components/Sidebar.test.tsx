import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Sidebar, type NavItem } from "./Sidebar";

const items: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/boards", label: "Boards" },
];

function renderSidebar(initialPath: string, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Sidebar items={items} open onClose={onClose} />
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

  it("calls onClose when a nav item is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSidebar("/dashboard");
    await user.click(screen.getByRole("link", { name: "Boards" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
