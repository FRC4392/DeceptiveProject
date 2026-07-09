import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type React from "react";
import App from "@/App";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    auth: {
      currentUser: "auth.currentUser",
      storeCurrentUser: "auth.storeCurrentUser",
      syncUsersFromClerk: "auth.syncUsersFromClerk",
    },
    boards: {
      create: "boards.create",
      list: "boards.list",
      remove: "boards.remove",
    },
    competitions: {
      create: "competitions.create",
      list: "competitions.list",
      remove: "competitions.remove",
    },
    dashboard: { summary: "dashboard.summary" },
    github: {
      config: "github.config",
      importIssues: "github.importIssues",
      listRepoMappings: "github.listRepoMappings",
      setRepoProject: "github.setRepoProject",
      stats: "github.stats",
      removeRepoMapping: "github.removeRepoMapping",
    },
    onshape: {
      assignDocumentNumber: "onshape.assignDocumentNumber",
      listDocuments: "onshape.listDocuments",
      removeDocument: "onshape.removeDocument",
    },
    onshapeOAuth: { connectionStatus: "onshapeOAuth.connectionStatus" },
    parts: { costRollup: "parts.costRollup" },
    projects: {
      create: "projects.create",
      list: "projects.list",
      remove: "projects.remove",
      update: "projects.update",
    },
    tasks: { listOverdue: "tasks.listOverdue" },
    users: { list: "users.list" },
  },
}));

vi.mock("@clerk/react", () => ({
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  UserButton: () => <button aria-label="Open user button">Account</button>,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: vi.fn(async () => "token"),
    orgId: null,
    orgRole: null,
    sessionClaims: { aud: "convex" },
  }),
}));

vi.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AuthLoading: () => null,
  Unauthenticated: () => null,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useAction: () => vi.fn(async () => ({ imported: 0 })),
  useMutation: () => vi.fn(async () => null),
  useQuery: (ref: string) => {
    switch (ref) {
      case "auth.currentUser":
        return { id: "user_1", email: "mentor@example.com", role: "mentor" };
      case "boards.list":
      case "competitions.list":
      case "github.listRepoMappings":
      case "onshape.listDocuments":
      case "projects.list":
      case "tasks.listOverdue":
      case "users.list":
        return [];
      case "dashboard.summary":
        return {
          doneTasks: 2,
          totalTasks: 4,
          overdueCount: 1,
          nextCompetition: null,
          subsystems: [],
        };
      case "github.config":
        return { webhookConfigured: false, tokenConfigured: false, repos: [] };
      case "github.stats":
        return { open: 0, closed: 0, prs: 0, total: 0 };
      case "onshapeOAuth.connectionStatus":
        return { connected: false };
      case "parts.costRollup":
        return {
          total: 0,
          partsTotal: 0,
          inventoryTotal: 0,
          cotsTotal: 0,
          partsMissingCost: 0,
        };
      default:
        return undefined;
    }
  },
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("app smoke routes", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the authenticated dashboard shell", () => {
    renderAt("/dashboard");

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 4 tasks done")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Deceivers Robotics/ }),
    ).toBeInTheDocument();
  });

  it("navigates through the sidebar drawer to boards", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("link", { name: "Boards" }));

    expect(screen.getByRole("heading", { name: "Boards" })).toBeInTheDocument();
    expect(screen.getByText(/No boards yet/)).toBeInTheDocument();
  });

  it("shows mentor-only admin navigation and missing integration URL states", () => {
    renderAt("/admin/github");

    expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByText(/github\/webhook/)).toBeInTheDocument();
    expect(screen.getByText(/Set VITE_CONVEX_SITE_URL/)).toBeInTheDocument();
  });

  it("disables Onshape OAuth when the Convex site URL is not configured", () => {
    renderAt("/admin/onshape");

    expect(
      screen.getByRole("heading", { name: "Onshape" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Onshape" }),
    ).toBeDisabled();
    expect(screen.getAllByText(/VITE_CONVEX_SITE_URL/).length).toBeGreaterThan(
      0,
    );
  });
});
