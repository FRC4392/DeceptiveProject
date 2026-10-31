import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { UserButton } from "@clerk/react";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Sidebar, type NavSection } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useIsLead, useIsMentor } from "@/lib/roles";
import { APP_BAR_HEIGHT } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

/** Top-level authenticated app shell: sidebar nav + routed content. */
export function AppShell() {
  const isMentor = useIsMentor();
  const isLead = useIsLead();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const season = useQuery(api.seasons.active, {});
  const pending = useQuery(api.intake.pendingCount, isLead ? {} : "skip");
  const nextEvent = useQuery(api.competitions.next, {});

  const sections: NavSection[] = [
    // Dashboard sits on its own above the first heading.
    { items: [{ to: "/dashboard", label: "Dashboard" }] },
    {
      label: "Parts",
      items: [
        { to: "/subsystems", label: "Subsystems" },
        { to: "/parts", label: "Parts Board" },
        { to: "/my-parts", label: "My Parts" },
        { to: "/manufacturing", label: "Manufacturing" },
        { to: "/ordering", label: "Ordering" },
        ...(isLead
          ? [
              {
                to: "/parts/from-onshape",
                label: "New from Onshape",
                badge: pending ?? 0,
              },
            ]
          : []),
      ],
    },
    {
      label: "To Do",
      items: [
        { to: "/todos", label: "To-do List" },
        { to: "/my-todos", label: "My To-dos" },
      ],
    },
    {
      label: "Software",
      items: [
        { to: "/issues", label: "Issues" },
        { to: "/my-issues", label: "My Issues" },
      ],
    },
    {
      label: "Settings",
      items: isMentor ? [{ to: "/admin", label: "Settings" }] : [],
    },
    // A heading with nothing under it is just clutter.
  ].filter((section) => section.items.length > 0);

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar
        sections={sections}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        footer={
          nextEvent ? (
            <div className="rounded-lg bg-white/5 p-3 text-white/80">
              <p className="text-[11px] uppercase tracking-wide text-white/50">
                Next event
              </p>
              <p className="mt-0.5 text-sm font-semibold text-white">
                {nextEvent.name}
              </p>
              <p className="text-xs">
                {new Date(nextEvent.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}{" "}
                · robot must be done
              </p>
            </div>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-background">
          <div className="flex min-h-14 items-center gap-3 px-4 py-2 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
            >
              <HamburgerMenuIcon className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </Button>
            <NavLink to="/parts" className="flex min-w-0 shrink items-center">
              <img
                src={logo}
                alt="Deceivers Robotics Team 4392"
                className="h-8 w-auto max-w-44 object-contain"
              />
            </NavLink>
            <div className="ml-auto flex shrink-0 items-center">
              <UserButton />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t px-4 py-2 lg:hidden">
            <ThemeToggle />
          </div>
          {/* Same height as the sidebar's logo block, so this header's bottom
              border and the sidebar's divider form one unbroken line. */}
          <div
            className={cn(
              "hidden items-center gap-3 px-6 py-2 lg:flex",
              APP_BAR_HEIGHT,
            )}
          >
            {season && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {season.name}
                </span>{" "}
                · season {season.year}
              </p>
            )}
            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />
              <UserButton />
            </div>
          </div>
        </header>
        <main className="flex min-w-0 grow flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
