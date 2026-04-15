import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  projectId: string;
  specProjectId?: string | null;
}

/**
 * Empty-state card shown when a forge session is opened but the bound
 * `spec_project_id` has no approved revision yet. Forge cannot proceed
 * without an approved revision because reads go through the contract
 * accessor and require a revision_id.
 */
export function SpecRevisionRequiredEmptyState({ projectId, specProjectId }: Props) {
  const href = specProjectId
    ? `/spec-builder?projectId=${projectId}&specProjectId=${specProjectId}`
    : `/spec-builder?projectId=${projectId}`;
  return (
    <div className="flex items-center justify-center p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Approved spec revision required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Forge is a read-only consumer of the spec contract. Before it can
            run, the linked spec project needs at least one approved revision.
          </p>
          <Button asChild>
            <Link to={href}>Go to Spec Builder</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
