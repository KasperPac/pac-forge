import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getAgentProfile,
  COLOR_CLASSES,
  type ProfileColor,
} from "@/lib/agent-profiles";
import { useAgentChatStore } from "@/stores/agent-chat-store";
import { AgentSelector } from "./agent-selector";
import { AgentChatPanel } from "./agent-chat-panel";

export function AgentChatFab() {
  const { view, selectedAgent, isStreaming, openSelector } =
    useAgentChatStore();

  // Determine FAB color based on active agent
  const agentColors = selectedAgent
    ? COLOR_CLASSES[getAgentProfile(selectedAgent).color as ProfileColor]
    : null;

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {/* Expanded content (selector or panel) */}
      {view === "selecting" && <AgentSelector />}
      {view === "chatting" && <AgentChatPanel />}

      {/* FAB button — only show when closed or chatting (to allow re-open) */}
      {(view === "closed" || view === "chatting") && (
        <Button
          onClick={openSelector}
          className={`h-12 w-12 rounded-full shadow-lg ${
            selectedAgent && agentColors
              ? `${agentColors.bg} ${agentColors.text} hover:${agentColors.bg}`
              : ""
          }`}
          variant={selectedAgent ? "outline" : "default"}
          size="icon"
          title="Chat with an agent"
        >
          <MessageCircle className="h-5 w-5" />
          {isStreaming && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-green-500 animate-pulse" />
          )}
        </Button>
      )}
    </div>
  );
}
