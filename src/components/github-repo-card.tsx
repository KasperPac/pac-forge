import { Link } from "react-router";
import { ExternalLink, Github, GitCommitHorizontal, Loader2 } from "lucide-react";
import {
  deriveGitHubRepoName,
  useCreateGitHubRepo,
  useGitHubCommits,
  useGitHubConnection,
  useGitHubRepo,
} from "@/hooks/use-github";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Project } from "@/types";

function formatCommitDate(date: string) {
  return new Date(date).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function GitHubRepoCard({ project }: { project: Project }) {
  const { connection, isLoading: connectionLoading } = useGitHubConnection();
  const createRepo = useCreateGitHubRepo();
  const repoName = project.github_repo_name;
  const suggestedRepoName = deriveGitHubRepoName(project);
  const repoQuery = useGitHubRepo(repoName);
  const commitsQuery = useGitHubCommits(repoName, 5);

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-sm font-medium">GitHub Repository</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Private project repository for revision history and future artifact sync.
            </p>
          </div>
          {repoName && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {repoName}
            </Badge>
          )}
        </div>

        {!repoName ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4">
            {connectionLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking GitHub connection...
              </div>
            ) : connection.connected ? (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Connected as @{connection.username}. Create a private repository for this project now.
                </div>
                <div className="rounded-md border border-border/70 bg-card/60 px-3 py-2">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Suggested Repo Name
                  </div>
                  <div className="mt-1 font-mono text-sm">{suggestedRepoName}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    createRepo.mutate({
                      projectId: project.id,
                      repoName: suggestedRepoName,
                      description: project.description_short ?? project.description_long ?? "",
                    })
                  }
                  disabled={createRepo.isPending}
                >
                  {createRepo.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Github className="h-4 w-4" />
                  )}
                  Create Private Repository
                </Button>
                {createRepo.isError && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {createRepo.error?.message ?? "Failed to create repository"}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">
                    GitHub is not connected for this account.
                  </div>
                  <div className="text-xs text-muted-foreground/70">
                    Connect GitHub in your profile settings before creating a repository.
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/profile">Open Profile Settings</Link>
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-mono text-sm">{repoName}</div>
                {project.github_repo_url && (
                  <a
                    href={project.github_repo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Open repository
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                {repoQuery.data?.private && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Private
                  </Badge>
                )}
                {repoQuery.data?.default_branch && (
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {repoQuery.data.default_branch}
                  </Badge>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border/70 bg-background/40 p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <GitCommitHorizontal className="h-3.5 w-3.5" />
                Recent Commits
              </div>
              {commitsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading commits...
                </div>
              ) : commitsQuery.isError ? (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {commitsQuery.error?.message ?? "Failed to load commits"}
                </div>
              ) : commitsQuery.data && commitsQuery.data.length > 0 ? (
                <div className="space-y-2">
                  {commitsQuery.data.map((commit) => (
                    <div key={commit.sha} className="rounded-md border border-border/70 bg-card/60 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            href={commit.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-medium hover:text-primary"
                          >
                            {commit.message.split("\n")[0]}
                          </a>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {commit.sha.slice(0, 7)} by {commit.author}
                          </div>
                        </div>
                        <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {formatCommitDate(commit.date)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No commits found yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
