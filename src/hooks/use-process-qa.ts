import { useCallback, useRef } from "react";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import type { ProcessQaMessage } from "@/stores/process-builder-store";
import { buildProcessQaPrompt } from "@/lib/process-qa-prompt";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import { useUpdateProcessBuilderSession } from "@/hooks/use-process-builder-session";
import type {
  Project,
  Agent,
  DesignProfile,
  AgentKnowledgeDoc,
  FbTemplate,
  IoRecommendation,
  FbRecommendation,
  ProcessLinkageMatrix,
} from "@/types";

// ---------------------------------------------------------------------------
// Legacy parsers (backward compat with old PM instructions)
// ---------------------------------------------------------------------------

/** Parse [IO_RECOMMENDATION]...[/IO_RECOMMENDATION] blocks from PM response. */
function parseIoRecommendations(text: string): IoRecommendation[] {
  const recs: IoRecommendation[] = [];
  const regex = /\[IO_RECOMMENDATION\]([\s\S]*?)\[\/IO_RECOMMENDATION\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const mlfb = block.match(/mlfb:\s*(.+)/i)?.[1]?.trim() ?? "";
    const rack = parseInt(block.match(/rack:\s*(\d+)/i)?.[1] ?? "0", 10);
    const slot = parseInt(block.match(/slot:\s*(\d+)/i)?.[1] ?? "0", 10);
    const description = block.match(/description:\s*(.+)/i)?.[1]?.trim() ?? "";
    if (mlfb) {
      recs.push({ mlfb, rack, slot, description, confirmed: false });
    }
  }
  return recs;
}

