import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useMutation,
} from "convex/react";
import { SignIn } from "@clerk/react";
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

function SignInScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#001730] px-4 py-8 text-center text-white sm:px-6">
      <img
        src="/brand/logo-banner.png"
        alt="Deceivers Robotics Team 4392"
        className="mb-8 h-auto w-72 max-w-[82vw] object-contain sm:w-80"
      />
      <SignIn
        routing="hash"
        forceRedirectUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: "#3F7FD2",
            colorPrimaryForeground: "#FFFFFF",
            colorBackground: "#04264C",
            colorForeground: "#F8FBFF",
            colorMutedForeground: "#AFC1D6",
            colorInput: "#2A292E",
            colorInputForeground: "#F8FBFF",
            colorBorder: "#3D4D66",
            colorRing: "#5B94E5",
            colorDanger: "#C8452F",
            colorNeutral: "#EAF1F9",
            colorShadow: "#000B17",
            borderRadius: "1.5rem",
            fontFamily: "'Hanken Grotesk', sans-serif",
            fontFamilyButtons: "'Hanken Grotesk', sans-serif",
          },
          elements: {
            rootBox: "w-full max-w-[31rem]",
            cardBox: "w-full shadow-none",
            card: "w-full overflow-hidden border border-[#143A63] bg-[#04264C] text-white shadow-[0_1.5rem_4rem_rgba(0,0,0,0.28)]",
            logoBox: "mx-auto mb-4",
            logoImage: "h-14 w-14",
            header: "pb-6",
            headerTitle:
              "brand-title text-2xl text-white sm:text-3xl [letter-spacing:0]",
            headerSubtitle: "text-base font-semibold text-[#AFC1D6] sm:text-lg",
            main: "px-5 pb-8 sm:px-12",
            formField: "text-left",
            formFieldLabel: "mb-2 text-base font-bold text-white",
            formFieldInput:
              "h-12 rounded-[0.875rem] border-[#3D4D66] bg-[#2A292E] px-4 text-base font-semibold text-white placeholder:text-[#B8B8BE] focus:border-[#5B94E5] focus:ring-[#5B94E5]",
            formButtonPrimary:
              "h-12 rounded-[0.875rem] bg-[#3F7FD2] text-base font-bold !text-white shadow-[inset_0_0.125rem_0_rgba(255,255,255,0.16)] hover:bg-[#4D8ADD] focus-visible:ring-2 focus-visible:ring-[#8FB6E4]",
            buttonArrowIcon: "text-[#C5D8F2]",
            footer: "border-t border-[#143A63] bg-[#0B2C50]",
            footerActionText: "text-[#AFC1D6]",
            footerActionLink: "font-bold text-[#8FB6E4] hover:text-white",
            footerPagesLink: "text-[#AFC1D6] hover:text-white",
          },
          options: {
            logoImageUrl: "/brand/logo-mark.png",
            logoPlacement: "inside",
          },
        }}
      />
    </div>
  );
}

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
        <SignInScreen />
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
