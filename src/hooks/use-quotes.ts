import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Quote,
  QuoteCreate,
  QuoteRevision,
  QuoteRevisionUpdate,
} from "@/types";

const POLY_TABLES = [
  "doc_scope_items",
  "doc_inclusions",
  "doc_exclusions",
  "doc_assumptions",
  "doc_line_items",
] as const;

const META_KEYS = ["id", "created_at", "updated_at"] as const;

function stripMeta<T extends Record<string, unknown>>(
  row: T
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (!META_KEYS.includes(k as (typeof META_KEYS)[number])) {
      out[k] = row[k];
    }
  }
  return out;
}

export function useAllQuotes() {
  return useQuery({
    queryKey: ["quotes"],
    queryFn: async (): Promise<Quote[]> => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Quote[];
    },
  });
}

export function useQuotesForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ["quotes", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<Quote[]> => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("project_id", projectId!)
        .order("number");
      if (error) throw error;
      return data as Quote[];
    },
  });
}

export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: ["quotes", "by-id", id],
    enabled: !!id,
    queryFn: async (): Promise<Quote> => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Quote;
    },
  });
}

export function useQuoteRevisions(quoteId: string | undefined) {
  return useQuery({
    queryKey: ["quote-revisions", quoteId],
    enabled: !!quoteId,
    queryFn: async (): Promise<QuoteRevision[]> => {
      const { data, error } = await supabase
        .from("quote_revisions")
        .select("*")
        .eq("quote_id", quoteId!)
        .order("rev_number");
      if (error) throw error;
      return data as QuoteRevision[];
    },
  });
}

export function useQuoteRevision(id: string | undefined) {
  return useQuery({
    queryKey: ["quote-revisions", "by-id", id],
    enabled: !!id,
    queryFn: async (): Promise<QuoteRevision> => {
      const { data, error } = await supabase
        .from("quote_revisions")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as QuoteRevision;
    },
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: QuoteCreate) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: quote, error: qErr } = await supabase
        .from("quotes")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single();
      if (qErr) throw qErr;

      const { data: rev, error: rErr } = await supabase
        .from("quote_revisions")
        .insert({
          quote_id: (quote as Quote).id,
          rev_number: 1,
          status: "draft",
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (rErr) throw rErr;

      const { error: ctErr } = await supabase
        .from("doc_commercial_terms")
        .insert({
          parent_type: "quote_revision",
          parent_id: (rev as QuoteRevision).id,
        });
      if (ctErr) throw ctErr;

      return { quote: quote as Quote, rev: rev as QuoteRevision };
    },
    onSuccess: ({ quote }) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", quote.project_id] });
      queryClient.invalidateQueries({ queryKey: ["quote-revisions", quote.id] });
    },
  });
}

export function useUpdateQuoteRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: QuoteRevisionUpdate;
    }) => {
      const { data, error } = await supabase
        .from("quote_revisions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as QuoteRevision;
    },
    onSuccess: (rev) => {
      queryClient.invalidateQueries({
        queryKey: ["quote-revisions", rev.quote_id],
      });
      queryClient.setQueryData(["quote-revisions", "by-id", rev.id], rev);
    },
  });
}

export function useCloneRevisionAsDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (prevRevId: string): Promise<QuoteRevision> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: prevData, error: pErr } = await supabase
        .from("quote_revisions")
        .select("*")
        .eq("id", prevRevId)
        .single();
      if (pErr) throw pErr;
      const prev = prevData as QuoteRevision;
      if (prev.status !== "issued") {
        throw new Error("Can only clone from an issued revision");
      }

      const { data: newRevData, error: nErr } = await supabase
        .from("quote_revisions")
        .insert({
          quote_id: prev.quote_id,
          rev_number: prev.rev_number + 1,
          status: "draft",
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (nErr) throw nErr;
      const newRev = newRevData as QuoteRevision;

      for (const table of POLY_TABLES) {
        const { data: rows, error: sErr } = await supabase
          .from(table)
          .select("*")
          .eq("parent_type", "quote_revision")
          .eq("parent_id", prevRevId);
        if (sErr) throw sErr;
        if (rows && rows.length) {
          const insertRows = (rows as Record<string, unknown>[]).map((r) => ({
            ...stripMeta(r),
            parent_id: newRev.id,
          }));
          const { error: iErr } = await supabase.from(table).insert(insertRows);
          if (iErr) throw iErr;
        }
      }

      const { data: termsData } = await supabase
        .from("doc_commercial_terms")
        .select("*")
        .eq("parent_type", "quote_revision")
        .eq("parent_id", prevRevId)
        .maybeSingle();
      if (termsData) {
        await supabase.from("doc_commercial_terms").insert({
          ...stripMeta(termsData as Record<string, unknown>),
          parent_id: newRev.id,
        });
      }

      const { data: selData } = await supabase
        .from("doc_tnc_selections")
        .select("*")
        .eq("parent_type", "quote_revision")
        .eq("parent_id", prevRevId)
        .maybeSingle();
      if (selData) {
        await supabase.from("doc_tnc_selections").insert({
          ...stripMeta(selData as Record<string, unknown>),
          parent_id: newRev.id,
        });
      }

      const { data: ovrData } = await supabase
        .from("doc_tnc_override")
        .select("*")
        .eq("parent_type", "quote_revision")
        .eq("parent_id", prevRevId)
        .maybeSingle();
      if (ovrData) {
        await supabase.from("doc_tnc_override").insert({
          ...stripMeta(ovrData as Record<string, unknown>),
          parent_id: newRev.id,
        });
      }

      return newRev;
    },
    onSuccess: (rev) => {
      queryClient.invalidateQueries({
        queryKey: ["quote-revisions", rev.quote_id],
      });
    },
  });
}
