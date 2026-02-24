import { cn } from "@/lib/utils";
import {
  getAgentProfile,
  COLOR_CLASSES,
  type ProfileColor,
} from "@/lib/agent-profiles";
import { getAgentAvatar } from "@/components/agent-avatars";
import type { AgentStatus } from "@/types";

const SIZE_CLASSES = {
  xs: { container: "h-5 w-5", icon: "h-3 w-3", dot: "h-1.5 w-1.5" },
  sm: { container: "h-8 w-8", icon: "h-4 w-4", dot: "h-2 w-2" },
  md: { container: "h-12 w-12", icon: "h-6 w-6", dot: "h-2.5 w-2.5" },
  lg: { container: "h-16 w-16", icon: "h-8 w-8", dot: "h-3 w-3" },
  xl: { container: "h-28 w-28", icon: "h-14 w-14", dot: "h-4 w-4" },
} as const;

const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "bg-green-500",
  RESERVED: "bg-amber-500",
  OFFLINE: "bg-neutral-500",
  DISABLED: "bg-neutral-600",
};

interface AgentAvatarProps {
  displayName: string;
  size?: keyof typeof SIZE_CLASSES;
  status?: AgentStatus;
  className?: string;
}

export function AgentAvatar({
  displayName,
  size = "md",
  status,
  className,
}: AgentAvatarProps) {
  const profile = getAgentProfile(displayName);
  const colors = COLOR_CLASSES[profile.color as ProfileColor] ?? COLOR_CLASSES.neutral;
  const sizing = SIZE_CLASSES[size];
  const Icon = profile.icon;
  const SvgAvatar = getAgentAvatar(displayName);

  // Use SVG character avatar for xl size
  const useCharacterAvatar = size === "xl" && SvgAvatar;

  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      {useCharacterAvatar ? (
        <div
          className={cn(
            "overflow-hidden rounded-full ring-2",
            colors.ring,
            sizing.container
          )}
        >
          <SvgAvatar className="h-full w-full" />
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full",
            colors.bg,
            sizing.container
          )}
        >
          <Icon className={cn(sizing.icon, colors.text)} />
        </div>
      )}
      {status && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2 ring-background",
            sizing.dot,
            STATUS_DOT[status] ?? STATUS_DOT.OFFLINE
          )}
        />
      )}
    </div>
  );
}
