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
const HmiBuilderPage = lazy(() => import("@/routes/hmi-builder"));
const PacLadPage = lazy(() => import("@/routes/pac-lad"));
const ProfilePage = lazy(() => import("@/routes/profile"));
const DropboxCallbackPage = lazy(() => import("@/routes/dropbox-callback"));
const ForgePage = lazy(() => import("@/routes/forge"));
const MigratePage = lazy(() => import("@/routes/migrate"));
const LibraryImportPage = lazy(() => import("@/routes/library-import"));
const TestTemplatesPage = lazy(() => import("@/routes/test-templates"));
const ClientsPage = lazy(() => import("@/routes/clients"));
const InstructionLibraryPage = lazy(() => import("@/routes/instruction-library"));
const SpecBuilderPage = lazy(() => import("@/routes/spec-builder"));
const SpecBuilderIngestReviewPage = lazy(() => import("@/routes/spec-builder-ingest-review"));
const SpecCoAuthorPage = lazy(() => import("@/routes/spec-co-author"));
const SpecEditorRoute = lazy(() => import("@/routes/spec-editor"));
const SpecExportPage = lazy(() => import("@/routes/spec-export"));
const SpecSystemOrchestrationPage = lazy(() => import("@/routes/spec-system-orchestration"));
const DashboardPage = lazy(() => import("@/routes/dashboard"));
const PacAuditPage = lazy(() => import("@/routes/pac-audit"));
const PacAuditWorkspacePage = lazy(() => import("@/routes/pac-audit-workspace"));
const QuoteBuilderPage = lazy(() => import("@/routes/quote-builder"));
const QuoteViewPage = lazy(() => import("@/routes/quote-view"));
const TncLibraryPage = lazy(() => import("@/routes/tnc-library"));

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
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <LazyRoute><DashboardPage /></LazyRoute> },
          { path: "projects", element: <ProjectsPage /> },
          { path: "clients", element: <LazyRoute><ClientsPage /></LazyRoute> },
          { path: "forge", element: <LazyRoute><ForgePage /></LazyRoute> },
          { path: "migrate", element: <LazyRoute><MigratePage /></LazyRoute> },
          { path: "pac-audit", element: <LazyRoute><PacAuditPage /></LazyRoute> },
          { path: "pac-audit/:sessionId/workspace", element: <LazyRoute><PacAuditWorkspacePage /></LazyRoute> },
          { path: "projects/:id", element: <LazyRoute><ProjectDetailPage /></LazyRoute> },
          { path: "quotes/:revId/edit", element: <LazyRoute><QuoteBuilderPage /></LazyRoute> },
          { path: "quotes/:revId/view", element: <LazyRoute><QuoteViewPage /></LazyRoute> },
          { path: "tnc", element: <LazyRoute><TncLibraryPage /></LazyRoute> },
          { path: "pac-st", element: <Navigate to="/pac-st/chat" replace /> },
          { path: "pac-st/chat", element: <LazyRoute><PacStPage /></LazyRoute> },
          { path: "pac-st/fb-builder", element: <LazyRoute><FbBuilderPage /></LazyRoute> },
          { path: "pac-st/process", element: <LazyRoute><ProcessBuilderPage /></LazyRoute> },
          { path: "agents", element: <LazyRoute><AgentsPage /></LazyRoute> },
          { path: "agents/:id", element: <LazyRoute><AgentProfilePage /></LazyRoute> },
          { path: "patterns", element: <LazyRoute><PatternsPage /></LazyRoute> },
          { path: "tia-console", element: <LazyRoute><TiaConsolePage /></LazyRoute> },
          { path: "fb-library", element: <LazyRoute><FbLibraryPage /></LazyRoute> },
          { path: "test-templates", element: <LazyRoute><TestTemplatesPage /></LazyRoute> },
          { path: "library-import", element: <LazyRoute><LibraryImportPage /></LazyRoute> },
          { path: "instructions", element: <LazyRoute><InstructionLibraryPage /></LazyRoute> },
          { path: "specs", element: <LazyRoute><SpecBuilderPage /></LazyRoute> },
          { path: "specs/ingest-review", element: <LazyRoute><SpecBuilderIngestReviewPage /></LazyRoute> },
          { path: "specs/:projectId/:specId/co-author", element: <LazyRoute><SpecCoAuthorPage /></LazyRoute> },
          { path: "specs/:projectId/:specId/editor", element: <LazyRoute><SpecEditorRoute /></LazyRoute> },
          { path: "specs/:projectId/:specId/export", element: <LazyRoute><SpecExportPage /></LazyRoute> },
          { path: "specs/:projectId/:specId/system-orchestration", element: <LazyRoute><SpecSystemOrchestrationPage /></LazyRoute> },
          { path: "profiles", element: <LazyRoute><ProfilesPage /></LazyRoute> },
          { path: "profiles/:id", element: <LazyRoute><ProfileDetailPage /></LazyRoute> },
          { path: "knowledge", element: <LazyRoute><KnowledgePage /></LazyRoute> },
          { path: "prompts", element: <LazyRoute><PromptEditorPage /></LazyRoute> },
          { path: "reference-library", element: <LazyRoute><ReferenceLibraryPage /></LazyRoute> },
          { path: "hmi-editor", element: <LazyRoute><HmiEditorPage /></LazyRoute> },
          { path: "hmi-builder", element: <LazyRoute><HmiBuilderPage /></LazyRoute> },
          { path: "pac-lad", element: <LazyRoute><PacLadPage /></LazyRoute> },
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
