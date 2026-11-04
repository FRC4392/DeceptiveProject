import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type React from "react";
import App from "@/App";

const clerkMock = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  signInProps: [] as Array<Record<string, unknown>>,
}));

const seasonMock = vi.hoisted(() => {
  const active = {
    _id: "season_1",
    _creationTime: 0,
    year: "27",
    name: "2027 robot",
    active: true,
  };
  return { active, list: [active] as (typeof active)[] };
});

vi.mock("../../convex/_generated/api", () => ({
  api: {
    auth: {
      currentUser: "auth.currentUser",
      storeCurrentUser: "auth.storeCurrentUser",
      syncUsersFromClerk: "auth.syncUsersFromClerk",
    },
    todos: {
      list: "todos.list",
      listMine: "todos.listMine",
      listTags: "todos.listTags",
    },
    competitions: {
      create: "competitions.create",
      list: "competitions.list",
      next: "competitions.next",
      remove: "competitions.remove",
    },
    dashboard: { summary: "dashboard.summary" },
    github: {
      config: "github.config",
      importIssues: "github.importIssues",
      listRepoMappings: "github.listRepoMappings",
      setRepoProject: "github.setRepoProject",
      stats: "github.stats",
      list: "github.list",
      listMine: "github.listMine",
      claim: "github.claim",
      unclaim: "github.unclaim",
      removeRepoMapping: "github.removeRepoMapping",
    },
    cots: { list: "cots.list" },
    onshape: {
      mapDocument: "onshape.mapDocument",
      listDocuments: "onshape.listDocuments",
      removeDocument: "onshape.removeDocument",
    },
    onshapeOAuth: {
      connectionStatus: "onshapeOAuth.connectionStatus",
      beginConnect: "onshapeOAuth.beginConnect",
    },
    onshapeWebhook: {
      status: "onshapeWebhook.status",
      register: "onshapeWebhook.register",
      unregister: "onshapeWebhook.unregister",
      reconcile: "onshapeWebhook.reconcile",
    },
    intake: { pendingCount: "intake.pendingCount", list: "intake.list" },
    parts: {
      list: "parts.list",
      listMine: "parts.listMine",
      headsUp: "parts.headsUp",
      search: "parts.search",
    },
    seasons: { active: "seasons.active", list: "seasons.list" },
    settings: { budget: "settings.budget" },
    shop: {
      listMachines: "shop.listMachines",
      listProcessTypes: "shop.listProcessTypes",
      myTraining: "shop.myTraining",
    },
    subsystems: { list: "subsystems.list", progress: "subsystems.progress" },
    users: { list: "users.list" },
  },
}));

