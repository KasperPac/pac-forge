import { useNavigate } from "react-router";
import { Cpu, Clock, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types";

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className="group cursor-pointer p-4 transition-colors hover:bg-accent/30"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{project.client_name}</h3>
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

      <div className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span className="font-mono">
          {new Date(project.updated_at).toLocaleDateString()}
        </span>
      </div>
    </Card>
  );
}
