import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { Cross1Icon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { APP_BAR_HEIGHT } from "@/lib/chrome";
import logo from "@/assets/logo.png";

export type NavItem = { to: string; label: string; badge?: number };
export type NavSection = { label?: string; items: NavItem[] };

/** Left-hand app navigation. Fixed column on desktop, off-canvas drawer on mobile. */
export function Sidebar({
  sections,
  footer,
  open,
  onClose,
}: {
  sections: NavSection[];
  /** Pinned to the bottom — the next event, so the deadline is always visible. */
  footer?: React.ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Open as a drawer: focus goes into it, and Escape shuts it. (On desktop
  // it's never "open" — it's just there — so none of this runs.) Focus moves
  // once, when it opens, and never again while it's open: tied to anything
  // else, a re-render would pull focus off whatever link you'd reached.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="app-menu"
        aria-label="Main menu"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-brand-navy bg-gradient-to-b from-brand-deep to-brand-navy text-white transition-[transform,visibility] duration-200 ease-in-out",
          "lg:visible lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-svh lg:translate-x-0 lg:transition-none",
          // Shut on a phone, it's off-screen *and* out of the way: moved
          // aside alone, its links stayed in the tab order, so the keyboard
          // walked through a menu nobody could see. Visibility rides the
          // same transition, so it still slides out before it goes.
          open ? "visible translate-x-0" : "invisible -translate-x-full",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between px-4",
            APP_BAR_HEIGHT,
          )}
        >
          <NavLink to="/parts" className="flex items-center">
            <img
              src={logo}
              alt="Deceivers Robotics Team 4392"
              className="h-10 w-auto object-contain"
            />
          </NavLink>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            className="text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={onClose}
          >
            <Cross1Icon className="h-4 w-4" />
            <span className="sr-only">Close menu</span>
          </Button>
        </div>
        <div className="h-px w-full shrink-0 bg-white/10" />

        <nav className="flex grow flex-col gap-4 overflow-y-auto px-3 py-4">
          {sections.map((section, i) => (
            <div key={section.label ?? i} className="flex flex-col gap-1">
              {section.label && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/parts"}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-brand-core text-white"
                        : "text-white/70 hover:bg-white/10 hover:text-white",
                    )
                  }
                >
                  <span>{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {footer && <div className="shrink-0 p-3">{footer}</div>}
      </aside>
    </>
  );
}
