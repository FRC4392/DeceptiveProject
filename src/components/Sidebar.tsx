import { NavLink } from "react-router-dom";
import { Cross1Icon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

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
          "fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-brand-navy bg-gradient-to-b from-brand-deep to-brand-navy text-white transition-transform duration-200 ease-in-out",
          "md:sticky md:inset-auto md:top-0 md:z-auto md:h-svh md:translate-x-0 md:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <NavLink to="/dashboard" className="flex items-center">
            <img
              src={logo}
              alt="Deceivers Robotics Team 4392"
              className="h-10 w-auto object-contain"
            />
          </NavLink>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/70 hover:bg-white/10 hover:text-white md:hidden"
            onClick={onClose}
          >
            <Cross1Icon className="h-4 w-4" />
            <span className="sr-only">Close menu</span>
          </Button>
        </div>
        <div className="h-px w-full shrink-0 bg-white/10" />
        <nav className="flex flex-col gap-1 overflow-y-auto px-3 py-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-core text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
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
