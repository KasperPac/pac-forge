import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { CitationPickerDialog } from "@/components/quotes/builder/citation-picker-dialog";

const insertMock = vi.fn();

const tables: Record<string, () => unknown> = {
  projects: () => ({
    select: () => ({
      eq: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "p-1", awarded_quote_id: "r-1" },
            error: null,
          }),
      }),
    }),
  }),
  quote_revisions: () => ({
    select: () => ({
      eq: () =>
        Promise.resolve({
          data: [{ id: "r-1", quote_id: "q-1", rev_number: 1, status: "issued" }],
          error: null,
        }),
    }),
  }),
  quotes: () => ({
    select: () => ({
      in: () =>
        Promise.resolve({
          data: [{ id: "q-1", project_id: "p-1", number: "CVL-2129-Q01" }],
          error: null,
        }),
    }),
  }),
  variations: () => ({
    select: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
  doc_scope_items: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: "s-src-1",
                  title: "Original cabinet build",
                  body: null,
                  ordering: 0,
                },
              ],
              error: null,
            }),
        }),
      }),
    }),
  }),
  variation_citations: () => ({
    insert: (row: Record<string, unknown>) => {
      insertMock(row);
      return {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: "vc-new",
                created_at: "2026-05-18T00:00:00Z",
                ...row,
              },
              error: null,
            }),
        }),
      };
    },
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (n: string) => {
      const h = tables[n];
      if (!h) throw new Error(`unhandled table: ${n}`);
      return h();
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  insertMock.mockClear();
});

describe("CitationPickerDialog", () => {
  it("after picking source + item and confirming, inserts the right citation payload", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(
      <CitationPickerDialog
        open
        onOpenChange={() => {}}
        variationId="v-1"
        projectId="p-1"
        targetSection="scope"
        targetDocId="s-target"
        onCreated={onCreated}
      />,
      { wrapper },
    );

    expect(await screen.findByText(/CVL-2129-Q01 Rev 1/)).toBeInTheDocument();
    const item = await screen.findByRole("button", {
      name: /Original cabinet build/,
    });
    await act(async () => {
      await user.click(item);
    });
    const confirm = screen.getByRole("button", { name: /confirm/i });
    await act(async () => {
      await user.click(confirm);
    });

    expect(insertMock).toHaveBeenCalledOnce();
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      variation_id: "v-1",
      target_section: "scope",
      target_doc_id: "s-target",
      source_kind: "quote_revision",
      source_id: "r-1",
      source_section: "scope",
      source_item_id: "s-src-1",
      original_text_verbatim: "Original cabinet build",
    });
    expect(onCreated).toHaveBeenCalled();
  });
});