vi.mock("@clerk/react", () => ({
  SignIn: (props: Record<string, unknown>) => {
    clerkMock.signInProps.push(props);
    return <div data-testid="clerk-sign-in" />;
  },
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  UserButton: () => <button aria-label="Open user button">Account</button>,
  useUser: () => ({
    isLoaded: clerkMock.isLoaded,
    isSignedIn: clerkMock.isSignedIn,
  }),
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
        return {
          id: "user_1",
          email: "mentor@example.com",
          name: "Sam Mentor",
          role: "mentor",
        };
      case "todos.list":
      case "todos.listMine":
      case "todos.listTags":
      case "competitions.list":
      case "github.list":
      case "github.listMine":
      case "github.listRepoMappings":
      case "cots.list":
      case "onshape.listDocuments":
      case "users.list":
      case "intake.list":
      case "parts.list":
      case "parts.listMine":
      case "parts.headsUp":
      case "parts.search":
      case "shop.listMachines":
      case "shop.listProcessTypes":
      case "shop.myTraining":
      case "subsystems.list":
      case "subsystems.progress":
        return [];
      case "seasons.active":
        return seasonMock.active;
      // Needed, not optional: without this case the query reads as still
      // loading and the app bar's "not the newest season" badge never renders
      // either way, so the branch would go untested while the suite passed.
      case "seasons.list":
        return seasonMock.list;
      case "competitions.next":
        return null;
      case "intake.pendingCount":
        return 0;
      case "dashboard.summary":
        return {
          outstanding: {
            parts: 6,
            subAssemblies: 2,
            todos: 2,
            issues: 1,
            total: 11,
          },
          mine: {
            parts: 1,
            subAssemblies: 0,
            todos: 1,
            issues: 0,
            total: 2,
          },
          parts: { ready: 4, total: 10 },
          subAssemblies: { built: 1, total: 3, readyToBuild: 1 },
          todos: { done: 2, total: 4, unclaimed: 1 },
          issues: { open: 1, closed: 3, prs: 2, total: 4 },
          bought: { toOrder: 3, ordered: 2, arrived: 7, total: 12 },
          nextCompetition: null,
        };
      case "github.config":
        return { webhookConfigured: false, tokenConfigured: false, repos: [] };
      case "github.stats":
        return { open: 0, closed: 0, prs: 0, total: 0 };
      case "onshapeOAuth.connectionStatus":
        return {
          connected: false,
          expiresAt: null,
          connectedBy: null,
          connectedAt: null,
          lastError: null,
          lastErrorAt: null,
        };
      case "onshapeWebhook.status":
        return {
          registered: false,
          webhookId: null,
          companyId: null,
          events: [],
          registeredAt: null,
          lastPingAt: null,
          lastEventAt: null,
          stale: false,
          secretConfigured: false,
        };
      case "settings.budget":
        return {
          used: 0,
          limit: 2500,
          remaining: 2500,
          mode: "normal",
          forced: false,
          forcedReason: null,
          forcedAt: null,
          renewalDate: null,
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
    clerkMock.isLoaded = true;
    clerkMock.isSignedIn = true;
    clerkMock.signInProps = [];
    seasonMock.list = [seasonMock.active];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the season in the app bar, and says nothing when it's the newest", () => {
    renderAt("/dashboard");

    expect(screen.getByText("2027 robot")).toBeInTheDocument();
    expect(screen.queryByText(/not the newest season/i)).toBeNull();
  });

  it("warns when the team is working in a year it has moved past", () => {
    seasonMock.list = [
      { ...seasonMock.active, _id: "season_2", year: "28", name: "2028 robot" },
      seasonMock.active,
    ];

    renderAt("/dashboard");

    expect(screen.getByText(/not the newest season/i)).toBeInTheDocument();
  });

  it("loads the authenticated dashboard shell", () => {
    renderAt("/dashboard");

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    // The three headline numbers: what's left, what's on you, the countdown.
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("Still to do")).toBeInTheDocument();
    expect(screen.getByText("On you")).toBeInTheDocument();
    expect(screen.getByText("Next event")).toBeInTheDocument();
    // …then a card each for the four things it tracks.
    for (const card of ["Sub-assemblies", "Parts", "To-dos", "Issues"]) {
      expect(
        screen.getAllByRole("heading", { name: card }).length,
      ).toBeGreaterThan(0);
    }
    expect(
      screen.getAllByRole("link", { name: /Deceivers Robotics/ }).length,
    ).toBeGreaterThan(0);
  });

  it("renders the DeceptiveHours-style login screen when signed out", () => {
    clerkMock.isSignedIn = false;
    renderAt("/login");

    expect(
      screen.getByAltText("Deceivers Robotics Team 4392"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();

    expect(clerkMock.signInProps[0]).toMatchObject({
      routing: "hash",
      forceRedirectUrl: "/",
    });

    const appearance = clerkMock.signInProps[0].appearance as {
      variables: { colorPrimary: string; colorBackground: string };
      elements: { headerTitle: string; formButtonPrimary: string };
    };
    expect(appearance.variables).toMatchObject({
      colorPrimary: "#004392",
      colorBackground: "#FFFFFF",
    });
    expect(appearance.elements.headerTitle).toContain("font-heading");
    expect(appearance.elements.formButtonPrimary).toContain(
      "!text-primary-foreground",
    );
  });

  it("redirects signed-in users to the parts board", () => {
    renderAt("/login");

    expect(
      screen.getByRole("heading", { name: "Robot parts" }),
    ).toBeInTheDocument();
  });

  // A link to a part, opened while signed out, used to end on the parts board.
  it("sends someone back to the page they were trying to reach", () => {
    clerkMock.isSignedIn = false;
    renderAt("/login?next=%2Fparts%2Fpt_1");
    expect(clerkMock.signInProps[0]).toMatchObject({
      forceRedirectUrl: "/parts/pt_1",
    });
  });

  it("won't send anyone to another site after signing in", () => {
    clerkMock.isSignedIn = false;
    renderAt("/login?next=%2F%2Fevil.example");
    expect(clerkMock.signInProps[0]).toMatchObject({ forceRedirectUrl: "/" });
  });

  it("takes someone already signed in straight to where they were going", () => {
    renderAt("/login?next=%2Ftodos");
    expect(
      screen.getByRole("heading", { name: "To-do list" }),
    ).toBeInTheDocument();
  });

  it("opens the parts board with its six stage columns", () => {
    renderAt("/parts");

    expect(
      screen.getByRole("heading", { name: "Robot parts" }),
    ).toBeInTheDocument();
    for (const label of [
      "1. In design",
      "2. Needs drawing",
      "3. Ready to make",
      "4. Ready to finish",
      "5. Ready to assemble",
      "6. Assembled",
    ]) {
      expect(
        screen.getAllByRole("heading", { name: label }).length,
      ).toBeGreaterThan(0);
    }
  });

  it("lays the sidebar out in its sections, in order", () => {
    const { container } = renderAt("/parts");
    const nav = container.querySelector("nav")!;

    const headings = Array.from(nav.querySelectorAll("p")).map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Parts", "To Do", "Software", "Settings"]);

    const links = Array.from(nav.querySelectorAll("a")).map(
      (el) =>
        // The badge count rides inside the link, so read the label span only.
        el.querySelector("span")?.textContent,
    );
    expect(links).toEqual([
      "Dashboard",
      "Subsystems",
      "Parts Board",
      "My Parts",
      "Manufacturing",
      "Ordering",
      "New from Onshape",
      "To-do List",
      "My To-dos",
      "Issues",
      "My Issues",
      "Settings",
    ]);
  });

  it("lines the sidebar's divider up with the header's bottom border", () => {
    // Two elements draw the app bar, and if their heights drift the two rules
    // don't meet — a visible step across the top of every screen. jsdom does
    // no layout, so compare the height each one is asking for.
    const { container } = renderAt("/parts");
    const heightOf = (el: Element | null) =>
      el && Array.from(el.classList).find((c) => /^h-\d+$/.test(c));

    const sidebarBar = container.querySelector("aside > div");
    const headerBar = container.querySelector("header > div.lg\\:flex");

    expect(heightOf(sidebarBar)).toBeDefined();
    expect(heightOf(headerBar)).toBe(heightOf(sidebarBar));
  });

  it("has an ordering board with a column per state", () => {
    // "Ordering" is also the nav link, so match the heading itself.
    renderAt("/ordering");
    expect(
      screen.getByRole("heading", { name: "Ordering" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing bought yet.")).toBeInTheDocument();
  });

  it("has a My Issues page that says when you've picked nothing up", () => {
    renderAt("/my-issues");
    expect(screen.getByText("My issues")).toBeInTheDocument();
    expect(screen.getByText("Nothing picked up yet.")).toBeInTheDocument();
  });

  it("gives the shop screen a part-number box instead of a scanner", () => {
    renderAt("/manufacturing");

    expect(screen.getByLabelText("Part number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
  });

  it("navigates through the sidebar drawer to the to-do list", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("link", { name: "To-do List" }));

    expect(
      screen.getByRole("heading", { name: "To-do list" }),
    ).toBeInTheDocument();
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
