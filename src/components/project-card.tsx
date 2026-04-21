import { useNavigate } from "react-router";
import { Cpu, Clock, Trash2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/ui-store";
import type { Project } from "@/types";
import { cn } from "@/lib/utils";

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();
  const { activeProjectId, setActiveProjectId } = useUiStore();
  const isActive = activeProjectId === project.id;

  return (
    <Card
      className={cn(
        "group cursor-pointer p-4 transition-colors hover:bg-accent/30",
        isActive && "border-green-500/50 bg-green-500/5"
      )}
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{project.client_name}</h3>
            {isActive && (
              <Badge variant="outline" className="border-green-500/50 font-mono text-[9px] text-green-400">
                <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
                Active
              </Badge>
            )}
          </div>
          {project.project_number && (
            <div className="font-mono text-xs text-muted-foreground">{project.project_number}</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {project.plc_brand}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              <Cpu className="mr-1 h-3 w-3" />
              {project.cpu_type}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {project.tia_version}
            </Badge>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {project.safety_level && project.safety_level !== "None" && (
        <Badge variant="destructive" className="mt-2 font-mono text-[10px]">
          {project.safety_level}
        </Badge>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="font-mono">
            {new Date(project.updated_at).toLocaleDateString()}
          </span>
        </div>
        <Button
          size="sm"
          variant={isActive ? "secondary" : "outline"}
          className={cn(
            "h-6 gap-1 px-2 font-mono text-[10px]",
            isActive
              ? "border-green-500/40 text-green-400"
              : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => {
            e.stopPropagation();
            setActiveProjectId(isActive ? null : project.id);
          }}
        >
          <CheckCircle2 className="h-3 w-3" />
          {isActive ? "Active" : "Select"}
        </Button>
      </div>
    </Card>
  );
}
