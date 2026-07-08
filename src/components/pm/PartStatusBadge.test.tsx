import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartStatusBadge } from "./PartStatusBadge";
import { Card } from "@/components/ui/card";
import { PART_STATUSES } from "@/lib/parts";
import { ISSUE_STATES } from "@/lib/github";

// The brand system is "one blue, disciplined neutrals + semantic status" — no
// generic Tailwind palette colors. This guards against the rainbow badges
// (sky/indigo/emerald/purple/…) creeping back in.
const OFF_BRAND =
  /(sky|indigo|emerald|purple|violet|pink|teal|cyan|rose|amber|green|red|blue|slate|zinc|gray|neutral|stone|lime|fuchsia|orange|yellow)-[0-9]/;

describe("brand status badges", () => {
  it("renders every part status with a brand-token class and no off-brand color", () => {
    for (const s of PART_STATUSES) {
      const { unmount } = render(<PartStatusBadge status={s.value} />);
      const badge = screen.getByText(s.label);
      expect(badge).toBeInTheDocument();
      expect(s.badgeClass).not.toMatch(OFF_BRAND);
      // No hand-rolled dark: variants — dark mode swaps via CSS variables.
      expect(s.badgeClass).not.toContain("dark:");
      unmount();
    }
  });

  it("uses only brand tokens for issue states", () => {
    for (const st of ISSUE_STATES) {
      expect(st.badgeClass).not.toMatch(OFF_BRAND);
      expect(st.badgeClass).not.toContain("dark:");
    }
  });
});

describe("Card accent", () => {
  it("renders the Deceiver-Blue accent bar only when accent is set", () => {
    const { container: withAccent } = render(<Card accent>hi</Card>);
    expect(withAccent.querySelector(".bg-primary")).not.toBeNull();

    const { container: plain } = render(<Card>hi</Card>);
    expect(plain.querySelector(".bg-primary")).toBeNull();
  });
});
