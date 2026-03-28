import { useState, useMemo, useCallback } from "react";
import {
  FileText,
  Save,
  RotateCcw,
  History,
  Check,
  Loader2,
  ChevronRight,
  ChevronDown,
  Clock,
  Eye,
  Pencil,
  Users,
  Globe,
  Import,
  Monitor,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useActivePromptSections,
  usePromptSectionHistory,
  useSavePromptSection,
  useActivatePromptVersion,
  useResetPromptSection,
} from "@/hooks/use-prompt-sections";
import { PROMPT_DEFAULTS, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile, COLOR_CLASSES } from "@/lib/agent-profiles";
import type { ProfileColor } from "@/lib/agent-profiles";
import type { PromptRole } from "@/types";
import {
  PROMPT_ROLE_LABELS,
  ROLE_SECTIONS,
  SECTION_LABELS,
} from "@/types/prompt-section";
import { cn } from "@/lib/utils";
import Editor from "@monaco-editor/react";
import { ImportTiaExamplesDialog } from "@/components/prompt-editor/import-tia-examples-dialog";
import { useUiStore } from "@/stores/ui-store";

/** Agent ownership: groups roles by the agent that uses them. */
interface AgentGroup {
  agent: string;
  roles: PromptRole[];
}

const AGENT_GROUPS: AgentGroup[] = [
  {
    agent: "Project Manager",
    roles: ["forge_pm_spec_analysis", "forge_pm_qa_review", "forge_pm_device_linkage", "forge_pm_sequences", "plcsim_test"],
  },
  {
    agent: "Code Architect",
    roles: ["forge_arch_device", "forge_arch_call_fc", "forge_arch_io_linking", "forge_arch_process", "forge_arch_rewrite", "forge_arch_compile_fix"],
  },
  {
    agent: "Standards Reviewer",
    roles: ["forge_reviewer", "review_scope_io", "review_scope_fb", "review_scope_db", "review_scope_fc"],
  },
  {
    agent: "IO Validator",
    roles: ["forge_io_validator"],
  },
  {
    agent: "Pattern Librarian",
    roles: ["forge_pattern_librarian"],
  },
  {
    agent: "Safety Auditor",
    roles: ["forge_safety_auditor"],
  },
  {
    agent: "HMI Agent",
    roles: ["hmi_designer", "hmi_svg_generator"],
  },
  { agent: "All Agents", roles: ["shared"] },
];

/** For a given role, which agent(s) can be previewed (identity interpolation). */
const ROLE_PREVIEW_AGENTS: Partial<Record<PromptRole, string[]>> = {
  forge_pm_spec_analysis: ["Project Manager"],
  forge_pm_qa_review: ["Project Manager"],
  forge_pm_device_linkage: ["Project Manager"],
  forge_pm_sequences: ["Project Manager"],
  forge_arch_device: ["Code Architect"],
  forge_arch_call_fc: ["Code Architect"],
  forge_arch_io_linking: ["Code Architect"],
  forge_arch_process: ["Code Architect"],
  forge_arch_rewrite: ["Code Architect"],
  forge_arch_compile_fix: ["Code Architect"],
  forge_reviewer: ["Standards Reviewer"],
  review_scope_io: ["Standards Reviewer"],
  review_scope_fb: ["Standards Reviewer"],
  review_scope_db: ["Standards Reviewer"],
  review_scope_fc: ["Standards Reviewer"],
  forge_io_validator: ["IO Validator"],
  forge_pattern_librarian: ["Pattern Librarian"],
  forge_safety_auditor: ["Safety Auditor"],
  hmi_designer: ["HMI Agent"],
  hmi_svg_generator: ["HMI Agent"],
  plcsim_test: ["Project Manager"],
};

/** Maps each role to its primary owning agent name. */
const ROLE_OWNER: Record<PromptRole, string> = {
  shared: "All Agents",
  forge_pm_spec_analysis: "Project Manager",
  forge_pm_qa_review: "Project Manager",
  forge_pm_device_linkage: "Project Manager",
  forge_pm_sequences: "Project Manager",
  forge_arch_device: "Code Architect",
  forge_arch_call_fc: "Code Architect",
  forge_arch_io_linking: "Code Architect",
  forge_arch_process: "Code Architect",
  forge_arch_rewrite: "Code Architect",
  forge_arch_compile_fix: "Code Architect",
  forge_reviewer: "Standards Reviewer",
  review_scope_io: "Standards Reviewer",
  review_scope_fb: "Standards Reviewer",
  review_scope_db: "Standards Reviewer",
  review_scope_fc: "Standards Reviewer",
  forge_io_validator: "IO Validator",
  forge_pattern_librarian: "Pattern Librarian",
  forge_safety_auditor: "Safety Auditor",
  hmi_designer: "HMI Agent",
  hmi_svg_generator: "HMI Agent",
  plcsim_test: "Project Manager",
};

