export interface QuickReply {
  label: string;
  text: string;
  sendDirect?: boolean;
}

interface PhaseRule {
  keywords: RegExp;
  replies: QuickReply[];
}

const PHASE_RULES: PhaseRule[] = [
  {
    keywords: /how many|devices|motors?|valves?|sensors?|actuators?|list all|equipment/i,
    replies: [
      { label: "That covers all devices", text: "That covers all the devices in the system." },
      { label: "There are also...", text: "There are also " },
    ],
  },
  {
    keywords: /\bIO\b|modules?|digital input|analog|physical|MLFB/i,
    replies: [
      { label: "Use recommended modules", text: "Use your recommended modules, that looks good.", sendDirect: true },
      { label: "Standard DI/DO/AI/AO", text: "Standard DI/DO/AI/AO modules are fine." },
      { label: "Add safety IO", text: "We also need safety IO modules for the safety-rated signals." },
    ],
  },
  {
    keywords: /control logic|states?|interlocks?|timers?|alarms?/i,
    replies: [
      { label: "Start/stop with interlocks", text: "Standard start/stop with interlocks." },
      { label: "Include auto/manual", text: "Include auto/manual modes for each device." },
      { label: "Add fault handling", text: "Add fault handling and alarms for all critical devices." },
    ],
  },
  {
    keywords: /templates?|FB|function blocks?|library|match/i,
    replies: [
      { label: "Use suggested templates", text: "Use the suggested templates, they look good.", sendDirect: true },
      { label: "All need new FBs", text: "All devices need new FBs, no existing templates fit." },
      { label: "Mix of existing and new", text: "Mix of existing templates and new FBs where needed." },
    ],
  },
  {
    keywords: /folders?|structure|organiz/i,
    replies: [
      { label: "Follow design profile", text: "Follow the design profile folder structure." },
      { label: "Standard layout", text: "Standard folder layout is fine." },
    ],
  },
  {
    keywords: /sequence|process flow|coordinat|interaction/i,
    replies: [
      { label: "Sequential operation", text: "Sequential operation — one step at a time." },
      { label: "Parallel with interlocks", text: "Parallel operation with interlocks between devices." },
      { label: "Batch-based sequencing", text: "Batch-based sequencing with recipe control." },
    ],
  },
  {
    keywords: /confirm|correct|summary|ready to|proceed|look(s| ) good/i,
    replies: [
      { label: "Looks good, proceed", text: "Looks good, proceed.", sendDirect: true },
      { label: "One correction...", text: "One correction: " },
    ],
  },
];

const RECOMMENDATION_RE = /\[(IO_RECOMMENDATION|FB_RECOMMENDATION)\]/i;

const FALLBACK_REPLIES: QuickReply[] = [
  { label: "Yes, that's correct", text: "Yes, that's correct.", sendDirect: true },
  { label: "No", text: "No, " },
  { label: "Can you elaborate?", text: "Can you elaborate on that?" },
];

/**
 * Returns context-aware quick reply chips based on the last assistant message.
 * Analyzes keywords to detect the current Q&A phase and returns relevant pre-defined answers.
 */
export function getQuickReplies(lastAssistantMessage: string | undefined): QuickReply[] {
  if (!lastAssistantMessage) return [];

  // Check for structured recommendation blocks first
  if (RECOMMENDATION_RE.test(lastAssistantMessage)) {
    return [
      { label: "Looks good", text: "Looks good.", sendDirect: true },
      { label: "Need to adjust...", text: "I need to adjust: " },
    ];
  }

  // Match against phase rules — return first match
  for (const rule of PHASE_RULES) {
    if (rule.keywords.test(lastAssistantMessage)) {
      return rule.replies;
    }
  }

  return FALLBACK_REPLIES;
}
