import { callNonStreaming } from "@/hooks/use-generation";
import type { MessageContent } from "@/hooks/use-generation";
import { resolveSection } from "@/lib/prompt-defaults";

export const SVG_GRAPHIC_CATEGORIES = {
  motor: "Motor",
  valve: "Valve",
  pump: "Pump",
  conveyor: "Conveyor",
  sensor: "Sensor",
  tank: "Tank",
  pipe: "Pipe",
  fan: "Fan",
  heat_exchanger: "Heat Exchanger",
  custom: "Custom",
} as const;

export type SvgGraphicCategory = keyof typeof SVG_GRAPHIC_CATEGORIES;

export const SVG_GRAPHIC_STATES = {
  motor: ["stopped", "running", "faulted", "manual"],
  valve: ["closed", "open", "transit", "faulted"],
  pump: ["stopped", "running", "faulted", "cavitation"],
  conveyor: ["stopped", "running_fwd", "running_rev", "faulted"],
  sensor: ["normal", "alarm_high", "alarm_low", "faulted"],
  tank: ["empty", "low", "normal", "high", "overflow"],
  pipe: ["empty", "flowing", "blocked"],
  fan: ["stopped", "running", "faulted"],
  heat_exchanger: ["idle", "heating", "cooling", "faulted"],
  custom: ["state_1", "state_2", "state_3"],
} as const;

export const SVG_GRAPHIC_STYLES = {
  isa101: "ISA-101 High Performance",
  schematic: "P&ID Schematic",
  minimal: "Minimalist",
  detailed: "Detailed Industrial",
  custom: "Custom Style",
} as const;

export type SvgGraphicStyle = keyof typeof SVG_GRAPHIC_STYLES;

const STYLE_INSTRUCTIONS: Record<SvgGraphicStyle, string> = {
  isa101: `ISA-101 high-performance style:
- Clean, flat shapes — NO gradients, NO 3D effects, NO photorealism
- Make shapes clean and geometric — circles for motors/fans, rectangles for conveyors, triangles/trapezoids for valves
- 2px strokes in darker shade of fill color
- Minimal detail, maximum clarity at small sizes`,
  schematic: `P&ID schematic style:
- Technical/engineering drawing appearance
- Thin lines (1-2px), mostly black/dark strokes with minimal fills
- Follow ISA/ISO P&ID symbol conventions where applicable
- Clean geometric shapes, no decorative elements`,
  minimal: `Minimalist style:
- Ultra-simple, icon-like appearance
- Single weight strokes, minimal fills
- Reduce to the absolute essential shape that communicates the equipment type
- Should look like a clean UI icon`,
  detailed: `Detailed industrial style:
- More realistic representation with structural details
- Show mounting points, connection ports, internal features
- Use subtle shading (darker fills, not gradients) to suggest depth
- Include mechanical details like bolts, flanges, bearing housings where relevant`,
  custom: `Follow the user's custom style instructions provided in the description.`,
};

export interface GeneratedSvgGraphic {
  id: string;
  name: string;
  category: SvgGraphicCategory;
  description: string;
  /** Style used to generate this graphic */
  style?: SvgGraphicStyle;
  /** Base SVG (the approved design) */
  baseSvg: string;
  /** State variants - key is state name, value is SVG string */
  stateVariants: Record<string, string>;
  /** Data URI for quick rendering */
  previewUrl: string;
  /** When it was generated */
  createdAt: string;
  /** Tags for searchability */
  tags: string[];
  /** Approved by user */
  approved: boolean;
  /** If this is a variant of another graphic, stores parent ID */
  variantOf?: string;
}

function buildSystemPrompt(style: SvgGraphicStyle, promptSections?: Record<string, string>): string {
  const identity = resolveSection(promptSections, "hmi_svg_generator", "identity");
  const instructions = resolveSection(promptSections, "hmi_svg_generator", "instructions");

  return `${identity}

Style: ${SVG_GRAPHIC_STYLES[style]}
${STYLE_INSTRUCTIONS[style]}

${instructions}`;
}

export interface GenerateOptions {
  description: string;
  category: SvgGraphicCategory;
  style: SvgGraphicStyle;
  /** Custom style instructions (used when style === "custom") */
  customStyleInstructions?: string;
  /** Base64 reference image data */
  referenceImage?: { data: string; mediaType: string };
  /** If creating a variant, the parent's SVG for reference */
  parentSvg?: string;
  /** Editable prompt sections from DB (optional — falls back to defaults) */
  promptSections?: Record<string, string>;
  signal: AbortSignal;
}

