import { NavLink } from "react-router-dom";
import { Cross1Icon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NavItem = { to: string; label: string };

/** Left-hand app navigation. Fixed column on desktop, off-canvas drawer on mobile. */
export function Sidebar({
  items,
  open,
  onClose,
}: {
  items: NavItem[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r bg-background transition-transform duration-200 ease-in-out",
          "md:static md:z-auto md:translate-x-0 md:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-4 md:hidden">
          <img
            src="/brand/logo-banner.png"
            alt="Deceivers Robotics · Team 4392"
            className="h-8 w-auto object-contain"
          />
          <Button variant="ghost" size="icon" onClick={onClose}>
            <Cross1Icon className="h-4 w-4" />
            <span className="sr-only">Close menu</span>
          </Button>
        </div>
        <nav className="flex flex-col gap-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