/** Roles whose assembled prompt includes the shared platform_rules section. */
const ROLE_HAS_PLATFORM_RULES: Partial<Record<PromptRole, true>> = {
  forge_arch_device: true,
  forge_arch_call_fc: true,
  forge_arch_io_linking: true,
  forge_arch_process: true,
  forge_arch_rewrite: true,
  forge_arch_compile_fix: true,
  forge_reviewer: true,
};

export default function PromptEditorPage() {
  const [selectedRole, setSelectedRole] = useState<PromptRole>("shared");
  const [selectedSection, setSelectedSection] = useState<string>(
    ROLE_SECTIONS.shared[0],
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saveNotes, setSaveNotes] = useState("");
  const [editorContent, setEditorContent] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const resolvedTheme = useUiStore((s) => s.resolvedTheme);
  const [previewAgent, setPreviewAgent] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((agent: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  }, []);

  // Data hooks
  const { data: activeSections } = useActivePromptSections();
  const { data: history } = usePromptSectionHistory(selectedRole, selectedSection);
  const saveMutation = useSavePromptSection();
  const activateMutation = useActivatePromptVersion();
  const resetMutation = useResetPromptSection();

  // Resolve current content (DB override or default)
  const activeKey = `${selectedRole}:${selectedSection}`;
  const dbContent = activeSections?.[activeKey];
  const defaultContent =
    PROMPT_DEFAULTS[selectedRole]?.[selectedSection] ??
    PROMPT_DEFAULTS.shared?.[selectedSection] ??
    "";
  const currentContent = dbContent ?? defaultContent;
  const isCustomized = dbContent !== undefined;

  // Active version info
  const activeVersion = useMemo(() => {
    if (!history) return null;
    return history.find((h) => h.is_active) ?? null;
  }, [history]);

  // Editor value — use local state if editing, otherwise show current
  const displayContent = editorContent ?? currentContent;
  const hasChanges = editorContent !== null && editorContent !== currentContent;

  // When role/section changes, reset editor state
  const handleSelectRole = useCallback(
    (role: PromptRole) => {
      setSelectedRole(role);
      const sections = ROLE_SECTIONS[role];
      setSelectedSection(sections[0]);
      setEditorContent(null);
      setShowHistory(false);
      setPreviewMode(false);
      setPreviewAgent(null);
    },
    [],
  );

  const handleSelectSection = useCallback((key: string) => {
    setSelectedSection(key);
    setEditorContent(null);
    setShowHistory(false);
  }, []);

  const handleSave = useCallback(() => {
    if (!editorContent) return;
    saveMutation.mutate(
      {
        role: selectedRole,
        sectionKey: selectedSection,
        content: editorContent,
        notes: saveNotes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setEditorContent(null);
          setSaveNotes("");
        },
      },
    );
  }, [editorContent, selectedRole, selectedSection, saveNotes, saveMutation]);

  const handleReset = useCallback(() => {
    resetMutation.mutate(
      { role: selectedRole, sectionKey: selectedSection },
      {
        onSuccess: () => {
          setEditorContent(null);
          setShowResetConfirm(false);
        },
      },
    );
  }, [selectedRole, selectedSection, resetMutation]);

  const handleActivateVersion = useCallback(
    (id: string) => {
      activateMutation.mutate(
        { id, role: selectedRole, sectionKey: selectedSection },
        {
          onSuccess: () => {
            setEditorContent(null);
          },
        },
      );
    },
    [selectedRole, selectedSection, activateMutation],
  );

  const sections = ROLE_SECTIONS[selectedRole];

  // --- Preview: assemble all sections for the role with agent interpolation ---
  const previewAgents = ROLE_PREVIEW_AGENTS[selectedRole];
  const currentPreviewAgent = previewAgent ?? previewAgents?.[0] ?? null;

  const previewContent = useMemo(() => {
    const roleSections = ROLE_SECTIONS[selectedRole];
    const parts: string[] = [];

    for (const sectionKey of roleSections) {
      const label = SECTION_LABELS[sectionKey] ?? sectionKey;

      // Use editor content if we're editing this specific section, otherwise resolve
      let content: string;
      if (sectionKey === selectedSection && editorContent !== null) {
        content = editorContent;
      } else {
        const key = `${selectedRole}:${sectionKey}`;
        content =
          activeSections?.[key] ??
          PROMPT_DEFAULTS[selectedRole]?.[sectionKey] ??
          PROMPT_DEFAULTS.shared?.[sectionKey] ??
          "";
      }

      // Interpolate agent placeholders
      if (currentPreviewAgent && content.includes("{agent_")) {
        const profile = getAgentProfile(currentPreviewAgent);
        content = interpolateAgent(content, {
          name: currentPreviewAgent,
          tagline: profile.tagline,
          description: profile.description,
          personality: profile.personality,
        });
      }

      // Only add section header when there are multiple sections
      if (roleSections.length > 1) {
        parts.push(`── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}\n\n${content}`);
      } else {
        parts.push(content);
      }
    }

    // Append platform rules if this role uses them
    if (ROLE_HAS_PLATFORM_RULES[selectedRole]) {
      const platformRules =
        activeSections?.["shared:platform_rules"] ??
        PROMPT_DEFAULTS.shared?.platform_rules ??
        "";
      parts.push(`── Platform Rules ${"─".repeat(44)}\n\n${platformRules}`);
    }

    parts.push(
      "─".repeat(64) +
        "\n\n*Dynamic content injected at runtime: project context, IO list, design profile, correction patterns, FB templates, agent knowledge docs, output format rules*",
    );

    return parts.join("\n\n\n");
  }, [selectedRole, selectedSection, editorContent, activeSections, currentPreviewAgent]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">CONFIGURATION</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileText className="h-5 w-5" />
            Prompt Editor
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit system prompt sections for each pipeline agent. Changes are
            version-controlled and can be rolled back.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => setShowImportDialog(true)}
        >
          <Import className="h-4 w-4" />
          Import from TIA
        </Button>
      </div>

      <Separator />

      <div className="flex gap-4" style={{ height: "calc(100vh - 200px)" }}>
        {/* Left: Role selector grouped by agent */}
        <Card className="w-56 shrink-0 overflow-hidden">
          <div className="border-b px-3 py-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">
              AGENT PROMPTS
            </span>
          </div>
          <ScrollArea className="h-full">
            <nav className="p-1">
              {AGENT_GROUPS.map((group) => {
                // Special groups that aren't real agent profiles
                const isReviewers = group.agent === "Reviewers";
                const isAllAgents = group.agent === "All Agents";
                const isHmi = group.agent === "HMI Agent";
                const profile = !isReviewers && !isAllAgents && !isHmi
                  ? getAgentProfile(group.agent)
                  : null;
                const color = profile
                  ? COLOR_CLASSES[profile.color as ProfileColor] ?? COLOR_CLASSES.neutral
                  : isReviewers
                    ? COLOR_CLASSES.amber
                    : isHmi
                      ? COLOR_CLASSES.cyan
                      : COLOR_CLASSES.neutral;
                const GroupIcon = profile?.icon ?? (isReviewers ? Users : isHmi ? Monitor : Globe);
                const isCollapsed = collapsedGroups.has(group.agent);
                const hasSelectedRole = group.roles.includes(selectedRole);
                const customCount = activeSections
                  ? group.roles.filter((role) =>
                      ROLE_SECTIONS[role].some((key) => activeSections[`${role}:${key}`] !== undefined),
                    ).length
                  : 0;

                return (
                  <div key={group.agent} className="mb-0.5">
                    {/* Agent header — clickable to collapse */}
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/30",
                        hasSelectedRole && isCollapsed && "bg-accent/20",
                      )}
                      onClick={() => toggleGroup(group.agent)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <GroupIcon className={cn("h-3.5 w-3.5 shrink-0", color.text)} />
                      <span className={cn("text-xs font-semibold", color.text)}>
                        {group.agent}
                      </span>
                      {isReviewers && (
                        <span className="text-[10px] text-muted-foreground">
                          (3)
                        </span>
                      )}
                      {customCount > 0 && (
                        <Badge
                          variant="outline"
                          className="ml-auto h-4 px-1 text-[10px]"
                        >
                          {customCount}
                        </Badge>
                      )}
                    </button>

                    {/* Roles under this agent — collapsible */}
                    {!isCollapsed && (
                      <div className="space-y-0.5 pl-3">
                        {group.roles.map((role) => (
                          <button
                            key={role}
                            onClick={() => handleSelectRole(role)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                              selectedRole === role
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            )}
                          >
                            <ChevronRight
                              className={cn(
                                "h-3 w-3 transition-transform",
                                selectedRole === role && "rotate-90",
                              )}
                            />
                            <span className="font-medium">
                              {PROMPT_ROLE_LABELS[role]}
                            </span>
                            {activeSections &&
                              ROLE_SECTIONS[role].some(
                                (key) =>
                                  activeSections[`${role}:${key}`] !== undefined,
                              ) && (
                                <Badge
                                  variant="outline"
                                  className="ml-auto h-4 px-1 text-[10px]"
                                >
                                  custom
                                </Badge>
                              )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </ScrollArea>
        </Card>

        {/* Right: Editor area */}
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Section tabs */}
          {sections.length > 1 && (
            <div className="flex border-b">
              {sections.map((key) => (
                <button
                  key={key}
                  onClick={() => handleSelectSection(key)}
                  className={cn(
                    "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                    selectedSection === key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {SECTION_LABELS[key] ?? key}
                </button>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            {/* Edit / Preview toggle */}
            <div className="flex items-center gap-0.5 rounded-md border p-0.5">
              <Button
                size="sm"
                variant={!previewMode ? "secondary" : "ghost"}
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => setPreviewMode(false)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
              <Button
                size="sm"
                variant={previewMode ? "secondary" : "ghost"}
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => setPreviewMode(true)}
              >
                <Eye className="h-3 w-3" />
                Preview
              </Button>
            </div>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <span className="font-mono text-xs text-muted-foreground">
              {previewMode
                ? `${ROLE_OWNER[selectedRole]} — ${PROMPT_ROLE_LABELS[selectedRole]} — Full Prompt`
                : `${ROLE_OWNER[selectedRole]} > ${PROMPT_ROLE_LABELS[selectedRole]} > ${SECTION_LABELS[selectedSection] ?? selectedSection}`}
            </span>

            {!previewMode && (
              <>
                {isCustomized && activeVersion ? (
                  <Badge variant="secondary" className="ml-2 font-mono text-xs">
                    v{activeVersion.version}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-2 font-mono text-xs">
                    Default
                  </Badge>
                )}

                {hasChanges && (
                  <Badge className="ml-1 bg-amber-500/20 text-amber-400 text-xs">
                    Unsaved changes
                  </Badge>
                )}
              </>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {/* Agent selector (preview mode only, for roles with agent interpolation) */}
              {previewMode && previewAgents && (
                <>
                  <span className="font-mono text-xs text-muted-foreground">
                    Agent:
                  </span>
                  {previewAgents.map((name) => (
                    <Button
                      key={name}
                      size="sm"
                      variant={currentPreviewAgent === name ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setPreviewAgent(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </>
              )}

              {/* Save / Reset controls (edit mode only) */}
              {!previewMode && (
                <>
                  <Input
                    placeholder="Version notes (optional)"
                    value={saveNotes}
                    onChange={(e) => setSaveNotes(e.target.value)}
                    className="h-7 w-48 font-mono text-xs"
                  />

                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 gap-1 text-xs"
                    disabled={!hasChanges || saveMutation.isPending}
                    onClick={handleSave}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    Save
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={!isCustomized}
                    onClick={() => setShowResetConfirm(true)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </Button>

                  <Separator orientation="vertical" className="mx-1 h-5" />
                </>
              )}

              <Button
                size="sm"
                variant={showHistory ? "secondary" : "ghost"}
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  setShowHistory((v) => !v);
                  if (previewMode) setPreviewMode(false);
                }}
              >
                <History className="h-3 w-3" />
                History
              </Button>
            </div>
          </div>

          {/* Main content area */}
          <div className="flex min-h-0 flex-1">
            {/* Monaco Editor — edit or preview */}
            <div className="min-w-0 flex-1">
              {previewMode ? (
                <Editor
                  key="preview"
                  height="100%"
                  language="markdown"
                  theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
                  value={previewContent}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    lineNumbers: "off",
                    fontSize: 13,
                    fontFamily: "JetBrains Mono, Fira Code, monospace",
                    scrollBeyondLastLine: false,
                    padding: { top: 12, bottom: 12 },
                    renderLineHighlight: "none",
                    domReadOnly: true,
                  }}
                />
              ) : (
                <Editor
                  key="editor"
                  height="100%"
                  language="markdown"
                  theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
                  value={displayContent}
                  onChange={(value) => setEditorContent(value ?? "")}
                  options={{
                    minimap: { enabled: false },
                    wordWrap: "on",
                    lineNumbers: "off",
                    fontSize: 13,
                    fontFamily: "JetBrains Mono, Fira Code, monospace",
                    scrollBeyondLastLine: false,
                    padding: { top: 12, bottom: 12 },
                    renderLineHighlight: "none",
                  }}
                />
              )}
            </div>

            {/* Version history panel */}
            {showHistory && (
              <>
                <Separator orientation="vertical" />
                <div className="w-72 shrink-0">
                  <div className="border-b px-3 py-2">
                    <span className="font-mono text-xs font-medium text-muted-foreground">
                      VERSION HISTORY
                    </span>
                  </div>
                  <ScrollArea className="h-full">
                    <div className="space-y-1 p-2">
                      {/* Default entry */}
                      <div
                        className={cn(
                          "rounded-md border px-3 py-2",
                          !isCustomized && "border-primary/50 bg-primary/5",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium">
                            Default
                          </span>
                          {!isCustomized && (
                            <Badge
                              variant="outline"
                              className="h-4 border-green-500/50 px-1.5 text-[10px] text-green-400"
                            >
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Built-in code default
                        </p>
                        {isCustomized && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-1 h-5 gap-1 px-1.5 text-[10px]"
                            onClick={() => setShowResetConfirm(true)}
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            Activate
                          </Button>
                        )}
                      </div>

                      {/* Custom versions */}
                      {history?.map((version) => (
                        <div
                          key={version.id}
                          className={cn(
                            "rounded-md border px-3 py-2",
                            version.is_active &&
                              "border-primary/50 bg-primary/5",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium">
                              v{version.version}
                            </span>
                            {version.is_active && (
                              <Badge
                                variant="outline"
                                className="h-4 border-green-500/50 px-1.5 text-[10px] text-green-400"
                              >
                                Active
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(version.created_at).toLocaleString()}
                          </div>
                          {version.notes && (
                            <p className="mt-1 text-xs text-muted-foreground italic">
                              {version.notes}
                            </p>
                          )}
                          <div className="mt-1 flex gap-1">
                            {!version.is_active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 gap-1 px-1.5 text-[10px]"
                                disabled={activateMutation.isPending}
                                onClick={() =>
                                  handleActivateVersion(version.id)
                                }
                              >
                                {activateMutation.isPending ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                ) : (
                                  <Check className="h-2.5 w-2.5" />
                                )}
                                Activate
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 gap-1 px-1.5 text-[10px]"
                              onClick={() => {
                                setEditorContent(version.content);
                                setShowHistory(false);
                              }}
                            >
                              Load
                            </Button>
                          </div>
                        </div>
                      ))}

                      {(!history || history.length === 0) && (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                          No custom versions yet. Save a change to create the
                          first version.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Reset confirmation dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate all custom versions for{" "}
              <span className="font-medium text-foreground">
                {PROMPT_ROLE_LABELS[selectedRole]} &gt;{" "}
                {SECTION_LABELS[selectedSection]}
              </span>{" "}
              and revert to the built-in code default. Custom versions are
              preserved in history and can be re-activated later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? "Resetting..." : "Reset to Default"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import from TIA dialog */}
      <ImportTiaExamplesDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSaved={(destination, sectionKey) => {
          if (destination !== "design_profile" && sectionKey) {
            setSelectedRole("shared");
            setSelectedSection(sectionKey);
            setEditorContent(null);
            setShowHistory(false);
            setPreviewMode(false);
          }
        }}
      />
    </div>
  );
}
