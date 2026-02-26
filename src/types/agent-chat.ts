export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface AgentChat {
  id: string;
  user_id: string;
  agent_name: string;
  messages: ChatMessage[];
  created_at: string;
}
