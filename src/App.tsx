import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
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
import { BoardsPage } from "@/routes/BoardsPage";
import { BoardPage } from "@/routes/BoardPage";
import { TaskDetailPage } from "@/routes/TaskDetailPage";
import { MyTasksPage } from "@/routes/MyTasksPage";
import { CalendarPage } from "@/routes/CalendarPage";
import { TimelinePage } from "@/routes/TimelinePage";
import { MobilePage } from "@/routes/MobilePage";
import { AdminPage } from "@/routes/AdminPage";
import { OnshapeAdminPage } from "@/routes/OnshapeAdminPage";
import { GitHubAdminPage } from "@/routes/GitHubAdminPage";
import { PartsPage } from "@/routes/PartsPage";
import { PartDetailPage } from "@/routes/PartDetailPage";
import { InventoryPage } from "@/routes/InventoryPage";
import { IssuesPage } from "@/routes/IssuesPage";
import { IssueDetailPage } from "@/routes/IssueDetailPage";
import { LoginPage } from "@/routes/LoginPage";

function StoreCurrentUser() {
  const { isAuthenticated } = useConvexAuth();
  const storeCurrentUser = useMutation(api.auth.storeCurrentUser);

  useEffect(() => {
    if (!isAuthenticated) return;
    void storeCurrentUser();
  }, [isAuthenticated, storeCurrentUser]);

  return null;
}

function RequireAuth() {
  return (
    <>
      <AuthLoading>
        <div className="flex h-screen items-center justify-center text-muted-foreground">
          Loading…
        </div>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/login" replace />
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/boards" element={<BoardsPage />} />
          <Route path="/boards/:boardId" element={<BoardPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/my-tasks" element={<MyTasksPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/mobile" element={<MobilePage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/parts/:partId" element={<PartDetailPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/issues/:issueId" element={<IssueDetailPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/onshape" element={<OnshapeAdminPage />} />
          <Route path="/admin/github" element={<GitHubAdminPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