/** Parse [FB_RECOMMENDATION]...[/FB_RECOMMENDATION] blocks from PM response. */
function parseFbRecommendations(text: string): FbRecommendation[] {
  const recs: FbRecommendation[] = [];
  const regex = /\[FB_RECOMMENDATION\]([\s\S]*?)\[\/FB_RECOMMENDATION\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const deviceType = block.match(/deviceType:\s*(.+)/i)?.[1]?.trim() ?? "";
    const templateName = block.match(/templateName:\s*(.+)/i)?.[1]?.trim() ?? "";
    const templateIdRaw = block.match(/templateId:\s*(.+)/i)?.[1]?.trim() ?? "null";
    const templateId = templateIdRaw === "null" ? null : templateIdRaw;
    const instanceCount = parseInt(block.match(/instanceCount:\s*(\d+)/i)?.[1] ?? "1", 10);
    if (deviceType) {
      recs.push({ deviceType, templateId, templateName, instanceCount, confirmed: false });
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// New matrix parser
// ---------------------------------------------------------------------------

/** Parse [PROCESS_MATRIX]...[/PROCESS_MATRIX] JSON from PM response. */
// ---------------------------------------------------------------------------
// Helper: convert PM's alternative "instances + ioTags" schema to deviceLinkage
// The PM sometimes produces a richer format with `instances`, `ioTags`,
// `functionBlocks`, `globalDBs`, `ob1CallSequence` instead of the expected
// `deviceLinkage`, `globalData`, `processSteps`.
// ---------------------------------------------------------------------------

type RawObj = Record<string, unknown>;
type RawArr = Array<RawObj>;

function convertAlternativeSchema(raw: RawObj): {
  devices: RawArr;
  globalData: RawArr;
  processSteps: RawArr;
} {
  // Collect instance entries from any key the PM might use
  const instances = [
    ...((raw.instances ?? []) as RawArr),
    ...((raw.instanceDBs ?? raw.instanceDbs ?? raw.instance_dbs ?? []) as RawArr),
  ];
  const ioTags = (raw.ioTags ?? raw.io_tags ?? []) as RawArr;

  // Build a map: instanceName → list of IO tag names used by that instance.
  // We extract this from `callingFCs` wiring (inputs/outputs that reference ioTags).
  const ioTagNames = new Set(ioTags.map((t) => (t.tagName ?? t.tag_name ?? "") as string));
  const tagsByInstance = new Map<string, Set<string>>();

  const callingFCs = (raw.callingFCs ?? raw.calling_fcs ?? raw.functionControls ?? []) as RawArr;
  for (const fc of callingFCs) {
    const calls = (fc.calls ?? []) as RawArr;
    for (const call of calls) {
      const instName = (call.instance ?? call.instanceName ?? "") as string;
      if (!instName) continue;
      if (!tagsByInstance.has(instName)) tagsByInstance.set(instName, new Set());
      const tagSet = tagsByInstance.get(instName)!;
      // Scan inputs and outputs for references to known IO tags
      for (const section of [call.inputs, call.outputs]) {
        if (section && typeof section === "object") {
          for (const val of Object.values(section as Record<string, unknown>)) {
            const v = String(val ?? "");
            if (ioTagNames.has(v)) tagSet.add(v);
          }
        }
      }
    }
  }

  // Build IO tag lookup for quick access
  const ioTagMap = new Map<string, RawObj>();
  for (const tag of ioTags) {
    ioTagMap.set((tag.tagName ?? tag.tag_name ?? "") as string, tag);
  }

  // If no instances exist, fall back to functionBlocks as device types
  const fbList = (raw.functionBlocks ?? raw.function_blocks ?? []) as RawArr;

  // Convert instances → deviceLinkage entries
  let devices: RawArr;
  if (instances.length > 0) {
    // Track which ioTags were claimed
    const claimedTags = new Set<string>();

    // First pass: build device entries with raw signal arrays
    const deviceEntries = instances.map((inst) => {
      const instName = (inst.instanceName ?? inst.dbName ?? inst.name ?? "") as string;
      const fbName = (inst.fbName ?? inst.instanceOf ?? inst.fb ?? "") as string;
      const deviceRef = (inst.deviceRef ?? "") as string;

      // Collect raw IO signal objects: from callingFCs wiring, then from deviceRef
      const rawSignals: RawArr = [];
      const wireTags = tagsByInstance.get(instName);
      if (wireTags && wireTags.size > 0) {
        for (const tagName of wireTags) {
          const tag = ioTagMap.get(tagName);
          if (tag) {
            rawSignals.push(tag);
            claimedTags.add(tagName);
          }
        }
      }
      // Also try deviceRef grouping (previous PM format)
      if (rawSignals.length === 0 && deviceRef) {
        for (const tag of ioTags) {
          if ((tag.deviceRef ?? "") === deviceRef) {
            const tn = (tag.tagName ?? tag.tag_name ?? "") as string;
            if (!claimedTags.has(tn)) {
              rawSignals.push(tag);
              claimedTags.add(tn);
            }
          }
        }
      }

      return { instName, fbName, deviceRef, rawSignals, inst };
    });

    // Second pass: assign unclaimed ioTags by fuzzy matching tag name keywords
    const unclaimed = ioTags.filter((t) => !claimedTags.has((t.tagName ?? t.tag_name ?? "") as string));
    for (const tag of unclaimed) {
      const tagName = ((tag.tagName ?? tag.tag_name ?? "") as string).toLowerCase();
      const tagClean = tagName.replace(/^(tag_|di_|dq_|ai_|aq_)/i, "");
      let matched = false;
      for (const entry of deviceEntries) {
        const devWords = [entry.instName, entry.fbName, entry.deviceRef]
          .filter(Boolean)
          .flatMap((w) => w.toLowerCase().replace(/inst_?|control|_?\d+$/gi, "").split(/[_\s]+/))
          .filter((w) => w.length >= 3);
        if (devWords.some((w) => tagClean.includes(w))) {
          entry.rawSignals.push(tag);
          claimedTags.add((tag.tagName ?? tag.tag_name ?? "") as string);
          matched = true;
          break;
        }
      }
      if (!matched) continue;
    }

    // Format helper for raw signal → final signal object
    const formatSignal = (s: RawObj) => ({
      tagName: s.tagName ?? s.tag_name ?? "",
      signalType: s.type ?? s.ioType ?? s.signalType ?? "DI",
      purpose: s.description ?? "",
    });

    // Build final device objects
    devices = deviceEntries.map(({ instName, fbName, inst, rawSignals }) => ({
      name: instName,
      deviceType: fbName,
      description: (inst.description ?? `Instance of ${fbName}`) as string,
      ioSignals: rawSignals.map(formatSignal),
      fbName,
      fbTemplateName: (inst.template ?? inst.templateId ?? null) as string | null,
      fbTemplateId: null,
      instanceDbName: instName,
      interlocks: [],
    }));

    // Any remaining unclaimed ioTags → synthetic "IO_Unassigned" device
    const stillUnclaimed = ioTags.filter((t) => !claimedTags.has((t.tagName ?? t.tag_name ?? "") as string));
    if (stillUnclaimed.length > 0) {
      devices.push({
        name: "IO_Unassigned",
        deviceType: "Unassigned",
        description: "IO tags not linked to a specific device instance",
        ioSignals: stillUnclaimed.map(formatSignal),
        fbName: "",
        fbTemplateName: null,
        fbTemplateId: null,
        instanceDbName: "",
        interlocks: [],
      });
    }
  } else if (fbList.length > 0) {
    // No instances — use functionBlocks as device types
    devices = fbList.map((fb) => ({
      name: fb.blockName ?? fb.name ?? "",
      deviceType: fb.blockType ?? "FB",
      description: (fb.description ?? "") as string,
      ioSignals: [],
      fbName: fb.blockName ?? fb.name ?? "",
      fbTemplateName: fb.templateId ?? fb.template ?? null,
      fbTemplateId: null,
      instanceDbName: "",
      interlocks: [],
    }));
  } else {
    devices = [];
  }

  // Convert globalDBs → globalData
  const globalDBs = (raw.globalDBs ?? raw.globalDbs ?? raw.global_dbs ?? []) as RawArr;
  const globalData: RawArr = globalDBs.map((gdb) => ({
    dbName: gdb.dbName ?? gdb.name ?? "",
    purpose: gdb.description ?? gdb.purpose ?? "",
    fields: ((gdb.variables ?? gdb.fields ?? []) as RawArr).map((v) => ({
      fieldName: v.name ?? v.fieldName ?? "",
      dataType: v.dataType ?? v.type ?? "",
      description: v.description ?? "",
    })),
  }));

  // Convert ob1CallSequence or callingFCs → processSteps
  const callSeq = (raw.ob1CallSequence ?? raw.callSequence ?? raw.call_sequence ?? []) as RawArr;
  let processSteps: RawArr;
  if (callSeq.length > 0) {
    processSteps = callSeq.map((cs, i) => ({
      stepNumber: cs.order ?? i + 1,
      action: `Call ${cs.block ?? cs.name ?? ""}`,
      completionCriteria: (cs.description ?? "") as string,
      devicesInvolved: ((cs.calls ?? []) as string[]),
      notes: "",
    }));
  } else if (callingFCs.length > 0) {
    // Use callingFCs as process steps
    processSteps = callingFCs.map((fc, i) => ({
      stepNumber: i + 1,
      action: `Call ${(fc.fcName ?? fc.name ?? "") as string}`,
      completionCriteria: (fc.description ?? "") as string,
      devicesInvolved: ((fc.calls ?? []) as RawArr).map((c) => (c.instance ?? c.name ?? "") as string),
      notes: "",
    }));
  } else {
    processSteps = [];
  }

  return { devices, globalData, processSteps };
}

export function parseProcessMatrix(text: string): ProcessLinkageMatrix | null {
  const regex = /\[PROCESS_MATRIX\]\s*([\s\S]*?)\s*\[\/PROCESS_MATRIX\]/;
  const match = regex.exec(text);
  if (!match) return null;

  try {
    // Strip markdown code fences if PM wrapped JSON in ```json ... ```
    let jsonStr = match[1].trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

    const raw = JSON.parse(jsonStr) as RawObj;

    // Try canonical keys first, then common alternatives
    let devices = (raw.deviceLinkage ?? raw.devices ?? raw.device_linkage ?? raw.deviceList ?? []) as RawArr;
    let globalData = (raw.globalData ?? raw.global_data ?? raw.globalDataBlocks ?? []) as RawArr;
    let processSteps = (raw.processSteps ?? raw.process_steps ?? raw.steps ?? raw.sequence ?? []) as RawArr;

    // Fallback: PM used alternative schema (instances/instanceDBs, ioTags, functionBlocks, etc.)
    if (devices.length === 0 && (raw.instances || raw.instanceDBs || raw.instanceDbs || raw.functionBlocks || raw.callingFCs)) {
      const converted = convertAlternativeSchema(raw);
      devices = converted.devices;
      if (globalData.length === 0) globalData = converted.globalData;
      if (processSteps.length === 0) processSteps = converted.processSteps;
    }

    // Hydrate with UUIDs where missing
    const matrix: ProcessLinkageMatrix = {
      version: (raw.version as number) ?? 1,
      deviceLinkage: devices.map((d) => {
        const ioSigs = (d.ioSignals ?? d.io_signals ?? d.signals ?? d.io ?? []) as RawArr;
        const ilocks = (d.interlocks ?? d.interlock ?? []) as RawArr;
        return {
          id: (d.id as string) ?? crypto.randomUUID(),
          name: (d.name ?? d.deviceName ?? d.device_name ?? "") as string,
          deviceType: (d.deviceType ?? d.device_type ?? d.type ?? "") as string,
          description: (d.description ?? d.desc ?? "") as string,
          ioSignals: ioSigs.map((s) => ({
            id: (s.id as string) ?? crypto.randomUUID(),
            tagName: (s.tagName ?? s.tag_name ?? s.tag ?? "") as string,
            signalType: (s.signalType ?? s.signal_type ?? s.type ?? "DI") as "DI" | "DQ" | "AI" | "AQ",
            purpose: (s.purpose ?? s.description ?? "") as string,
          })),
          fbName: (d.fbName ?? d.fb_name ?? d.fb ?? "") as string,
          fbTemplateName: (d.fbTemplateName ?? d.fb_template_name ?? null) as string | null,
          fbTemplateId: (d.fbTemplateId ?? d.fb_template_id ?? null) as string | null,
          instanceDbName: (d.instanceDbName ?? d.instance_db_name ?? d.instanceDb ?? d.instance_db ?? "") as string,
          interlocks: ilocks.map((il) => ({
            id: (il.id as string) ?? crypto.randomUUID(),
            targetDeviceName: (il.targetDeviceName ?? il.target_device_name ?? il.target ?? "") as string,
            condition: (il.condition ?? "") as string,
            direction: (il.direction ?? "requires") as "requires" | "blocks" | "follows",
          })),
        };
      }),
      globalData: globalData.map((gd) => ({
        id: (gd.id as string) ?? crypto.randomUUID(),
        dbName: (gd.dbName ?? gd.db_name ?? gd.name ?? "") as string,
        purpose: (gd.purpose ?? gd.description ?? "") as string,
        fields: ((gd.fields ?? gd.variables ?? []) as RawArr).map((f) => ({
          id: (f.id as string) ?? crypto.randomUUID(),
          fieldName: (f.fieldName ?? f.field_name ?? f.name ?? "") as string,
          dataType: (f.dataType ?? f.data_type ?? f.type ?? "") as string,
          description: (f.description ?? f.desc ?? "") as string,
        })),
      })),
      processSteps: processSteps.map((ps) => ({
        id: (ps.id as string) ?? crypto.randomUUID(),
        stepNumber: (ps.stepNumber ?? ps.step_number ?? ps.step ?? ps.order ?? 0) as number,
        action: (ps.action ?? ps.description ?? "") as string,
        completionCriteria: (ps.completionCriteria ?? ps.completion_criteria ?? ps.criteria ?? "") as string,
        devicesInvolved: (ps.devicesInvolved ?? ps.devices_involved ?? ps.devices ?? ps.calls ?? []) as string[],
        notes: (ps.notes ?? ps.note ?? "") as string,
      })),
      notes: (raw.notes as string) ?? "",
      generatedAt: new Date().toISOString(),
      lastReviewedAt: null,
      reviewStatus: "draft",
    };

    return matrix;
  } catch {
    return null;
  }
}

export interface ProcessQaSendInput {
  userMessage: string;
  project: Project;
  pmAgent: Agent;
  sessionId: string;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  fbTemplates?: FbTemplate[];
  promptSections?: Record<string, string>;
}

export function useProcessQa() {
  const store = useProcessBuilderStore;
  const abortRef = useRef<AbortController | null>(null);
  const updateSession = useUpdateProcessBuilderSession();

  const sendMessage = useCallback(
    async (input: ProcessQaSendInput) => {
      const { userMessage, project, pmAgent, sessionId, knowledgeDocs, designProfile, fbTemplates, promptSections } = input;

      store.getState().clearStreaming();

      // Add user message
      const userMsg: ProcessQaMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      store.getState().addQaMessage(userMsg);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // Build conversation history from existing messages
        const existingMessages = store.getState().qaMessages;
        const conversationHistory = existingMessages
          .filter((m) => m.id !== userMsg.id)
          .map((m) => ({
            role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: m.content,
          }));

        const { systemPrompt, messages: promptMessages } = buildProcessQaPrompt({
          project,
          pmAgent,
          knowledgeDocs,
          designProfile,
          fbTemplates,
          promptSections,
          conversationHistory,
          userMessage,
        });

        const fullContent = await streamFromEdgeFunction(
          {
            system_prompt: systemPrompt,
            messages: promptMessages,
            stream: true,
            max_tokens: 16384,
          },
          abort.signal,
          (chunk) => {
            const current = store.getState().streamingContent;
            store.setState({ streamingContent: (current ?? "") + chunk });
          },
        );

        // Add PM response to history
        const pmMsg: ProcessQaMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullContent,
          timestamp: new Date().toISOString(),
        };
        store.getState().addQaMessage(pmMsg);
        store.getState().clearStreaming();

        // Parse Process Linkage Matrix from PM response (new format)
        const matrix = parseProcessMatrix(fullContent);
        if (matrix) {
          store.getState().setLinkageMatrix(matrix);
        }

        // Fallback: parse legacy IO/FB recommendation blocks (backward compat)
        const ioRecs = parseIoRecommendations(fullContent);
        if (ioRecs.length > 0) {
          const existing = store.getState().ioRecommendations;
          store.getState().setIoRecommendations([...existing, ...ioRecs]);
        }

        const fbRecs = parseFbRecommendations(fullContent);
        if (fbRecs.length > 0) {
          const existing = store.getState().fbRecommendations;
          store.getState().setFbRecommendations([...existing, ...fbRecs]);
        }

        // Auto-save to Supabase
        const state = store.getState();
        updateSession.mutate({
          sessionId,
          updates: {
            qa_answers: state.qaAnswers,
            io_recommendations: state.ioRecommendations,
            fb_recommendations: state.fbRecommendations,
            linkage_matrix: state.linkageMatrix,
          },
        });
      } catch (err) {
        store.getState().clearStreaming();

        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        // Add error message to chat
        const errMsg: ProcessQaMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        };
        store.getState().addQaMessage(errMsg);
      }
    },
    [store, updateSession],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    store.getState().clearStreaming();
  }, [store]);

  return { sendMessage, cancel };
}
