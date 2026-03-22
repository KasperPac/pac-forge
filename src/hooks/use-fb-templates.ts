import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FbTemplate, FbTemplateBlock, FbTemplateCreate, FbTemplateUpdate, FbTemplateVersion, FbTemplateProfileTag } from "@/types";

const FB_TEMPLATES_KEY = ["fb-templates"] as const;

/** Attach blocks and profile_ids to a list of templates. */
async function hydrateTemplates(templates: FbTemplate[]): Promise<FbTemplate[]> {
  if (templates.length === 0) return [];

  const ids = templates.map((t) => t.id);

  const [blocksRes, tagsRes] = await Promise.all([
    supabase
      .from("fb_template_blocks")
      .select("*")
      .in("template_id", ids)
      .order("sort_order"),
    supabase
      .from("fb_template_profile_tags")
      .select("*")
      .in("template_id", ids),
  ]);

  const blocksMap = new Map<string, FbTemplateBlock[]>();
  for (const b of (blocksRes.data ?? []) as FbTemplateBlock[]) {
    const arr = blocksMap.get(b.template_id) ?? [];
    arr.push(b);
    blocksMap.set(b.template_id, arr);
  }

  const tagsMap = new Map<string, string[]>();
  for (const t of (tagsRes.data ?? []) as FbTemplateProfileTag[]) {
    const arr = tagsMap.get(t.template_id) ?? [];
    arr.push(t.profile_id);
    tagsMap.set(t.template_id, arr);
  }

  return templates.map((t) => ({
    ...t,
    blocks: blocksMap.get(t.id) ?? [],
    profile_ids: tagsMap.get(t.id) ?? [],
  }));
}

