/**
 * plcsim-test-prompt.ts
 *
 * Prompt builder for PM agent to generate PLCSIM Advanced test cases
 * from the linkage matrix, device list, IO list, and generated artifacts.
 */

import type { ForgeSession } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import { resolveSection } from "@/lib/prompt-defaults";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLCSIM_TEST_MAX_TOKENS = 32768;

// ---------------------------------------------------------------------------
// JSON schema for the expected output
// ---------------------------------------------------------------------------

const TEST_SUITE_SCHEMA = `{
  "ioSimRules": [
    {
      "id": "string (unique)",
      "triggerTag": "string (PLC output tag that triggers this rule, e.g. \\"InstM01\\".cmdFwd)",
      "triggerValue": "boolean or number",
      "responseTag": "string (PLC input tag to set in response, e.g. \\"DB_Inputs\\".M01_FeedbackRun)",
      "responseValue": "boolean or number",
      "delayMs": "number (ms before responding, e.g. 500 for motor feedback)",
      "description": "string (human-readable explanation)",
      "enabled": true
    }
  ],
  "testCases": [
    {
      "id": "string (unique)",
      "name": "string (short test name)",
      "sequenceName": "string | null (which process sequence this tests, null for system-level)",
      "category": "device_fb | normal | fault | permissive | interlock | reset",
      "description": "string (what this test proves)",
      "steps": [
        {
          "id": "string (unique)",
          "stepNumber": 1,
          "description": "string (what this step verifies)",
          "actions": [
            {
              "id": "string (unique)",
              "type": "write | read | wait",
              "tag": "string (PLC tag — symbolic name like \\"DB_Inputs\\".ESTOP_OK)",
              "value": "boolean | number | string",
              "dataType": "Bool | Int | DInt | Real | Word",
              "tolerance": "number (optional, for analog read assertions)",
              "waitMs": "number (optional, for wait actions — ms)",
              "description": "string"
            }
          ]
        }
      ],
      "simRules": ["array of IoSimulationRule IDs active during this test"],
      "priority": "number (lower = runs first)",
      "approved": false
    }
  ]
}`;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildPlcsimTestPrompt(
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "plcsim_test", "identity");
  const instructions = resolveSection(promptSections, "plcsim_test", "instructions");

  return `${identity}

${instructions}

## Output Format

Return ONLY a JSON object matching this schema (no markdown fencing, no explanation):

${TEST_SUITE_SCHEMA}`;
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

