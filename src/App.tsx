import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { QueryProvider } from "@/providers/query-provider";
import { AuthGuard } from "@/components/auth-guard";
import { DashboardLayout } from "@/app/DashboardLayout";
import LoginPage from "@/routes/login";
import ProjectsPage from "@/routes/projects";
import ProjectDetailPage from "@/routes/project-detail";
import PacStPage from "@/routes/pac-st";
import AgentsPage from "@/routes/agents";
import PatternsPage from "@/routes/patterns";
import TiaConsolePage from "@/routes/tia-console";

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          { path: "projects", element: <ProjectsPage /> },
          { path: "projects/:id", element: <ProjectDetailPage /> },
          { path: "pac-st", element: <PacStPage /> },
          { path: "agents", element: <AgentsPage /> },
          { path: "patterns", element: <PatternsPage /> },
          { path: "tia-console", element: <TiaConsolePage /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  );
}