export function useFbTemplates(category?: string) {
  return useQuery({
    queryKey: [...FB_TEMPLATES_KEY, category ?? "all"],
    queryFn: async (): Promise<FbTemplate[]> => {
      let query = supabase
        .from("fb_templates")
        .select("*")
        .order("device_category")
        .order("name");

      if (category) {
        query = query.eq("device_category", category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return hydrateTemplates(data as FbTemplate[]);
    },
  });
}

export function useFbTemplate(id: string | undefined) {
  return useQuery({
    queryKey: [...FB_TEMPLATES_KEY, id],
    queryFn: async (): Promise<FbTemplate> => {
      const { data, error } = await supabase
        .from("fb_templates")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const [hydrated] = await hydrateTemplates([data as FbTemplate]);
      return hydrated;
    },
    enabled: !!id,
  });
}

/**
 * Fetch templates available for a session: global templates (no profile tags)
 * + templates tagged to the given profile. Includes blocks.
 */
export function useFbTemplatesForSession(profileId?: string) {
  return useQuery({
    queryKey: [...FB_TEMPLATES_KEY, "session", profileId ?? "none"],
    queryFn: async (): Promise<FbTemplate[]> => {
      // Fetch all templates with their profile tags
      const { data: allTemplates, error } = await supabase
        .from("fb_templates")
        .select("*")
        .order("device_category")
        .order("name");
      if (error) throw error;

      const hydrated = await hydrateTemplates(allTemplates as FbTemplate[]);

      // Filter: enabled + (global or tagged to this profile)
      return hydrated.filter((t) => {
        if (!t.is_enabled) return false;
        const pids = t.profile_ids ?? [];
        if (pids.length === 0) return true; // global
        if (profileId && pids.includes(profileId)) return true;
        return false;
      });
    },
  });
}

export function useCreateFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: FbTemplateCreate) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { blocks, profile_ids, ...templateData } = input;

      // Insert parent
      const { data: template, error: tErr } = await supabase
        .from("fb_templates")
        .insert({ ...templateData, version: 1, created_by: user.id })
        .select()
        .single();
      if (tErr) throw tErr;

      const templateId = (template as FbTemplate).id;

      // Insert blocks
      if (blocks.length > 0) {
        const blockRows = blocks.map((b, i) => ({
          template_id: templateId,
          block_name: b.block_name,
          block_type: b.block_type,
          scl_code: b.scl_code,
          sort_order: b.sort_order ?? i,
        }));
        const { error: bErr } = await supabase
          .from("fb_template_blocks")
          .insert(blockRows);
        if (bErr) throw bErr;
      }

      // Insert profile tags
      if (profile_ids && profile_ids.length > 0) {
        const tagRows = profile_ids.map((pid) => ({
          template_id: templateId,
          profile_id: pid,
        }));
        const { error: pErr } = await supabase
          .from("fb_template_profile_tags")
          .insert(tagRows);
        if (pErr) throw pErr;
      }

      // Save version 1 snapshot
      const { error: vErr } = await supabase
        .from("fb_template_versions")
        .insert({
          template_id: templateId,
          version: 1,
          blocks: JSON.parse(JSON.stringify(blocks)),
          description: templateData.description,
          tags: templateData.tags,
          notes: "Initial version",
        });
      if (vErr) throw vErr;

      return template as FbTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

export function useUpdateFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: FbTemplateUpdate }) => {
      const { blocks, profile_ids, ...templateUpdates } = updates;

      // Fetch current version
      const { data: current, error: fetchErr } = await supabase
        .from("fb_templates")
        .select("version")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;

      const currentVersion = (current as { version: number }).version;
      const newVersion = currentVersion + 1;

      // Snapshot current blocks to version history
      const { data: currentBlocks } = await supabase
        .from("fb_template_blocks")
        .select("block_name, block_type, scl_code, sort_order")
        .eq("template_id", id)
        .order("sort_order");

      const { data: currentTemplate } = await supabase
        .from("fb_templates")
        .select("description, tags")
        .eq("id", id)
        .single();

      await supabase.from("fb_template_versions").insert({
        template_id: id,
        version: currentVersion,
        blocks: currentBlocks ?? [],
        description: (currentTemplate as { description: string | null } | null)?.description,
        tags: (currentTemplate as { tags: string[] } | null)?.tags ?? [],
        notes: null,
      });

      // Update parent
      const { data: template, error: tErr } = await supabase
        .from("fb_templates")
        .update({
          ...templateUpdates,
          version: newVersion,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (tErr) throw tErr;

      // Replace blocks if provided
      if (blocks) {
        await supabase.from("fb_template_blocks").delete().eq("template_id", id);

        if (blocks.length > 0) {
          const blockRows = blocks.map((b, i) => ({
            template_id: id,
            block_name: b.block_name,
            block_type: b.block_type,
            scl_code: b.scl_code,
            sort_order: b.sort_order ?? i,
          }));
          const { error: bErr } = await supabase
            .from("fb_template_blocks")
            .insert(blockRows);
          if (bErr) throw bErr;
        }
      }

      // Replace profile tags if provided
      if (profile_ids !== undefined) {
        await supabase.from("fb_template_profile_tags").delete().eq("template_id", id);

        if (profile_ids.length > 0) {
          const tagRows = profile_ids.map((pid) => ({
            template_id: id,
            profile_id: pid,
          }));
          const { error: pErr } = await supabase
            .from("fb_template_profile_tags")
            .insert(tagRows);
          if (pErr) throw pErr;
        }
      }

      return template as FbTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

export function useDeleteFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("fb_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

/** Enable or disable all templates belonging to a given library_name in one shot. */
export function useSetLibraryEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ libraryName, enabled }: { libraryName: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("fb_templates")
        .update({ is_enabled: enabled })
        .eq("library_name", libraryName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

/** Enable or disable a single template. */
export function useSetTemplateEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("fb_templates")
        .update({ is_enabled: enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

export function useFbTemplateHistory(templateId: string | undefined) {
  return useQuery({
    queryKey: [...FB_TEMPLATES_KEY, "history", templateId],
    queryFn: async (): Promise<FbTemplateVersion[]> => {
      const { data, error } = await supabase
        .from("fb_template_versions")
        .select("*")
        .eq("template_id", templateId!)
        .order("version", { ascending: false });
      if (error) throw error;
      return data as FbTemplateVersion[];
    },
    enabled: !!templateId,
  });
}

export function useRevertFbTemplateVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, version }: { templateId: string; version: number }) => {
      // Fetch the version snapshot
      const { data: snapshot, error: vErr } = await supabase
        .from("fb_template_versions")
        .select("*")
        .eq("template_id", templateId)
        .eq("version", version)
        .single();
      if (vErr) throw vErr;

      const versionData = snapshot as FbTemplateVersion;

      // Snapshot current as new version before reverting
      const { data: current } = await supabase
        .from("fb_templates")
        .select("version, description, tags")
        .eq("id", templateId)
        .single();

      const currentVersion = (current as { version: number }).version;
      const revertVersion = currentVersion + 1;

      const { data: currentBlocks } = await supabase
        .from("fb_template_blocks")
        .select("block_name, block_type, scl_code, sort_order")
        .eq("template_id", templateId)
        .order("sort_order");

      await supabase.from("fb_template_versions").insert({
        template_id: templateId,
        version: currentVersion,
        blocks: currentBlocks ?? [],
        description: (current as { description: string | null } | null)?.description,
        tags: (current as { tags: string[] } | null)?.tags ?? [],
        notes: `Before revert to v${version}`,
      });

      // Replace blocks
      await supabase.from("fb_template_blocks").delete().eq("template_id", templateId);

      if (versionData.blocks.length > 0) {
        const blockRows = versionData.blocks.map((b, i) => ({
          template_id: templateId,
          block_name: b.block_name,
          block_type: b.block_type,
          scl_code: b.scl_code,
          sort_order: b.sort_order ?? i,
        }));
        const { error: bErr } = await supabase
          .from("fb_template_blocks")
          .insert(blockRows);
        if (bErr) throw bErr;
      }

      // Update parent
      const { error: tErr } = await supabase
        .from("fb_templates")
        .update({
          version: revertVersion,
          description: versionData.description,
          tags: versionData.tags,
          updated_at: new Date().toISOString(),
        })
        .eq("id", templateId);
      if (tErr) throw tErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}