export async function generateSvgGraphic(
  opts: GenerateOptions,
): Promise<string> {
  const { description, category, style, customStyleInstructions, referenceImage, parentSvg, promptSections, signal } = opts;
  const categoryLabel = SVG_GRAPHIC_CATEGORIES[category];
  const states = SVG_GRAPHIC_STATES[category];

  let systemPrompt = buildSystemPrompt(style, promptSections);
  if (style === "custom" && customStyleInstructions) {
    systemPrompt += `\n\nCustom style instructions: ${customStyleInstructions}`;
  }

  const userParts: MessageContent = [];

  // Add reference image if provided
  if (referenceImage) {
    userParts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: referenceImage.mediaType,
        data: referenceImage.data,
      },
    });
    userParts.push({
      type: "text",
      text: "Use the above image as a visual reference for the shape and proportions of the graphic. Recreate it as a clean SVG in the specified style.",
    });
  }

  let prompt = `Create an SVG graphic for: ${description}
Category: ${categoryLabel}
This graphic will have these states: ${states.join(", ")}
Design the BASE state (stopped/idle/closed). Use gray (#94a3b8) fill with darker stroke (#475569).
Elements that will change color in different states should have class="state-fill" or class="state-stroke".
ViewBox: 0 0 100 100. No xmlns needed.`;

  if (parentSvg) {
    prompt += `\n\nThis is a VARIANT of an existing graphic. Here is the parent SVG for reference — keep a similar overall style and structure but modify according to the description:\n${parentSvg}`;
  }

  userParts.push({ type: "text", text: prompt });

  const response = await callNonStreaming(
    systemPrompt,
    [{ role: "user", content: userParts }],
    signal,
    2048,
  );

  // Clean the response — extract just the SVG
  let svg = response.content.trim();
  svg = svg
    .replace(/```svg\s*/g, "")
    .replace(/```xml\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  // Ensure it has xmlns
  if (!svg.includes("xmlns=")) {
    svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  return svg;
}

export function generateStateVariant(
  baseSvg: string,
  stateName: string,
): string {
  const stateColors: Record<string, { fill: string; stroke: string }> = {
    // Running/active states
    running: { fill: "#22c55e", stroke: "#15803d" },
    running_fwd: { fill: "#22c55e", stroke: "#15803d" },
    running_rev: { fill: "#3b82f6", stroke: "#1d4ed8" },
    open: { fill: "#22c55e", stroke: "#15803d" },
    flowing: { fill: "#3b82f6", stroke: "#1d4ed8" },
    heating: { fill: "#ef4444", stroke: "#b91c1c" },
    cooling: { fill: "#3b82f6", stroke: "#1d4ed8" },
    normal: { fill: "#22c55e", stroke: "#15803d" },
    // Stopped/idle states
    stopped: { fill: "#94a3b8", stroke: "#475569" },
    closed: { fill: "#94a3b8", stroke: "#475569" },
    idle: { fill: "#94a3b8", stroke: "#475569" },
    empty: { fill: "#94a3b8", stroke: "#475569" },
    // Warning states
    manual: { fill: "#eab308", stroke: "#a16207" },
    transit: { fill: "#eab308", stroke: "#a16207" },
    cavitation: { fill: "#eab308", stroke: "#a16207" },
    alarm_high: { fill: "#f97316", stroke: "#c2410c" },
    alarm_low: { fill: "#f97316", stroke: "#c2410c" },
    low: { fill: "#eab308", stroke: "#a16207" },
    high: { fill: "#f97316", stroke: "#c2410c" },
    overflow: { fill: "#ef4444", stroke: "#b91c1c" },
    // Fault states
    faulted: { fill: "#ef4444", stroke: "#b91c1c" },
    blocked: { fill: "#ef4444", stroke: "#b91c1c" },
    // Defaults
    state_1: { fill: "#94a3b8", stroke: "#475569" },
    state_2: { fill: "#22c55e", stroke: "#15803d" },
    state_3: { fill: "#ef4444", stroke: "#b91c1c" },
  };

  const colors = stateColors[stateName] ?? {
    fill: "#94a3b8",
    stroke: "#475569",
  };

  // Simple approach: replace state-fill and state-stroke classes with actual colors
  let variant = baseSvg;

  // Replace fill colors on elements with class="state-fill"
  variant = variant.replace(
    /class="state-fill"([^>]*?)fill="[^"]*"/g,
    `class="state-fill"$1fill="${colors.fill}"`,
  );
  variant = variant.replace(
    /fill="[^"]*"([^>]*?)class="state-fill"/g,
    `fill="${colors.fill}"$1class="state-fill"`,
  );

  // Replace stroke colors on elements with class="state-stroke"
  variant = variant.replace(
    /class="state-stroke"([^>]*?)stroke="[^"]*"/g,
    `class="state-stroke"$1stroke="${colors.stroke}"`,
  );
  variant = variant.replace(
    /stroke="[^"]*"([^>]*?)class="state-stroke"/g,
    `stroke="${colors.stroke}"$1class="state-stroke"`,
  );

  return variant;
}

/** Convert SVG string to a data URI */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
