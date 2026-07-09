import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { UserButton } from "@clerk/react";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { Sidebar, type NavItem } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Button } from "@/components/ui/button";
import { ProjectProvider } from "@/lib/project";
import { useIsMentor } from "@/lib/roles";
import logo from "@/assets/logo.png";

type MentorNavItem = NavItem & { mentorOnly?: boolean };

const NAV_ITEMS: MentorNavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/boards", label: "Boards" },
  { to: "/my-tasks", label: "My Tasks" },
  { to: "/calendar", label: "Calendar" },
  { to: "/timeline", label: "Timeline" },
  { to: "/parts", label: "Parts" },
  { to: "/issues", label: "Issues" },
  { to: "/admin", label: "Admin", mentorOnly: true },
];

/** Top-level authenticated app shell: sidebar nav + routed content. */
export function AppShell() {
  const isMentor = useIsMentor();
  const items = NAV_ITEMS.filter((i) => !i.mentorOnly || isMentor);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ProjectProvider>
      <div className="flex min-h-svh w-full">
        <Sidebar
          items={items}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b bg-background">
            <div className="flex min-h-14 items-center gap-3 px-4 py-2 md:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
              >
                <HamburgerMenuIcon className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
              <NavLink
                to="/dashboard"
                className="flex min-w-0 shrink items-center"
              >
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
            <div className="flex items-center gap-3 border-t px-4 py-2 md:hidden">
              <ProjectSwitcher className="min-w-0 flex-1" />
              <ThemeToggle />
            </div>
            <div className="hidden min-h-14 items-center justify-end gap-3 px-6 py-2 md:flex">
              <ProjectSwitcher className="w-44" />
              <ThemeToggle />
              <UserButton />
            </div>
          </header>
          <main className="flex min-w-0 grow flex-col overflow-y-auto">
            <div className="container w-full py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </ProjectProvider>
  );
}
