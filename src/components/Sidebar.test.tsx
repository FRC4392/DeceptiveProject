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

// On a phone it's a drawer, and a keyboard has to be able to use it — and
// not wander into it when it's shut.
describe("the menu drawer", () => {
  function drawer(open: boolean, onClose = vi.fn()) {
    const view = render(
      <MemoryRouter>
        <Sidebar sections={sections} open={open} onClose={onClose} />
      </MemoryRouter>,
    );
    return { onClose, view, menu: screen.getByLabelText("Main menu") };
  }

  // Moved off-screen alone, its links stayed in the tab order. CSS decides
  // what jsdom can't see, so this checks the class that hides it.
  it("is hidden when shut, not just moved aside", () => {
    expect(drawer(false).menu).toHaveClass("invisible");
  });

  it("stays put on a desktop, where it's the fixed sidebar", () => {
    expect(drawer(false).menu).toHaveClass("lg:visible");
  });

  it("moves focus into itself when it opens", () => {
    drawer(true);
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveFocus();
  });

  it("shuts on Escape", async () => {
    const { onClose } = drawer(true);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores Escape when it's already shut", async () => {
    const { onClose } = drawer(false);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  // Tied to anything but opening, a re-render would pull focus back to the
  // close button from whatever link you'd tabbed to.
  it("leaves focus where you put it when it re-renders", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar sections={sections} open onClose={onClose} />
      </MemoryRouter>,
    );
    screen.getByRole("link", { name: "Dashboard" }).focus();
    rerender(
      <MemoryRouter>
        <Sidebar sections={sections} open onClose={() => onClose()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveFocus();
  });
});
