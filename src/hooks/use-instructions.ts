import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Instruction,
  InstructionPin,
  InstructionCategory,
  InstructionCreate,
  InstructionUpdate,
} from "@/types";

const INSTRUCTIONS_KEY = ["instructions"] as const;

// ---------------------------------------------------------------------------
// Hydration: attach pins to instruction rows
// ---------------------------------------------------------------------------

async function hydrateInstructions(
  instructions: Instruction[],
): Promise<Instruction[]> {
  if (instructions.length === 0) return [];

  const ids = instructions.map((i) => i.id);

  const { data: pinsData } = await supabase
    .from("instruction_pins")
    .select("*")
    .in("instruction_id", ids)
    .order("sort_order");

  const pinsMap = new Map<string, InstructionPin[]>();
  for (const p of (pinsData ?? []) as InstructionPin[]) {
    const arr = pinsMap.get(p.instruction_id) ?? [];
    arr.push(p);
    pinsMap.set(p.instruction_id, arr);
  }

  return instructions.map((i) => ({
    ...i,
    pins: pinsMap.get(i.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useInstructions(category?: InstructionCategory) {
  return useQuery({
    queryKey: [...INSTRUCTIONS_KEY, category ?? "all"],
    queryFn: async (): Promise<Instruction[]> => {
      let query = supabase
        .from("instructions")
        .select("*")
        .order("sort_order")
        .order("name");

      if (category) {
        query = query.eq("category", category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return hydrateInstructions(data as Instruction[]);
    },
  });
}

export function useInstruction(id: string | undefined) {
  return useQuery({
    queryKey: [...INSTRUCTIONS_KEY, id],
    queryFn: async (): Promise<Instruction> => {
      const { data, error } = await supabase
        .from("instructions")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const [hydrated] = await hydrateInstructions([data as Instruction]);
      return hydrated;
    },
    enabled: !!id,
  });
}

/**
 * Fetch instructions for prompt injection, filtered by programming language.
 * Returns instructions where programming_language matches the given language or is "BOTH".
 */
export function useInstructionsForPrompt(language?: "LAD" | "SCL") {
  return useQuery({
    queryKey: [...INSTRUCTIONS_KEY, "prompt", language ?? "all"],
    queryFn: async (): Promise<Instruction[]> => {
      let query = supabase
        .from("instructions")
        .select("*")
        .order("sort_order")
        .order("name");

      if (language) {
        query = query.in("programming_language", [language, "BOTH"]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return hydrateInstructions(data as Instruction[]);
    },
  });
}

/**
 * Standalone fetch (not a hook) for use inside callbacks.
 * Fetches instructions filtered by language and optionally by categories, with pins hydrated.
 */
export async function fetchInstructionsForPrompt(
  language?: "LAD" | "SCL",
  categories?: InstructionCategory[],
): Promise<Instruction[]> {
  let query = supabase
    .from("instructions")
    .select("*")
    .order("sort_order")
    .order("name");

  if (language) {
    query = query.in("programming_language", [language, "BOTH"]);
  }

  if (categories && categories.length > 0) {
    query = query.in("category", categories);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("Failed to fetch instructions:", error.message);
    return [];
  }
  return hydrateInstructions(data as Instruction[]);
}

/**
 * Default instruction categories for typical device FB generation.
 * Covers contacts, coils, timers, counters — the core LAD building blocks.
 */
export const DEVICE_FB_CATEGORIES: InstructionCategory[] = [
  "bit_logic",
  "timers_counters",
];

/**
 * Instruction categories for process/sequence code.
 * Adds comparators and math on top of device FB basics.
 */
export const PROCESS_CODE_CATEGORIES: InstructionCategory[] = [
  "bit_logic",
  "timers_counters",
  "comparators",
  "math",
  "move_convert",
];

/**
 * All categories — used for standalone Pac-LAD generation
 * where the user might need any instruction.
 */
export const ALL_CATEGORIES: InstructionCategory[] = [
  "bit_logic",
  "timers_counters",
  "comparators",
  "math",
  "move_convert",
  "extended",
];

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateInstruction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: InstructionCreate) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { pins, ...instructionData } = input;

      // Insert parent
      const { data: instruction, error: iErr } = await supabase
        .from("instructions")
        .insert({ ...instructionData, created_by: user.id })
        .select()
        .single();
      if (iErr) throw iErr;

      const instructionId = (instruction as Instruction).id;

      // Insert pins
      if (pins.length > 0) {
        const pinRows = pins.map((p, i) => ({
          instruction_id: instructionId,
          pin_name: p.pin_name,
          direction: p.direction,
          data_type: p.data_type,
          is_rung_flow: p.is_rung_flow,
          is_required: p.is_required,
          description: p.description,
          sort_order: p.sort_order ?? i,
        }));
        const { error: pErr } = await supabase
          .from("instruction_pins")
          .insert(pinRows);
        if (pErr) throw pErr;
      }

      return instruction as Instruction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTIONS_KEY });
    },
  });
}

export function useUpdateInstruction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: InstructionUpdate;
    }) => {
      const { pins, ...instructionUpdates } = updates;

      // Update parent fields (if any)
      if (Object.keys(instructionUpdates).length > 0) {
        const { error: uErr } = await supabase
          .from("instructions")
          .update(instructionUpdates)
          .eq("id", id);
        if (uErr) throw uErr;
      }

      // Replace pins if provided
      if (pins) {
        // Delete existing pins
        const { error: dErr } = await supabase
          .from("instruction_pins")
          .delete()
          .eq("instruction_id", id);
        if (dErr) throw dErr;

        // Insert new pins
        if (pins.length > 0) {
          const pinRows = pins.map((p, i) => ({
            instruction_id: id,
            pin_name: p.pin_name,
            direction: p.direction,
            data_type: p.data_type,
            is_rung_flow: p.is_rung_flow,
            is_required: p.is_required,
            description: p.description,
            sort_order: p.sort_order ?? i,
          }));
          const { error: pErr } = await supabase
            .from("instruction_pins")
            .insert(pinRows);
          if (pErr) throw pErr;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTIONS_KEY });
    },
  });
}

export function useDeleteInstruction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("instructions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTIONS_KEY });
    },
  });
}

/**
 * Verify instruction pins from a SimaticML XML export.
 * Matches Part Names to existing instructions and replaces their pins
 * with the XML-verified pin names.
 */
export function useVerifyFromXml() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Array<{
      instructionId: string;
      pins: Array<{ pin_name: string; direction: "in" | "out" | "inout"; is_rung_flow: boolean }>;
    }>) => {
      for (const { instructionId, pins } of updates) {
        // Mark instruction as verified
        const { error: uErr } = await supabase
          .from("instructions")
          .update({ verified: true })
          .eq("id", instructionId);
        if (uErr) throw uErr;

        // Delete existing pins
        const { error: dErr } = await supabase
          .from("instruction_pins")
          .delete()
          .eq("instruction_id", instructionId);
        if (dErr) throw dErr;

        // Insert XML-verified pins (preserve existing data_type/description where possible)
        if (pins.length > 0) {
          const pinRows = pins.map((p, i) => ({
            instruction_id: instructionId,
            pin_name: p.pin_name,
            direction: p.direction,
            data_type: "BOOL", // default — XML doesn't carry type info
            is_rung_flow: p.is_rung_flow,
            is_required: true,
            description: null,
            sort_order: i,
          }));
          const { error: pErr } = await supabase
            .from("instruction_pins")
            .insert(pinRows);
          if (pErr) throw pErr;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSTRUCTIONS_KEY });
    },
  });
}
