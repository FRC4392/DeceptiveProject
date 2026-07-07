import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useAuth } from "@workos-inc/authkit-react";
import { AppShell } from "@/Layout";
import { Button } from "@/components/ui/button";
import { LoginRoute } from "@/routes/LoginRoute";
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

function SignInScreen() {
  const { signIn } = useAuth();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <img
        src="/brand/logo-mark.png"
        alt="Deceivers Robotics"
        className="h-20 w-20 object-contain"
      />
      <div className="space-y-2">
        <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground">
          FRC · TEAM 4392
        </p>
        <h1 className="brand-title text-4xl">Deceivers Robotics</h1>
        <p className="text-muted-foreground">
          Project management, parts, and issue tracking — built by students.
        </p>
      </div>
      <Button size="lg" onClick={() => void signIn()}>
        Sign in
      </Button>
    </div>
  );
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
        <SignInScreen />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
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
