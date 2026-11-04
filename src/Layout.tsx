import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { UserButton } from "@clerk/react";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
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
  // Stable, so the drawer's effects don't re-run on every render.
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const pageRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // While the drawer is open the page behind it is inert, so the keyboard
  // stays in the menu; once it shuts, focus goes back to the button that
  // opened it rather than to the top of the page.
  useEffect(() => {
    if (pageRef.current) pageRef.current.inert = sidebarOpen;
    if (wasOpen.current && !sidebarOpen) menuButtonRef.current?.focus();
    wasOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  // Widen the window past the drawer's breakpoint and it becomes the fixed
  // sidebar — shut the drawer then, or the page would be left inert.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (desktop.matches) setSidebarOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  const season = useQuery(api.seasons.active, {});
  const seasons = useQuery(api.seasons.list, {});
  const pending = useQuery(api.intake.pendingCount, isLead ? {} : "skip");
  const nextEvent = useQuery(api.competitions.next, {});

  // seasons.list comes back newest year first, so anything else means the team
  // is working in a year it has since moved past — worth saying out loud,
  // because switching is team-wide and easy to forget you did.
  const newest = seasons?.[0];
  const notNewest = !!season && !!newest && newest._id !== season._id;

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
        onClose={closeSidebar}
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
      <div ref={pageRef} className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-background">
          <div className="flex min-h-14 items-center gap-3 px-4 py-2 lg:hidden">
            <Button
              ref={menuButtonRef}
              variant="ghost"
              size="icon"
              aria-controls="app-menu"
              aria-expanded={sidebarOpen}
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
          <div className="flex items-center justify-between gap-3 border-t px-4 py-2 lg:hidden">
            {/* Phones too: the warning matters most to whoever is editing
                robot records from the shop floor. */}
            {season ? (
              <SeasonLabel season={season} notNewest={notNewest} />
            ) : (
              <span />
            )}
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
            {season && <SeasonLabel season={season} notNewest={notNewest} />}
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

/**
 * Which season the team is working in — and, when it isn't the newest, a
 * warning, because switching is team-wide and easy to forget you did. One
 * component for both headers, so the phone and the desktop say the same.
 */
function SeasonLabel({
  season,
  notNewest,
}: {
  season: Doc<"seasons">;
  notNewest: boolean;
}) {
  return (
    <p className="min-w-0 truncate text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{season.name}</span> ·
      season {season.year}
      {notNewest && (
        <span className="ml-2 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          not the newest season
        </span>
      )}
    </p>
  );
}
