import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { QueryProvider } from "@/providers/query-provider";
import { AuthGuard } from "@/components/auth-guard";
import { DashboardLayout } from "@/app/DashboardLayout";
import { RouteLoader } from "@/components/route-loader";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { Toaster } from "@/components/ui/toaster";
import LoginPage from "@/routes/login";
import ProjectsPage from "@/routes/projects";

// Lazy-loaded routes (heavy pages)
const ProjectDetailPage = lazy(() => import("@/routes/project-detail"));
const PacStPage = lazy(() => import("@/routes/pac-st"));
const ProcessBuilderPage = lazy(() => import("@/routes/process-builder"));
const AgentsPage = lazy(() => import("@/routes/agents"));
const AgentProfilePage = lazy(() => import("@/routes/agent-profile"));
const PatternsPage = lazy(() => import("@/routes/patterns"));
const TiaConsolePage = lazy(() => import("@/routes/tia-console"));
const FbLibraryPage = lazy(() => import("@/routes/fb-library"));
const ProfilesPage = lazy(() => import("@/routes/profiles"));
const ProfileDetailPage = lazy(() => import("@/routes/profile-detail"));
const KnowledgePage = lazy(() => import("@/routes/knowledge"));
const PromptEditorPage = lazy(() => import("@/routes/prompt-editor"));
const ReferenceLibraryPage = lazy(() => import("@/routes/reference-library"));
const FbBuilderPage = lazy(() => import("@/routes/fb-builder"));
const HmiEditorPage = lazy(() => import("@/routes/hmi-editor"));
const ProfilePage = lazy(() => import("@/routes/profile"));
const DropboxCallbackPage = lazy(() => import("@/routes/dropbox-callback"));

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoader />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

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
          { path: "projects/:id", element: <LazyRoute><ProjectDetailPage /></LazyRoute> },
          { path: "pac-st", element: <Navigate to="/pac-st/chat" replace /> },
          { path: "pac-st/chat", element: <LazyRoute><PacStPage /></LazyRoute> },
          { path: "pac-st/fb-builder", element: <LazyRoute><FbBuilderPage /></LazyRoute> },
          { path: "pac-st/process", element: <LazyRoute><ProcessBuilderPage /></LazyRoute> },
          { path: "agents", element: <LazyRoute><AgentsPage /></LazyRoute> },
          { path: "agents/:id", element: <LazyRoute><AgentProfilePage /></LazyRoute> },
          { path: "patterns", element: <LazyRoute><PatternsPage /></LazyRoute> },
          { path: "tia-console", element: <LazyRoute><TiaConsolePage /></LazyRoute> },
          { path: "fb-library", element: <LazyRoute><FbLibraryPage /></LazyRoute> },
          { path: "profiles", element: <LazyRoute><ProfilesPage /></LazyRoute> },
          { path: "profiles/:id", element: <LazyRoute><ProfileDetailPage /></LazyRoute> },
          { path: "knowledge", element: <LazyRoute><KnowledgePage /></LazyRoute> },
          { path: "prompts", element: <LazyRoute><PromptEditorPage /></LazyRoute> },
          { path: "reference-library", element: <LazyRoute><ReferenceLibraryPage /></LazyRoute> },
          { path: "hmi-editor", element: <LazyRoute><HmiEditorPage /></LazyRoute> },
          { path: "profile", element: <LazyRoute><ProfilePage /></LazyRoute> },
          { path: "dropbox-callback", element: <LazyRoute><DropboxCallbackPage /></LazyRoute> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <QueryProvider>
      <RouterProvider router={router} />
      <Toaster />
    </QueryProvider>
  );
}
