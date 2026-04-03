import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, useUpdateProfile, useUploadAvatar } from "@/hooks/use-profile";
import { useUserAuditLog, useUserAgentChats } from "@/hooks/use-user-activity";
import { useDropboxConnection, useDropboxConnect, useDropboxDisconnect, useDropboxExchangeCode } from "@/hooks/use-dropbox";
import { useGitHubConnection } from "@/hooks/use-github";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { buildLibraryFolder, buildProjectPlcFolder } from "@/lib/dropbox-paths";
import { getRedirectUri } from "@/lib/dropbox-oauth";
import { useToast } from "@/hooks/use-toast";
import { GitHubConnectDialog } from "@/components/github-connect-dialog";
import { useUiStore } from "@/stores/ui-store";
import type { AgentChatEntry } from "@/hooks/use-user-activity";
import type { AuditLogEntry } from "@/types/tia";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User,
  Shield,
  Calendar,
  Mail,
  Camera,
  Loader2,
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Bot,
  CloudOff,
  Cloud,
  Github,
  FolderOpen,
} from "lucide-react";

function getInitials(displayName: string | undefined, email: string | undefined): string {
  if (displayName) {
    return displayName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email?.[0] ?? "?").toUpperCase();
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const ACTION_COLORS: Record<string, string> = {
  GENERATION: "border-green-500/30 bg-green-500/10 text-green-400",
  APPROVAL: "border-green-500/30 bg-green-500/10 text-green-400",
  APPROVE_ALL: "border-green-500/30 bg-green-500/10 text-green-400",
  EXPORT: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  TIA_SUBMIT: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  TIA_IMPORT: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  TIA_COMPILE: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  COMPILE_FIX: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  SESSION_START: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  SESSION_END: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  PATTERN_APPROVE: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  PATTERN_REJECT: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  PATTERN_REVOKE: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  SNAPSHOT_CREATE: "border-red-500/30 bg-red-500/10 text-red-400",
  SNAPSHOT_ROLLBACK: "border-red-500/30 bg-red-500/10 text-red-400",
  CLEAR_WORKSPACE: "border-red-500/30 bg-red-500/10 text-red-400",
};

function AuditLogRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.details && Object.keys(entry.details).length > 0;
  const colorClass = ACTION_COLORS[entry.action] ?? "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/30"
        onClick={() => hasDetails && setExpanded((e) => !e)}
        disabled={!hasDetails}
      >
        {hasDetails ? (
          expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <div className="h-4 w-4 shrink-0" />
        )}
        <Badge variant="outline" className={`shrink-0 px-1.5 py-0 font-mono text-[10px] ${colorClass}`}>
          {entry.action.replace(/_/g, " ")}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {entry.project_id ? `Project: ${entry.project_id.slice(0, 8)}...` : ""}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          {formatRelativeTime(entry.created_at)}
        </span>
      </button>
      {expanded && hasDetails && (
        <div className="border-t px-3 py-2">
          <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentChatRow({ chat }: { chat: AgentChatEntry }) {
  const [expanded, setExpanded] = useState(false);
  const firstUserMsg = chat.messages.find((m) => m.role === "user");
  const preview = firstUserMsg?.content.slice(0, 80) ?? "No messages";

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/30"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{chat.agent_name}</span>
            <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[10px]">
              {chat.messages.length} msgs
            </Badge>
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {preview}{preview.length >= 80 ? "..." : ""}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          {formatRelativeTime(chat.created_at)}
        </span>
      </button>
      {expanded && (
        <div className="border-t px-3 py-3">
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {chat.messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    msg.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                    {msg.content}
                  </pre>
                  <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground/60">
                    {msg.timestamp ? formatRelativeTime(msg.timestamp) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const { data: auditLog, isLoading: auditLoading } = useUserAuditLog();
  const { data: agentChats, isLoading: chatsLoading } = useUserAgentChats();
  const { data: dropboxConn, isLoading: dropboxLoading } = useDropboxConnection();
  const { connection: githubConnection, isLoading: githubLoading } = useGitHubConnection();
  const { data: fbTemplates = [] } = useFbTemplates();
  const dropboxConnect = useDropboxConnect();
  const dropboxDisconnect = useDropboxDisconnect();
  const dropboxExchange = useDropboxExchangeCode();
  const { toast } = useToast();

  const { dropboxRoot, setDropboxRoot } = useUiStore();
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [dropboxRootDraft, setDropboxRootDraft] = useState("");
  const [dropboxExchangeError, setDropboxExchangeError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exchangeProcessedRef = useRef(false);

  // Handle pending Dropbox OAuth exchange (saved by callback page)
  const processPendingExchange = useCallback(async () => {
    if (exchangeProcessedRef.current) return;
    const raw = sessionStorage.getItem("dropbox_pending_exchange");
    if (!raw) return;
    exchangeProcessedRef.current = true;
    sessionStorage.removeItem("dropbox_pending_exchange");

    try {
      const pending = JSON.parse(raw);
      if (pending.error) {
        setDropboxExchangeError(pending.error);
        return;
      }
      const { code, code_verifier } = pending;
      if (!code || !code_verifier) {
        setDropboxExchangeError("Missing exchange parameters.");
        return;
      }

      await dropboxExchange.mutateAsync({
        code,
        code_verifier,
        redirect_uri: getRedirectUri(),
      });

      toast({
        title: "Dropbox connected",
        description: "Your team's Dropbox is now linked.",
      });
    } catch (err) {
      setDropboxExchangeError(err instanceof Error ? err.message : "Exchange failed");
    }
  }, [dropboxExchange, toast]);

  useEffect(() => {
    queueMicrotask(() => {
      void processPendingExchange();
    });
  }, [processPendingExchange]);

  useEffect(() => {
    const persistedRoot = profile?.dropbox_root_path ?? "";
    setDropboxRoot(persistedRoot);
    setDropboxRootDraft(persistedRoot);
  }, [profile?.dropbox_root_path, setDropboxRoot]);

  const initials = getInitials(profile?.display_name, user?.email ?? undefined);
  const importedLibraries = Array.from(
    fbTemplates
      .filter((template) => template.source === "library" && template.library_name)
      .reduce((map, template) => {
        const key = template.library_name!;
        const existing = map.get(key) ?? { name: key, enabledCount: 0, templateCount: 0 };
        existing.templateCount += 1;
        if (template.is_enabled) existing.enabledCount += 1;
        map.set(key, existing);
        return map;
      }, new Map<string, { name: string; enabledCount: number; templateCount: number }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => a.name.localeCompare(b.name));
  const sampleProjectFolder = dropboxRoot
    ? buildProjectPlcFolder(dropboxRoot, "Client Name", "Project Code - Description")
    : "";
  const dropboxRootDirty = dropboxRootDraft !== (profile?.dropbox_root_path ?? "");

  function handleStartEdit() {
    setEditName(profile?.display_name ?? "");
    setIsEditing(true);
  }

  async function handleSaveName() {
    if (!editName.trim()) return;
    await updateProfile.mutateAsync({ display_name: editName.trim() });
    setIsEditing(false);
  }

  async function handleSaveDropboxRoot() {
    await updateProfile.mutateAsync({ dropbox_root_path: dropboxRootDraft.trim() || null });
    setDropboxRoot(dropboxRootDraft.trim());
    toast({
      title: "Dropbox root saved",
      description: "Library and project path derivation will use this profile setting.",
    });
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await uploadAvatar.mutateAsync(file);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-8">
        <div className="relative">
          <Avatar className="h-24 w-24">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
          </Avatar>
          <button
            type="button"
            className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm transition-colors hover:bg-accent"
            onClick={() => fileInputRef.current?.click()}
            title="Upload avatar"
          >
            {uploadAvatar.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1 className="text-3xl font-semibold tracking-tight">
            {profile?.display_name || user?.email || "User"}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">{user?.email}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <Badge variant="secondary" className="px-2 py-0.5 text-xs">
              <Shield className="mr-1 h-3 w-3" />
              {profile?.role ?? "ENGINEER"}
            </Badge>
            {profile?.created_at && (
              <Badge variant="outline" className="px-2 py-0.5 font-mono text-xs text-muted-foreground">
                <Calendar className="mr-1 h-3 w-3" />
                Joined {new Date(profile.created_at).toLocaleDateString()}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Account Details + Edit Profile + Dropbox */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Account Details
          </h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="font-mono text-sm">{user?.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Role</div>
                <div className="text-sm font-medium">{profile?.role ?? "ENGINEER"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Member Since</div>
                <div className="font-mono text-sm">
                  {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "Unknown"}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Edit Profile
          </h2>
          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <Label className="font-mono text-xs">Display Name</Label>
              {isEditing ? (
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveName}
                    disabled={updateProfile.isPending || !editName.trim()}
                  >
                    {updateProfile.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">
                    {profile?.display_name || "Not set"}
                  </span>
                  <Button size="sm" variant="ghost" onClick={handleStartEdit}>
                    Edit
                  </Button>
                </div>
              )}
            </div>
          </div>
          <Separator className="my-4" />
          <div className="space-y-1">
            <Label className="font-mono text-xs flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3" />
              Dropbox Root Folder
            </Label>
            <div className="flex gap-2">
              <Input
                className="font-mono text-sm"
                value={dropboxRootDraft}
                onChange={(e) => setDropboxRootDraft(e.target.value)}
                placeholder="C:\Users\you\Pac Technologies Dropbox"
              />
              <Button
                size="sm"
                onClick={() => void handleSaveDropboxRoot()}
                disabled={updateProfile.isPending || !dropboxRootDirty}
              >
                {updateProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Stored on your profile and synced into the local UI store for wizard library and TIA project paths.
            </p>
          </div>

          {updateProfile.isError && (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {updateProfile.error?.message ?? "Failed to update profile"}
            </div>
          )}
          {uploadAvatar.isError && (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {uploadAvatar.error?.message ?? "Failed to upload avatar"}
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Libraries
          </h2>
          <div className="mt-4 space-y-4">
            <div className="rounded-md border p-3">
              <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                TIA Project Folder Derivation
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="text-muted-foreground">
                  Derived as <span className="font-mono">Dropbox Root + Pac\Jobs\&lt;Client Name&gt;\&lt;Project Code&gt;\50 PLC</span>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
                  {sampleProjectFolder || "Save a Dropbox root above to preview the derived PLC folder path."}
                </div>
              </div>
            </div>

            <div className="rounded-md border">
              <div className="border-b px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Imported TIA Libraries
              </div>
              {importedLibraries.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">
                  No imported TIA libraries found yet.
                </div>
              ) : (
                <div className="divide-y">
                  {importedLibraries.map((library) => (
                    <div key={library.name} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">{library.name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {library.templateCount} templates
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`font-mono text-[10px] ${
                            library.enabledCount > 0
                              ? "border-green-500/30 bg-green-500/10 text-green-400"
                              : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                          }`}
                        >
                          {library.enabledCount > 0 ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                        {dropboxRoot
                          ? buildLibraryFolder(dropboxRoot, library.name)
                          : "Save a Dropbox root above to derive this library path."}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            GitHub Integration
          </h2>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-primary" />
              <div>
                {githubLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking GitHub connection...
                  </div>
                ) : githubConnection.connected ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">@{githubConnection.username}</span>
                      <Badge
                        variant="outline"
                        className="border-green-500/30 bg-green-500/10 px-1.5 py-0 font-mono text-[10px] text-green-400"
                      >
                        Connected
                      </Badge>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      Private repositories can now be created from project detail pages.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">Not connected</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      Connect once to create private repos and view commit history in Pac-Forge.
                    </div>
                  </>
                )}
              </div>
            </div>
            <GitHubConnectDialog />
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Dropbox Integration
          </h2>
          <div className="mt-4">
            {dropboxLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking connection...
              </div>
            ) : dropboxConn?.connected ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cloud className="h-5 w-5 text-blue-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {dropboxConn.display_name ?? "Dropbox"}
                      </span>
                      <Badge
                        variant="outline"
                        className="border-green-500/30 bg-green-500/10 px-1.5 py-0 font-mono text-[10px] text-green-400"
                      >
                        Connected
                      </Badge>
                    </div>
                    {dropboxConn.email && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {dropboxConn.email}
                      </div>
                    )}
                    {dropboxConn.connected_by_email && (
                      <div className="font-mono text-[10px] text-muted-foreground/60">
                        Connected by {dropboxConn.connected_by_email}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => dropboxDisconnect.mutate()}
                  disabled={dropboxDisconnect.isPending}
                >
                  {dropboxDisconnect.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudOff className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CloudOff className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <span className="text-sm text-muted-foreground">Not connected</span>
                    <p className="text-xs text-muted-foreground/60">
                      Connect to auto-create project folders in Dropbox
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => dropboxConnect.mutate()}
                  disabled={dropboxConnect.isPending}
                >
                  {dropboxConnect.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Cloud className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Connect Dropbox
                </Button>
              </div>
            )}
          </div>
          {(dropboxDisconnect.isError || dropboxExchange.isError || dropboxExchangeError) && (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {dropboxExchangeError || dropboxExchange.error?.message || dropboxDisconnect.error?.message || "Operation failed"}
            </div>
          )}
          {dropboxExchange.isPending && !dropboxConn?.connected && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Completing Dropbox connection...
            </div>
          )}
        </Card>
      </div>

      <Separator />

      {/* Activity & Chats */}
      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity" className="gap-1.5">
            <User className="h-3.5 w-3.5" />
            Activity Log
          </TabsTrigger>
          <TabsTrigger value="chats" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Agent Chats
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          {auditLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !auditLog || auditLog.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-12 text-center">
              <div className="font-mono text-sm text-muted-foreground">
                No activity recorded yet.
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {auditLog.map((entry) => (
                <AuditLogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="chats" className="mt-4">
          {chatsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !agentChats || agentChats.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-12 text-center">
              <div className="font-mono text-sm text-muted-foreground">
                No saved agent chats. Chat with an agent using the floating chat button, then save the conversation.
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {agentChats.map((chat) => (
                <AgentChatRow key={chat.id} chat={chat} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
