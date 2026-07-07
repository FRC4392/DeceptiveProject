import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { Sidebar, type NavItem } from "@/components/Sidebar";
import { UserMenu } from "@/components/UserMenu";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Button } from "@/components/ui/button";
import { ProjectProvider } from "@/lib/project";
import { useIsMentor } from "@/lib/roles";

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
  const { user, signOut } = useAuth();
  const isMentor = useIsMentor();
  const items = NAV_ITEMS.filter((i) => !i.mentorOnly || isMentor);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ProjectProvider>
      <div className="flex h-screen w-full flex-col">
        <header className="sticky top-0 z-20 border-b border-primary-foreground/15 bg-primary text-primary-foreground shadow-sm">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-2 md:px-6">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground md:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <HamburgerMenuIcon className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
              <NavLink to="/dashboard" className="flex shrink-0 items-center">
                <img
                  src="/brand/logo-mark.png"
                  alt="Deceivers Robotics · Team 4392"
                  className="h-8 w-8 object-contain md:hidden"
                />
                <img
                  src="/brand/logo-banner.png"
                  alt="Deceivers Robotics · Team 4392"
                  className="hidden h-9 w-auto object-contain md:block"
                />
              </NavLink>
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <ProjectSwitcher />
              <UserMenu email={user?.email} onSignOut={() => signOut()} />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 grow">
          <Sidebar
            items={items}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
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