export function buildPlcsimTestUserMessage(
  session: ForgeSession,
  profile: DesignProfile | null,
): string {
  const parts: string[] = [];

  // Project context
  parts.push("## Project Context");
  if (session.spec_analysis) {
    parts.push(`Project: ${session.spec_analysis.project_name}`);
    parts.push(`Description: ${session.spec_analysis.project_description}`);
    parts.push(`PLC: ${session.spec_analysis.plc_type}`);
  }
  if (profile) {
    parts.push(`Design Profile: ${profile.name}`);
    if (profile.db_naming_prefix) {
      parts.push(`DB Naming Prefix: ${profile.db_naming_prefix}`);
    }
  }

  // IO List — split into WRITE-able inputs vs READ-able outputs
  if (session.io_list?.length) {
    const inputs = session.io_list.filter((io) => io.signal_type === "DI" || io.signal_type === "AI");
    const outputs = session.io_list.filter((io) => io.signal_type === "DQ" || io.signal_type === "AQ");

    parts.push("\n## PHYSICAL INPUT TAGS — use these for WRITE actions");
    parts.push("These are the ONLY tags you should write to. They are physical IO signals forced via PLCSIM.");
    if (inputs.length) {
      parts.push("| Tag Name | Signal Type | Data Type | Description | Device |");
      parts.push("|----------|-------------|-----------|-------------|--------|");
      for (const io of inputs) {
        parts.push(`| ${io.tag_name} | ${io.signal_type} | ${io.data_type} | ${io.description} | ${io.device_id ?? "-"} |`);
      }
    } else {
      parts.push("(No physical inputs found in IO list)");
    }

    parts.push("\n## PHYSICAL OUTPUT TAGS — use these for READ actions (verify PLC outputs)");
    if (outputs.length) {
      parts.push("| Tag Name | Signal Type | Data Type | Description | Device |");
      parts.push("|----------|-------------|-----------|-------------|--------|");
      for (const io of outputs) {
        parts.push(`| ${io.tag_name} | ${io.signal_type} | ${io.data_type} | ${io.description} | ${io.device_id ?? "-"} |`);
      }
    } else {
      parts.push("(No physical outputs found in IO list)");
    }

    parts.push("\n## DB TAGS — rules depend on test category");
    parts.push("DB tags include DB_Inputs.*, DB_Outputs.*, DB_Process_Commands.*, instance DB fields, DB_HmiData.*, etc.");
    parts.push("");
    parts.push("### For device_fb tests (unit testing a single FB):");
    parts.push("- You MAY write to DB tags that are FB inputs (e.g., DB_Process_Commands.cv01RunForward) to directly drive the FB under test, bypassing sequence logic.");
    parts.push("- This is like bench-testing a device — you force the command inputs and check the outputs.");
    parts.push("- READ the FB's output DB tags or physical output tags to verify behaviour.");
    parts.push("");
    parts.push("### For all other tests (normal, fault, permissive, interlock, reset):");
    parts.push("- WRITE only to physical INPUT tags (from the table above). The sequence logic drives DB tags.");
    parts.push("- READ DB tags or physical output tags to verify PLC state.");
    parts.push("- ⚠ Do NOT write to DB tags in sequence/integration tests — they will be overwritten by the PLC scan cycle.");
  }

  // Device list — FB instances to test
  if (session.device_list?.length) {
    parts.push("\n## Device List");
    parts.push("| Name | Tag | Type | Description |");
    parts.push("|------|-----|------|-------------|");
    for (const dev of session.device_list) {
      parts.push(`| ${dev.name} | ${dev.tag} | ${dev.device_type} | ${dev.description} |`);
    }
  }

  // Linkage matrix — wiring + sequences
  if (session.linkage_matrix) {
    const matrix = session.linkage_matrix;

    // Device linkage (FB wiring tells us what tags to use)
    if (matrix.deviceLinkage?.length) {
      parts.push("\n## Device Linkage (FB Wiring)");
      parts.push("This shows how each device FB is wired — use these tag paths in test actions.");
      for (const dev of matrix.deviceLinkage) {
        parts.push(`\n### ${dev.name} (${dev.fbName}, Instance DB: ${dev.instanceDbName})`);
        if (dev.wiring?.length) {
          parts.push("| Param | Direction | Connected To | Wire Type |");
          parts.push("|-------|-----------|-------------|-----------|");
          for (const w of dev.wiring) {
            parts.push(`| ${w.paramName} | ${w.direction} | ${w.connectedTo} | ${w.wireType} |`);
          }
        }
        if (dev.interlocks?.length) {
          parts.push("**Interlocks:**");
          for (const il of dev.interlocks) {
            parts.push(`- ${il.direction} ${il.targetDeviceName}: ${il.condition}`);
          }
        }
      }
    }

    // Process sequences — the core logic to test
    if (matrix.processSequences?.length) {
      parts.push("\n## Process Sequences");
      parts.push("These are the state-machine sequences that the test suite must validate.");
      for (const seq of matrix.processSequences) {
        parts.push(`\n### Sequence: ${seq.name}`);
        parts.push(seq.description);

        if (seq.permissives?.length) {
          parts.push("\n**Permissives (must be TRUE to start):**");
          for (const p of seq.permissives) {
            parts.push(`- ${p.description}${p.deviceName ? ` (${p.deviceName})` : ""} — polarity: ${p.polarity}`);
          }
        }

        if (seq.safetyConditions?.length) {
          parts.push("\n**Safety Conditions (continuously monitored):**");
          for (const sc of seq.safetyConditions) {
            parts.push(`- ${sc.description}${sc.deviceName ? ` (${sc.deviceName})` : ""} — polarity: ${sc.polarity}`);
          }
        }

        // v2 row format
        if (seq.rows?.length) {
          parts.push("\n**Sequence Steps:**");
          parts.push("| Step | Branch | Condition | Action | Output | Next | Type | Devices |");
          parts.push("|------|--------|-----------|--------|--------|------|------|---------|");
          for (const row of seq.rows) {
            parts.push(`| ${row.step} | ${row.branch ?? "-"} | ${row.condition} | ${row.action} | ${row.output ?? "-"} | ${row.next} | ${row.type} | ${row.devices.join(", ")} |`);
          }
        }

        // Legacy step format
        if (seq.steps?.length && !seq.rows?.length) {
          parts.push("\n**Sequence Steps (legacy):**");
          for (const step of seq.steps) {
            const conds = step.transition?.conditions?.map(c => c.description).join(" + ") ?? step.completionCriteria ?? "";
            const actions = step.actions?.map(a => a.description).join("; ") ?? step.action ?? "";
            parts.push(`- Step ${step.stepNumber}: ${actions} | Transition: ${conds} | Devices: ${step.devicesInvolved.join(", ")}`);
          }
        }
      }
    }

    // Global data blocks
    if (matrix.globalData?.length) {
      parts.push("\n## Global Data Blocks");
      for (const gd of matrix.globalData) {
        parts.push(`\n### ${gd.dbName} — ${gd.purpose}`);
        if (gd.fields?.length) {
          parts.push("| Field | Data Type | Description |");
          parts.push("|-------|-----------|-------------|");
          for (const f of gd.fields) {
            parts.push(`| ${f.fieldName} | ${f.dataType} | ${f.description} |`);
          }
        }
      }
    }
  }

  // Generated artifacts — extract tag names from SCL code
  const allArtifacts = [
    ...(session.device_artifacts ?? []),
    ...(session.process_artifacts ?? []),
  ];
  if (allArtifacts.length) {
    parts.push("\n## Generated Code Artifacts");
    parts.push("Reference these for exact tag/DB names used in the PLC program.");
    for (const art of allArtifacts) {
      parts.push(`\n### ${art.name} (${art.type}, ${art.language})`);
      // Include only the interface/declaration section (first 80 lines) for tag reference
      const lines = art.content.split("\n");
      const preview = lines.slice(0, 80).join("\n");
      parts.push("```scl");
      parts.push(preview);
      if (lines.length > 80) parts.push(`// ... (${lines.length - 80} more lines)`);
      parts.push("```");
    }
  }

  parts.push("\n---");
  parts.push("## CRITICAL REMINDERS (re-read before generating)");
  parts.push("1. The FIRST STEP of EVERY test case must be a fault reset / clean precondition step — clear all faults, set e-stop healthy, reset any latched states. Never assume the PLC starts in a clean state.");
  parts.push("2. Every device FB must have its own dedicated test case(s) — do NOT skip any FBs.");
  parts.push("3. Follow the ordering from the system prompt: device_fb → permissive → normal → fault → interlock → reset. Use priority numbers accordingly.");
  parts.push("4. For device_fb tests: you MAY write to DB command tags (e.g., DB_Process_Commands.cv01RunForward) to directly drive the FB under test. For ALL other test categories: WRITE only to physical input tags (ESTOP_OK, M01_OL, etc.).");
  parts.push("5. READ actions should use DB tags or output tags to verify internal PLC state (e.g., DB_Outputs.M01_CMD_FWD, \"InstM01\".fault).");
  parts.push("");
  parts.push("Generate a comprehensive PLCSIM test suite. Return ONLY the JSON object, no markdown fencing.");

  return parts.join("\n");
}
