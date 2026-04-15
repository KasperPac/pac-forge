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
          "description": "string (IMPORTANT: stepNumber 1 MUST always be fault reset / healthy preconditions)",
          "actions": [
            {
              "id": "string (unique)",
              "type": "write | read | wait",
              "tag": "string (PLC tag — symbolic name like \\"DB_Inputs\\".ESTOP_OK)",
              "value": "boolean | number | string",
              "dataType": "Bool | Int | DInt | Real | Word | Time",
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

## MANDATORY: Fault Reset as First Step

The FIRST STEP of EVERY test case MUST clear all faults and set healthy preconditions before testing anything.
This is non-negotiable — a previous test may have left faults latched, e-stop tripped, or outputs in an unexpected state.

Every test case must begin with a step that:
1. Sets healthy preconditions (e-stop, overloads, safety signals)
2. Triggers the project's fault reset method (e.g., push button input) for the required duration, then releases it
3. Waits for the PLC to process the reset
4. Confirms the device under test has no active faults before proceeding

Study the generated code to identify the correct reset mechanism — do NOT write directly to internal fault reset DB tags that are driven by logic.

## CRITICAL: Timer and Delay Configuration for Testing

The test framework has network latency (~200-300ms per action) between the test runner and PLCSIM.
Any timer or delay configuration under 2 seconds is too fast to reliably test intermediate states.

When a test needs to verify a timer-dependent behavior (e.g., on-delay, off-delay, feedback timeout):
1. In the FIRST step of the test, WRITE the configuration DB timer value to T#2s (or 2000 for Int/DInt fields)
   Example: write "DB_Configuration".pe01Config.blockedDelay = T#2s
2. Use a wait action of at least 500ms between write and read when checking intermediate states
3. Use a wait action that EXCEEDS the overridden timer value when checking timer-elapsed states (e.g., waitMs: 2500 for a T#2s timer)

This applies to ALL Time-type configuration fields (clearDelay, blockedDelay, feedbackTimeout, timeoutDuration, etc.).
Do NOT skip this — tests WILL fail if sub-second timers are not overridden.

## Output Format

Return ONLY a JSON object matching this schema (no markdown fencing, no explanation):

${TEST_SUITE_SCHEMA}`;
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

export interface PlcsimTestPromptOptions {
  /** Restrict test generation to specific categories */
  categoryFilter?: string[];
  /** Which artifacts to include — "device_only" omits process_artifacts */
  artifactScope?: "device_only" | "all";
  /** Devices already covered by test templates — AI should skip these */
  excludeDevices?: string[];
}

export function buildPlcsimTestUserMessage(
  session: ForgeSession,
  profile: DesignProfile | null,
  options?: PlcsimTestPromptOptions,
): string {
  const isDeviceOnly = options?.artifactScope === "device_only";
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

    parts.push(isDeviceOnly
      ? "\n## PHYSICAL INPUT TAGS — reference only (IoLinking NOT active in device tests)"
      : "\n## PHYSICAL INPUT TAGS — use these for WRITE actions");
    parts.push(isDeviceOnly
      ? "These tags are NOT writable during device-only tests because IoLinking FC is not connected. Use DB_Inputs.* fields instead. Listed here for reference only."
      : "These are the ONLY tags you should write to. They are physical IO signals forced via PLCSIM.");
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

    parts.push("\n## DB TAGS — rules depend on test phase");
    parts.push("DB tags include DB_Inputs.*, DB_Outputs.*, DB_ProcessCommands.*, instance DB fields, DB_HmiData.*, etc.");
    parts.push("");
    if (isDeviceOnly) {
      parts.push("### Device FB Tests (current phase — device layer only, NO IoLinking FC):");
      parts.push("- The PLC is running with: Device Call FCs → Device FBs. The IoLinking FC is NOT connected.");
      parts.push("- Physical IO tags (PB_ENABLE, ESTOP_OK, FAN1_RUN) are NOT mapped — do NOT write to them.");
      parts.push("- Write to the **DB fields** that feed the device call FCs instead:");
      parts.push("  - Sensor/button inputs → **DB_Inputs** fields (e.g., \"DB_Inputs\".ESTOP_OK, \"DB_Inputs\".PB_ENABLE)");
      parts.push("  - Process commands → **DB_ProcessCommands** fields (e.g., \"DB_ProcessCommands\".fan01Enable)");
      parts.push("  - The Device Linkage table shows each device's wiring — the 'Connected To' column has the exact DB path.");
      parts.push("");
      parts.push("### CRITICAL: Follow inter-device dependency chains");
      parts.push("- Device Call FCs wire device FBs together — these links ARE active even without IoLinking.");
      parts.push("- Study the **interlocks** and **safety conditions** in the Device Linkage carefully.");
      parts.push("- You cannot shortcut dependencies by writing directly to a downstream device's input.");
      parts.push("  The device call FC overwrites it from the upstream device's output every scan.");
      parts.push("- Example: E-Stop → downstream devices:");
      parts.push("  1. Write \"DB_Inputs\".ESTOP_OK := TRUE (healthy NC contact signal)");
      parts.push("  2. Write \"DB_Inputs\".PB_RESET := TRUE, wait for resetHoldTime, then write FALSE");
      parts.push("  3. Wait for ControlEStop FB to process → \"InstESTOP\".safetyOk goes TRUE");
      parts.push("  4. Only THEN will downstream devices (fans, motors) see their safety interlock satisfied");
      parts.push("  Writing \"InstFAN01\".safetyOk := TRUE directly will NOT work — the call FC overwrites it from \"InstESTOP\".safetyOk.");
      parts.push("- Walk the FULL dependency chain for each device before writing test actions.");
      parts.push("");
      parts.push("- READ instance DB output params to verify behaviour (e.g., \"InstFAN01\".bOutCommandRun).");
      parts.push("- READ **DB_Outputs** fields to verify output state.");
      parts.push("- Do NOT write directly to instance DB inputs — the device call FC overwrites them every scan.");
      parts.push("- Configuration DB tags (DB_Configuration.*) CAN be written directly — they are not overwritten by any FC.");
    } else {
      parts.push("### System Tests (current phase — full program running with process sequences):");
      parts.push("- WRITE only to physical INPUT tags (from the table above). The sequence logic drives DB tags.");
      parts.push("- READ DB tags or physical output tags to verify PLC state.");
      parts.push("- Do NOT write to DB command tags or instance DB inputs — they are overwritten by the process sequence FCs every scan cycle.");
    }
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

    // Process sequences — skip for device-only tests (no process code exists yet)
    if (matrix.processSequences?.length && !isDeviceOnly) {
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
    ...(!isDeviceOnly ? (session.process_artifacts ?? []) : []),
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

  // Devices covered by test templates — AI should skip these
  const excluded = options?.excludeDevices;
  if (excluded?.length) {
    parts.push("\n## Devices with Template Tests (DO NOT generate tests for these)");
    parts.push("The following devices already have proven test procedures from templates. Skip them entirely:");
    for (const name of excluded) {
      parts.push(`- ${name}`);
    }
  }

  parts.push("\n---");
  parts.push("## CRITICAL REMINDERS (re-read before generating)");

  const cats = options?.categoryFilter;
  if (isDeviceOnly) {
    parts.push("1. The FIRST STEP of EVERY test case must walk the safety dependency chain: set DB_Inputs for safety signals, pulse reset, wait for safety FBs to clear, THEN proceed.");
    parts.push("2. Every device FB must have its own dedicated test case(s) — do NOT skip any FBs.");
    parts.push("3. Write to DB_Inputs.* and DB_ProcessCommands.* fields — NEVER physical IO tags (IoLinking not active).");
    parts.push("4. Follow inter-device wiring chains — do NOT shortcut by writing to a device's input that is driven by another device's output. Walk the dependency path.");
    parts.push("5. Configuration DB tags (DB_Configuration.*) CAN be written directly.");
    parts.push("6. READ instance DB output params or DB_Outputs.* fields to verify behaviour.");
    parts.push(`7. Generate ONLY device_fb category tests. Do NOT generate normal, fault, permissive, interlock, or reset tests — those will be generated in the System Tests phase after process code exists.`);
  } else {
    parts.push("1. The FIRST STEP of EVERY test case must be a fault reset / clean precondition step — clear all faults, set e-stop healthy, reset any latched states. Never assume the PLC starts in a clean state.");
    parts.push("2. WRITE only to physical INPUT tags (ESTOP_OK, M01_OL, etc.) — sequence FCs and device call FCs control all DB tags.");
    parts.push("3. READ DB tags or output tags to verify internal PLC state.");
    if (cats?.length) {
      parts.push(`4. Generate ONLY these test categories: ${cats.join(", ")}. Do NOT generate device_fb tests — those run in the Device Tests phase.`);
    }
    parts.push(`${cats?.length ? "5" : "4"}. Follow the ordering from the system prompt: permissive → normal → fault → interlock → reset. Use priority numbers accordingly.`);
  }

  parts.push("");
  parts.push("Generate the PLCSIM test suite. Return ONLY the JSON object, no markdown fencing.");

  return parts.join("\n");
}
