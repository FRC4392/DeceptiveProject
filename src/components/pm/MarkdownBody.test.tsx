import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownBody } from "./MarkdownBody";

/**
 * These are about a comment staying inside its card. GitHub comments arrive as
 * markdown and routinely carry the three things that used to break out of it: a
 * URL with no spaces in it, a pasted command, and a table.
 */
describe("a markdown comment body", () => {
  it("lets prose break anywhere, so an unbroken URL can't widen the card", () => {
    const { container } = render(
      <MarkdownBody body="see https://example.com/a" />,
    );
    const root = container.firstElementChild!;
    expect(root.className).toContain("break-words");
    expect(root.className).toContain("[overflow-wrap:anywhere]");
    // And it has to be allowed to shrink in the flex row it sits in.
    expect(root.className).toContain("min-w-0");
  });

  it("scrolls a code block sideways rather than breaking the command", () => {
    const { container } = render(
      <MarkdownBody body={"```\nnpx convex env set GITHUB_TOKEN abc\n```"} />,
    );
    const pre = container.querySelector("pre")!;
    expect(pre.className).toContain("overflow-x-auto");
    expect(pre.className).toContain("max-w-full");
    expect(pre.textContent).toContain("npx convex env set");
  });

  it("renders the markdown rather than showing its punctuation", () => {
    render(<MarkdownBody body={"**stalls** under load\n\n- left\n- right"} />);
    expect(screen.getByText("stalls").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("renders a GFM table in its own scrolling box", () => {
    const { container } = render(
      <MarkdownBody body={"| a | b |\n| - | - |\n| 1 | 2 |"} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(
      container.querySelector("table")!.parentElement!.className,
    ).toContain("overflow-x-auto");
  });

  it("opens links in a new tab, and refuses one that isn't http(s)", () => {
    render(
      <MarkdownBody
        body={"[docs](https://example.com) and [bad](javascript:alert(1))"}
      />,
    );
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    // The text stays; only the href is dropped.
    expect(screen.getByText("bad").closest("a")).toBeNull();
  });

  it("never renders raw HTML — this text comes from whoever filed the issue", () => {
    const { container } = render(
      <MarkdownBody body={'<img src=x onerror="alert(1)">done'} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
