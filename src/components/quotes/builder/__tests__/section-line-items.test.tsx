import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { SectionLineItems } from "@/components/quotes/builder/section-line-items";

const insertMock = vi.fn();
const updateEqMock = vi.fn();
const deleteEqMock = vi.fn();

let listResult: Array<Record<string, unknown>> = [];

const tableHandlers = {
  doc_line_items: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: listResult, error: null }),
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      insertMock(row);
      return {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: "new-row", ...row, ordering: row.ordering ?? 0 },
              error: null,
            }),
        }),
      };
    },
    update: (updates: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => {
        updateEqMock({ col, val, updates });
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: val, ...updates },
                error: null,
              }),
          }),
        };
      },
    }),
    delete: () => ({
      eq: (col: string, val: unknown) => {
        deleteEqMock({ col, val });
        return Promise.resolve({ error: null });
      },
    }),
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (name: string) => {
      const h = (tableHandlers as Record<string, () => unknown>)[name];
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
  insertMock.mockClear();
  updateEqMock.mockClear();
  deleteEqMock.mockClear();
  listResult = [];
});

describe("SectionLineItems", () => {
  it("renders empty state when no rows", async () => {
    render(<SectionLineItems />, { wrapper });
    expect(
      await screen.findByText(/No line items yet\./i),
    ).toBeInTheDocument();
  });

  it("clicking + adds a row with category=labour and default fields", async () => {
    const user = userEvent.setup();
    render(<SectionLineItems />, { wrapper });

    const add = await screen.findByTestId("add-line-item");
    await act(async () => {
      await user.click(add);
    });

    expect(insertMock).toHaveBeenCalledOnce();
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      parent_type: "quote_revision",
      parent_id: "rev-1",
      category: "labour",
      description: "New line",
      hour_rate_multiplier: "1",
      show_in_customer_doc: true,
      ordering: 0,
    });
  });

  it("renders a row and computes subtotal from qty × unit_price", async () => {
    listResult = [
      {
        id: "row-1",
        parent_type: "quote_revision",
        parent_id: "rev-1",
        category: "hardware_materials",
        description: "Cabinet",
        qty: "2",
        unit: "ea",
        unit_price: "600",
        hours: null,
        hour_rate: null,
        hour_rate_multiplier: "1",
        subtotal: null,
        show_in_customer_doc: true,
        customer_doc_label: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ];

    render(<SectionLineItems />, { wrapper });

    expect(await screen.findByTestId("line-subtotal-row-1")).toHaveTextContent(
      "$1,200.00",
    );
  });

  it("switching mode to Hours clears qty/unit/unit_price", async () => {
    listResult = [
      {
        id: "row-1",
        parent_type: "quote_revision",
        parent_id: "rev-1",
        category: "labour",
        description: "Eng time",
        qty: "5",
        unit: "ea",
        unit_price: "100",
        hours: null,
        hour_rate: null,
        hour_rate_multiplier: "1",
        subtotal: null,
        show_in_customer_doc: true,
        customer_doc_label: null,
        ordering: 0,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      },
    ];

    const user = userEvent.setup();
    render(<SectionLineItems />, { wrapper });

    const hoursBtn = await screen.findByRole("button", { name: "Hours" });
    await act(async () => {
      await user.click(hoursBtn);
    });

    expect(updateEqMock).toHaveBeenCalled();
    const call = updateEqMock.mock.calls[0][0] as {
      col: string;
      val: unknown;
      updates: Record<string, unknown>;
    };
    expect(call.col).toBe("id");
    expect(call.val).toBe("row-1");
    expect(call.updates).toEqual({
      qty: null,
      unit: null,
      unit_price: null,
    });
  });
});
