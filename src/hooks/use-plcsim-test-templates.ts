import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  PlcsimTestTemplate,
  PlcsimTestTemplateCreate,
  PlcsimTestTemplateUpdate,
} from "@/types/plcsim-test-template";

const TEMPLATES_KEY = ["plcsim-test-templates"] as const;

// ---------------------------------------------------------------------------
// Hydration — attach profile_ids and fb_template_name
// ---------------------------------------------------------------------------

async function hydrateTemplates(
  templates: PlcsimTestTemplate[],
): Promise<PlcsimTestTemplate[]> {
  if (templates.length === 0) return [];

  const ids = templates.map((t) => t.id);
  const fbIds = templates
    .map((t) => t.fb_template_id)
    .filter((id): id is string => id != null);

  const [tagsRes, fbRes] = await Promise.all([
    supabase
      .from("plcsim_test_template_profile_tags")
      .select("*")
      .in("template_id", ids),
    fbIds.length > 0
      ? supabase
          .from("fb_templates")
          .select("id, name")
          .in("id", fbIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profileMap = new Map<string, string[]>();
  for (const tag of tagsRes.data ?? []) {
    const arr = profileMap.get(tag.template_id) ?? [];
    arr.push(tag.profile_id);
    profileMap.set(tag.template_id, arr);
  }

  const fbNameMap = new Map<string, string>();
  for (const fb of (fbRes.data ?? []) as Array<{ id: string; name: string }>) {
    fbNameMap.set(fb.id, fb.name);
  }

  return templates.map((t) => ({
    ...t,
    profile_ids: profileMap.get(t.id) ?? [],
    fb_template_name: t.fb_template_id
      ? fbNameMap.get(t.fb_template_id) ?? null
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function usePlcsimTestTemplates() {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plcsim_test_templates")
        .select("*")
        .order("device_category")
        .order("name");
      if (error) throw error;
      return hydrateTemplates(data as PlcsimTestTemplate[]);
    },
  });
}

export function usePlcsimTestTemplate(id: string | null) {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plcsim_test_templates")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const [hydrated] = await hydrateTemplates([data as PlcsimTestTemplate]);
      return hydrated;
    },
  });
}

/** Fetch templates scoped to a session's design profile. */
export function usePlcsimTestTemplatesForSession(profileId?: string | null) {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, "session", profileId ?? "none"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plcsim_test_templates")
        .select("*")
        .eq("is_enabled", true)
        .order("device_category")
        .order("name");
      if (error) throw error;
      const hydrated = await hydrateTemplates(data as PlcsimTestTemplate[]);
      // Filter by profile scope: global (no profile tags) OR matching profile
      return hydrated.filter(
        (t) =>
          !t.profile_ids?.length ||
          (profileId && t.profile_ids.includes(profileId)),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreatePlcsimTestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlcsimTestTemplateCreate) => {
      const { profile_ids, ...row } = input;
      const { data, error } = await supabase
        .from("plcsim_test_templates")
        .insert(row)
        .select()
        .single();
      if (error) throw error;

      if (profile_ids?.length) {
        const tags = profile_ids.map((pid) => ({
          template_id: data.id,
          profile_id: pid,
        }));
        const { error: tagErr } = await supabase
          .from("plcsim_test_template_profile_tags")
          .insert(tags);
        if (tagErr) throw tagErr;
      }

      return data as PlcsimTestTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function useUpdatePlcsimTestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      update,
    }: {
      id: string;
      update: PlcsimTestTemplateUpdate;
    }) => {
      const { profile_ids, ...fields } = update;

      if (Object.keys(fields).length > 0) {
        const { error } = await supabase
          .from("plcsim_test_templates")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }

      if (profile_ids !== undefined) {
        // Replace profile tags
        await supabase
          .from("plcsim_test_template_profile_tags")
          .delete()
          .eq("template_id", id);
        if (profile_ids.length > 0) {
          const tags = profile_ids.map((pid) => ({
            template_id: id,
            profile_id: pid,
          }));
          const { error: tagErr } = await supabase
            .from("plcsim_test_template_profile_tags")
            .insert(tags);
          if (tagErr) throw tagErr;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function useDeletePlcsimTestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("plcsim_test_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}
