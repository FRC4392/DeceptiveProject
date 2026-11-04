import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useMutation,
} from "convex/react";
import { api } from "../convex/_generated/api";
import { AppShell } from "@/Layout";
import { DashboardPage } from "@/routes/DashboardPage";
import { TodoBoardPage } from "@/routes/TodoBoardPage";
import { TodoPage } from "@/routes/TodoPage";
import { MyTodosPage } from "@/routes/MyTodosPage";
import { SettingsPage } from "@/routes/SettingsPage";
import { OnshapeAdminPage } from "@/routes/OnshapeAdminPage";
import { GitHubAdminPage } from "@/routes/GitHubAdminPage";
import { PartsBoardPage } from "@/routes/PartsBoardPage";
import { PartPage } from "@/routes/PartPage";
import { ShopPage } from "@/routes/ShopPage";
import { MyPartsPage } from "@/routes/MyPartsPage";
import { SubsystemsPage } from "@/routes/SubsystemsPage";
import { AssemblyPage } from "@/routes/AssemblyPage";
import { IntakePage } from "@/routes/IntakePage";
import { InventoryPage } from "@/routes/InventoryPage";
import { OrderingPage } from "@/routes/OrderingPage";
import { IssuesPage } from "@/routes/IssuesPage";
import { MyIssuesPage } from "@/routes/MyIssuesPage";
import { IssueDetailPage } from "@/routes/IssueDetailPage";
import { LoginPage } from "@/routes/LoginPage";
import { loginPathFor } from "@/lib/redirect";

/** How long to wait before each retry of writing the user row, in ms. */
const STORE_USER_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function StoreCurrentUser() {
  const { isAuthenticated } = useConvexAuth();
  const storeCurrentUser = useMutation(api.auth.storeCurrentUser);

  // The `users` row is what every write checks a role against. This effect
  // runs once per sign-in, so a single failed attempt used to mean no row for
  // as long as the tab stayed open — reads still work off the session, but a
  // mentor couldn't save anything. Keep trying for a while instead.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (n: number) => {
      storeCurrentUser().catch((err: unknown) => {
        if (cancelled) return;
        const delay = STORE_USER_RETRY_MS[n];
        if (delay === undefined) {
          console.error("Couldn't save your sign-in; giving up.", err);
          return;
        }
        console.warn(`Couldn't save your sign-in; retrying in ${delay}ms.`);
        timer = setTimeout(() => attempt(n + 1), delay);
      });
    };
    attempt(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isAuthenticated, storeCurrentUser]);

  return null;
}

function RequireAuth() {
  const location = useLocation();
  return (
    <>
      <AuthLoading>
        <div className="flex h-screen items-center justify-center text-muted-foreground">
          Loading…
        </div>
      </AuthLoading>
      <Unauthenticated>
        {/* Bring them back here afterwards. A shared link to a part used to
            land everyone on the parts board once they'd signed in. */}
        <Navigate
          to={loginPathFor(location.pathname + location.search)}
          replace
        />
      </Unauthenticated>
      <Authenticated>
        <StoreCurrentUser />
        <Outlet />
      </Authenticated>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/parts" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* The to-do list */}
          <Route path="/todos" element={<TodoBoardPage />} />
          <Route path="/todos/:todoId" element={<TodoPage />} />
          <Route path="/my-todos" element={<MyTodosPage />} />
          {/* The part tracker */}
          <Route path="/parts" element={<PartsBoardPage />} />
          <Route path="/parts/from-onshape" element={<IntakePage />} />
          <Route path="/parts/:partId" element={<PartPage />} />
          <Route path="/subsystems" element={<SubsystemsPage />} />
          <Route path="/assemblies/:assemblyId" element={<AssemblyPage />} />
          <Route path="/my-parts" element={<MyPartsPage />} />
          <Route path="/manufacturing" element={<ShopPage />} />
          <Route path="/ordering" element={<OrderingPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/my-issues" element={<MyIssuesPage />} />
          <Route path="/issues/:issueId" element={<IssueDetailPage />} />
          <Route path="/admin" element={<SettingsPage />} />
          <Route path="/admin/onshape" element={<OnshapeAdminPage />} />
          <Route path="/admin/github" element={<GitHubAdminPage />} />
          {/* The settings split used to live here; keep old links working. */}
          <Route
            path="/admin/tracker"
            element={<Navigate to="/admin" replace />}
          />
          <Route path="*" element={<Navigate to="/parts" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
