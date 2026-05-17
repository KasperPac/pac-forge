import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { SectionTnc } from "@/components/quotes/builder/section-tnc";

const TEMPLATE_ID = "tpl-1";
const CLAUSE_ID = "clause-1";

const upsertSelectionMock = vi.fn();
const upsertOverrideMock = vi.fn();
const deleteOverrideMock = vi.fn();

let selectionRow: Record<string, unknown> | null = null;

const tables = {
  tnc_templates: () => ({
    select: () => ({
      order: () =>
        Promise.resolve({
          data: [
            {
              id: TEMPLATE_ID,
              name: "Pac Standard",
              version: 1,
              status: "active",
              is_default: true,
            },
          ],
          error: null,
        }),
    }),
    eq: () => ({
      single: () =>
        Promise.resolve({
          data: {
            id: TEMPLATE_ID,
            name: "Pac Standard",
            version: 1,
            status: "active",
            is_default: true,
          },
          error: null,
        }),
    }),
  }),
  tnc_clauses: () => ({
    select: () => ({
      eq: () => ({
        order: () =>
          Promise.resolve({
            data: [
              {
                id: CLAUSE_ID,
                template_id: TEMPLATE_ID,
                clause_number: "1",
                title: "Validity",
                body_markdown: "Valid for 30 days.",
                ordering: 0,
              },
              {
                id: "clause-2",
                template_id: TEMPLATE_ID,
                clause_number: "2",
                title: "Payment",
                body_markdown: "30 days from invoice.",
                ordering: 1,
              },
            ],
            error: null,
          }),
      }),
    }),
  }),
  doc_tnc_selections: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: selectionRow, error: null }),
        }),
      }),
    }),
    upsert: (row: Record<string, unknown>) => {
      upsertSelectionMock(row);
      const next = { id: "sel-1", ...row };
      selectionRow = next;
      return {
        select: () => ({
          single: () => Promise.resolve({ data: next, error: null }),
        }),
      };
    },
  }),
  doc_tnc_override: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    upsert: (row: Record<string, unknown>) => {
      upsertOverrideMock(row);
      return {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: "ovr-1", ...row },
              error: null,
            }),
        }),
      };
    },
    delete: () => ({
      eq: () => ({
        eq: () => {
          deleteOverrideMock();
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (name: string) => {
      const h = (tables as Record<string, () => unknown>)[name];
      if (!h) throw new Error(`unhandled table: ${name}`);
      return h();
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/quotes/rev-1/edit"]}>
        <Routes>
          <Route path="/quotes/:revId/edit" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  upsertSelectionMock.mockClear();
  upsertOverrideMock.mockClear();
  deleteOverrideMock.mockClear();
  selectionRow = null;
});

describe("SectionTnc", () => {
  it("renders active templates as radios with the default pre-selected", async () => {
    render(<SectionTnc />, { wrapper });
    expect(
      await screen.findByRole("radio", { name: /Pac Standard/ }),
    ).toBeChecked();
    expect(screen.getByText(/default/i)).toBeInTheDocument();
  });

  it("renders the template's clauses kept by default", async () => {
    render(<SectionTnc />, { wrapper });
    expect(await screen.findByText("Validity")).toBeInTheDocument();
    expect(screen.getByText("Payment")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Include clause 1/ }),
    ).toBeChecked();
  });

  it("clicking omit on a clause persists the clause id to omitted_clause_ids", async () => {
    const user = userEvent.setup();
    render(<SectionTnc />, { wrapper });

    const cb = await screen.findByRole("checkbox", {
      name: /Include clause 1/,
    });
    await act(async () => {
      await user.click(cb);
    });

    expect(upsertSelectionMock).toHaveBeenCalled();
    const last = upsertSelectionMock.mock.calls.at(-1)![0] as {
      omitted_clause_ids: string[];
      template_id: string | null;
    };
    expect(last.template_id).toBe(TEMPLATE_ID);
    expect(last.omitted_clause_ids).toContain(CLAUSE_ID);
  });

  it("Add custom clause appends an empty draft", async () => {
    const user = userEvent.setup();
    render(<SectionTnc />, { wrapper });

    const btn = await screen.findByRole("button", { name: /add custom clause/i });
    await act(async () => {
      await user.click(btn);
    });

    expect(upsertSelectionMock).toHaveBeenCalled();
    const last = upsertSelectionMock.mock.calls.at(-1)![0] as {
      added_custom_clauses: { title: string }[];
    };
    expect(last.added_custom_clauses).toHaveLength(1);
    expect(last.added_custom_clauses[0].title).toBe("New custom clause");
  });

  it("Override mode hides the template picker and saves the override body on blur", async () => {
    const user = userEvent.setup();
    render(<SectionTnc />, { wrapper });

    const toggle = await screen.findByRole("checkbox", {
      name: /override entire t&cs/i,
    });
    await act(async () => {
      await user.click(toggle);
    });

    // Template-picker label should be hidden now.
    expect(screen.queryByText(/^Template$/)).toBeNull();

    const textarea = await screen.findByLabelText(/override body markdown/i);
    await act(async () => {
      await user.type(textarea, "Custom terms apply.");
      textarea.blur();
    });

    expect(upsertOverrideMock).toHaveBeenCalled();
    const last = upsertOverrideMock.mock.calls.at(-1)![0] as {
      body_markdown: string;
    };
    expect(last.body_markdown).toBe("Custom terms apply.");
  });
});
