import {
  Compass,
  ShieldCheck,
  Cable,
  ShieldAlert,
  Library,
  ClipboardList,
  Bot,
  Monitor,
  Link2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface AgentProfile {
  icon: LucideIcon;
  color: string;
  tagline: string;
  catchphrase: string;
  personality: string;
  description: string;
  skills: string[];
  whenToUse: string[];
  whyUseful: string;
  /** Types of knowledge this agent should receive during PM distribution. */
  knowledgeScope: string[];
  /** Types of knowledge this agent should NOT receive. */
  knowledgeExclusions: string[];
}

const PROFILES: Record<string, AgentProfile> = {
  "Code Architect": {
    icon: Compass,
    color: "blue",
    tagline: "Designs and generates production-ready PLC code blocks",
    catchphrase: "Structure first, optimize later.",
    personality:
      "Methodical and precise. Prefers to map out every dependency before writing a single line. Never ships without a clean import order and will rearrange an entire project tree just to eliminate a circular reference. Finds genuine satisfaction in a perfectly scaffolded function block.",
    description:
      "The Code Architect is your primary code-generation agent. It translates high-level functional descriptions into structured, standards-compliant SCL source files complete with headers, data blocks, and interface declarations. It understands TIA Portal project conventions and produces code that can be imported directly via TIA Openness.",
    skills: [
      "SCL code generation from natural language",
      "Function Block (FB) and Function (FC) scaffolding",
      "Data Block (DB) structure creation",
      "TIA Portal naming convention enforcement",
      "Multi-block dependency resolution",
      "Topological import ordering",
    ],
    whenToUse: [
      "Starting a new PLC program from a functional specification",
      "Generating boilerplate FBs and DBs for a machine module",
      "Converting pseudocode or logic descriptions into SCL",
      "Creating utility functions for reuse across projects",
    ],
    whyUseful:
      "Eliminates hours of manual SCL typing and reduces copy-paste errors. The Code Architect ensures every generated block follows your project's conventions and is ready for direct TIA Portal import, cutting initial development time significantly.",
    knowledgeScope: [
      "SCL syntax and language features",
      "Block structure patterns (FB, FC, DB, UDT)",
      "Data type references and usage",
      "TIA Portal import/export conventions",
      "Code generation patterns and best practices",
    ],
    knowledgeExclusions: [
      "Project management methodology",
      "Safety regulation text (not code patterns)",
      "IO hardware specifications and datasheets",
    ],
  },
  "PLC Standards Enforcer": {
    icon: ShieldCheck,
    color: "amber",
    tagline: "Enforces coding standards and TIA Portal best practices",
    catchphrase: "If it's not compliant, it's not done.",
    personality:
      "The one who reads the full IEC 61131-3 standard for fun. Finds a naming violation in the first 10 seconds of any code review and won't let it slide. Keeps a mental checklist longer than most people's grocery lists. Strict but fair — if your code passes, you know it's solid.",
    description:
      "The PLC Standards Enforcer reviews generated code against a comprehensive rule set derived from Siemens programming guidelines and your organization's internal standards. It catches naming violations, structural anti-patterns, and portability issues before code ever reaches TIA Portal.",
    skills: [
      "Naming convention validation (IEC 61131-3)",
      "Block interface compliance checks",
      "Structured programming pattern enforcement",
      "Anti-pattern detection (global access, missing error handling)",
      "TIA Portal version compatibility verification",
      "Code style consistency analysis",
    ],
    whenToUse: [
      "Reviewing generated code before approving it for export",
      "Auditing existing SCL code for standards violations",
      "Ensuring consistency across code from multiple sessions",
      "Validating that code meets customer-specific requirements",
    ],
    whyUseful:
      "Catches standards violations early, before they cause issues during commissioning. Consistent code style across the entire project reduces maintenance burden and makes handoffs between engineers smoother.",
    knowledgeScope: [
      "Naming conventions and coding standards",
      "IEC 61131-3 compliance rules",
      "Code style guidelines and anti-pattern documentation",
      "TIA Portal version compatibility notes",
    ],
    knowledgeExclusions: [
      "Raw hardware datasheets",
      "Project management methodology",
      "Basic SCL syntax reference",
    ],
  },
  "IO Validator": {
    icon: Cable,
    color: "emerald",
    tagline: "Validates IO mappings and hardware address consistency",
    catchphrase: "Every signal tells a story.",
    personality:
      "Can spot a wiring mismatch from across the room. Keeps a mental map of every IO address on the project and gets visibly uncomfortable when a module slot doesn't add up. The kind of engineer who labels both ends of every cable — twice.",
    description:
      "The IO Validator cross-references your IO list against generated code to ensure every input and output is correctly mapped, typed, and addressed. It detects orphaned addresses, type mismatches, and duplicate mappings that would otherwise cause runtime faults in the PLC.",
    skills: [
      "IO list to code cross-referencing",
      "Hardware address conflict detection",
      "Data type compatibility validation",
      "Orphaned IO point identification",
      "Signal range and scaling verification",
      "IO module capacity checking",
    ],
    whenToUse: [
      "After generating code that references physical IO",
      "When updating an IO list and need to verify code still matches",
      "Before exporting to TIA Portal to catch address conflicts",
      "Validating a project's IO configuration after hardware changes",
    ],
    whyUseful:
      "IO mismatches are among the most time-consuming errors to debug on-site. The IO Validator catches these issues at generation time, preventing costly commissioning delays and reducing field troubleshooting.",
    knowledgeScope: [
      "IO module specifications and addressing",
      "Hardware configuration guides",
      "Signal type references (analog, digital, special)",
      "Module slot and channel mappings",
    ],
    knowledgeExclusions: [
      "SCL programming patterns",
      "Naming conventions",
      "Project management methodology",
    ],
  },
  "Safety Auditor": {
    icon: ShieldAlert,
    color: "red",
    tagline: "Audits code for safety compliance and hazard prevention",
    catchphrase: "Safe by design, not by accident.",
    personality:
      "Former field engineer who's seen what happens when safety is an afterthought. Won't approve a single block until every hazard is accounted for. Has strong opinions about emergency stop circuits and isn't afraid to share them. Sleeps soundly knowing no unguarded actuator made it past review.",
    description:
      "The Safety Auditor performs rule-based safety analysis on generated PLC code. It checks for common safety violations such as unguarded actuator outputs, missing emergency stop handling, incorrect safety function block usage, and non-compliant timer patterns that could lead to hazardous machine states.",
    skills: [
      "Emergency stop circuit validation",
      "Safety function block usage verification",
      "Actuator guard and interlock checking",
      "Safety timer pattern analysis",
      "SIL/PL compliance rule checks",
      "Hazardous state reachability detection",
    ],
    whenToUse: [
      "Reviewing any code that controls actuators or motion",
      "Before approving safety-related function blocks",
      "When project has SIL or Performance Level requirements",
      "Auditing existing code after a safety incident or near-miss",
    ],
    whyUseful:
      "Safety defects in PLC code can lead to equipment damage, injury, or worse. The Safety Auditor provides an automated first-pass review that catches common safety issues, supporting your compliance obligations and protecting personnel.",
    knowledgeScope: [
      "Safety standards and regulations (IEC 62061, ISO 13849)",
      "Safety function block documentation",
      "Emergency stop circuit patterns",
      "SIL/PL requirements and verification",
      "Safety-related PLC features (F-CPU, F-blocks)",
    ],
    knowledgeExclusions: [
      "General naming conventions",
      "Non-safety SCL patterns",
      "Project management methodology",
    ],
  },
  "Pattern Librarian": {
    icon: Library,
    color: "violet",
    tagline: "Learns correction patterns to improve future code generation",
    catchphrase: "Mistakes are just lessons waiting to be catalogued.",
    personality:
      "Quietly watches every correction you make and turns it into a rule for next time. Has a photographic memory for recurring bugs and a librarian's obsession with classification. Celebrates when a pattern prevents the same error twice. Believes every diff tells a story worth preserving.",
    description:
      "The Pattern Librarian analyzes the differences between generated code and engineer-approved code to extract reusable correction patterns. Over time, these patterns are fed back into the generation pipeline, reducing repeated mistakes and aligning output with your team's preferred coding style.",
    skills: [
      "Diff analysis and correction classification",
      "Pattern extraction from code edits",
      "Pattern conflict detection and merging",
      "Generation quality metrics tracking",
      "Feedback loop optimization",
      "Cross-project pattern aggregation",
    ],
    whenToUse: [
      "After approving modified code to capture improvement patterns",
      "Reviewing accumulated patterns for quality and relevance",
      "When generation quality has plateaued and needs refinement",
      "Analyzing which types of corrections are most frequent",
    ],
    whyUseful:
      "Transforms every manual code correction into a lasting improvement. The Pattern Librarian ensures the system learns from your engineering judgment, making each generation cycle more aligned with your standards and reducing the need for repetitive edits.",
    knowledgeScope: [
      "Correction classification guidelines",
      "Code quality metrics",
      "Common SCL anti-patterns",
    ],
    knowledgeExclusions: [
      "Raw hardware specifications",
      "Project management methodology",
      "Full SCL language references",
    ],
  },
  "Project Manager": {
    icon: ClipboardList,
    color: "cyan",
    tagline: "Orchestrates the agent pipeline and summarizes results",
    catchphrase: "A good plan today is better than a perfect plan tomorrow.",
    personality:
      "The natural coordinator who sees the big picture before anyone else does. Reads the user's intent between the lines, knows each agent's strengths, and delegates accordingly. Keeps meetings short and reports shorter. Celebrates when the pipeline runs without a single rework cycle.",
    description:
      "The Project Manager orchestrates the multi-agent pipeline. In the planning phase, it analyzes the user's request, identifies which specialist agents should be engaged, and outlines an execution plan. After all agents have completed their work, it synthesizes results, flags any disagreements between reviewers, and delivers a clear final status report. It never modifies code directly — its role is coordination and communication.",
    skills: [
      "Request analysis and task decomposition",
      "Agent delegation and pipeline planning",
      "Cross-agent conflict resolution",
      "Final report synthesis and quality assessment",
      "Risk identification and mitigation planning",
      "Pipeline optimization recommendations",
    ],
    whenToUse: [
      "When using multiple agents in a single session",
      "When you want a structured execution plan before code generation",
      "When you need a summary of what each agent contributed",
      "For complex projects where agent coordination matters",
    ],
    whyUseful:
      "Transforms a collection of independent agents into a coordinated team. The Project Manager ensures each specialist focuses on what they do best, catches conflicts between reviewers early, and gives you a clear picture of the generation pipeline's output — so you can make informed decisions about the generated code.",
    knowledgeScope: [
      "Pipeline orchestration patterns",
      "Project planning and task decomposition",
      "Cross-agent coordination guidelines",
    ],
    knowledgeExclusions: [
      "Detailed SCL syntax references",
      "Hardware specifications",
      "Safety regulation text",
    ],
  },
  "HMI Designer": {
    icon: Monitor,
    color: "rose",
    tagline: "Designs modern, high-performance HMI screens for WinCC Comfort panels",
    catchphrase: "If the operator has to think, the screen failed.",
    personality:
      "Equal parts industrial designer and control engineer. Obsesses over visual hierarchy, color meaning, and alarm visibility. Knows ISA-101 by heart and applies it ruthlessly — no decoration without purpose, no element without a clear operator action. Treats every pixel of a 1920×1080 Comfort panel as sacred real estate.",
    description:
      "The HMI Designer creates structured screen layouts for WinCC RT Advanced (Comfort-based) panels. It designs navigation flows, object placement, color schemes, and animation strategies following ISA-101 high-performance HMI principles. It outputs structured JSON screen specifications that are converted deterministically to TIA-importable XML — it never writes raw XML directly.",
    skills: [
      "ISA-101 high-performance screen design",
      "WinCC Comfort panel element library (buttons, IO fields, graphic views, gauges)",
      "Screen navigation architecture and template patterns",
      "Faceplate design for reusable equipment displays",
      "Color and animation strategy for alarm states",
      "Layout composition for 1920×1080 IPC displays",
      "Overview screen design from process flow descriptions",
    ],
    whenToUse: [
      "Designing HMI screens for a new automation project",
      "Creating overview screens from process builder output",
      "Laying out equipment detail screens with faceplates",
      "Building navigation structures across multi-screen HMI projects",
      "Designing alarm and fault display screens",
    ],
    whyUseful:
      "Replaces hours of manual screen building in TIA Portal with AI-generated layouts that follow ISA-101 best practices. The HMI Designer produces consistent, operator-friendly screens that can be imported directly into WinCC Comfort projects.",
    knowledgeScope: [
      "ISA-101 HMI design guidelines",
      "WinCC Comfort screen element types and properties",
      "HMI XML schema for Comfort panels",
      "Screen navigation and template patterns",
      "Color standards and alarm visualization",
      "Faceplate and symbol library conventions",
      "Process flow and P&ID layout principles",
    ],
    knowledgeExclusions: [
      "SCL programming and code generation",
      "PLC tag addressing and data types",
      "Safety regulation text",
      "Project management methodology",
    ],
  },
  "HMI Tag Linker": {
    icon: Link2,
    color: "teal",
    tagline: "Wires HMI tags to PLC variables with precision",
    catchphrase: "Every tag needs a home — and I know exactly where it lives.",
    personality:
      "The meticulous connector who lives in the space between HMI and PLC. Memorizes every DB structure, knows which variables are HMI-exposed, and maps acquisition cycles like a network engineer maps subnets. Gets genuinely annoyed by orphaned tags and broken links. Won't rest until every IO field points to the right PLC address.",
    description:
      "The HMI Tag Linker specializes in creating HMI tag tables and wiring them to PLC data blocks. It reads FB interfaces and instance DB structures to identify HMI-relevant variables, creates properly typed HMI tags with correct acquisition cycles, and generates the tag binding XML that connects screen elements to live PLC data. It understands the PLC↔HMI connection layer that most engineers find tedious.",
    skills: [
      "PLC DB variable to HMI tag mapping",
      "HMI tag table generation and organization",
      "Acquisition cycle and trigger mode configuration",
      "Data type mapping between PLC and HMI (Bool, Int, Real, String, etc.)",
      "Tag binding XML generation (LinkList patterns)",
      "Multi-instance DB tag path resolution",
      "HMI-exposed variable identification from FB interfaces",
    ],
    whenToUse: [
      "After PLC code generation, to create matching HMI tag tables",
      "When linking screen elements to PLC variables",
      "Setting up tag acquisition cycles and update rates",
      "Mapping complex nested DB structures to flat HMI tag paths",
      "Validating existing HMI tag connections against PLC code changes",
    ],
    whyUseful:
      "Tag wiring is one of the most error-prone and tedious parts of HMI development. The HMI Tag Linker automates the mapping from PLC data blocks to HMI tags, ensuring correct data types, proper acquisition settings, and valid tag paths — eliminating hours of manual tag table work and reducing runtime connection errors.",
    knowledgeScope: [
      "HMI tag table XML schema and structure",
      "PLC data block interfaces and variable exposure",
      "Data type mapping between S7-1500 and WinCC Comfort",
      "Tag acquisition modes and cycle times",
      "Instance DB addressing and multi-instance paths",
      "WinCC Comfort tag connection patterns",
    ],
    knowledgeExclusions: [
      "Screen layout and visual design",
      "ISA-101 display guidelines",
      "Safety regulation text",
      "Project management methodology",
    ],
  },
};

const FALLBACK_PROFILE: AgentProfile = {
  icon: Bot,
  color: "neutral",
  tagline: "General-purpose AI agent",
  catchphrase: "Ready when you are.",
  personality: "A reliable generalist. Always available, never complains, and handles whatever you throw at it.",
  description:
    "A general-purpose agent without a specialized profile. It can assist with various tasks but does not have a defined specialty area.",
  skills: ["General assistance"],
  whenToUse: ["General-purpose tasks"],
  whyUseful:
    "Provides flexible assistance when no specialized agent is required.",
  knowledgeScope: ["General reference material"],
  knowledgeExclusions: [],
};

export function getAgentProfile(displayName: string): AgentProfile {
  return PROFILES[displayName] ?? FALLBACK_PROFILE;
}

export const COLOR_CLASSES = {
  blue: { bg: "bg-blue-500/15", text: "text-blue-500", ring: "ring-blue-500/30" },
  amber: { bg: "bg-amber-500/15", text: "text-amber-500", ring: "ring-amber-500/30" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-500", ring: "ring-emerald-500/30" },
  red: { bg: "bg-red-500/15", text: "text-red-500", ring: "ring-red-500/30" },
  violet: { bg: "bg-violet-500/15", text: "text-violet-500", ring: "ring-violet-500/30" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-500", ring: "ring-cyan-500/30" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-500", ring: "ring-rose-500/30" },
  teal: { bg: "bg-teal-500/15", text: "text-teal-500", ring: "ring-teal-500/30" },
  neutral: { bg: "bg-neutral-500/15", text: "text-neutral-500", ring: "ring-neutral-500/30" },
} as const;

export type ProfileColor = keyof typeof COLOR_CLASSES;
