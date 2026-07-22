// G6-7 — usePromoteFbTemplate persists a PromoteDerivation as a live library
// template: fb_templates row WITH the auto-derived interface_contract, blocks,
// and a v1 version snapshot — enabled immediately so codegen can match it.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const inserts: Array<{ table: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      insert: (payload: unknown) => {
        inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({ data: { id: "tpl-1", ...(payload as object) }, error: null }),
          }),
          // bare insert (blocks / versions) is awaited directly
          then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
        };
      },
    }),
  },
}));

import { usePromoteFbTemplate } from "../use-promote-fb-template";
import { deriveFbTemplate } from "@/lib/spec-builder/codegen/promote-template";

const derivation = deriveFbTemplate({
  grain: "cm",
  name: "P1 Pump",
  deviceCategory: "pump",
  blocks: [
    {
      artifact_name: "CM_P1_Pump",
      type: "FB",
      content:
        `FUNCTION_BLOCK "CM_P1_Pump"\n   VAR_INPUT\n      enable : Bool;\n      cmd_P1_Run : Bool;\n   END_VAR\n   VAR_OUTPUT\n      P1_Run : Bool;\n   END_VAR\nBEGIN\nEND_FUNCTION_BLOCK`,
    },
  ],
  generatedAt: "2026-07-22T00:00:00.000Z",
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  inserts.length = 0;
});

describe("usePromoteFbTemplate", () => {
  it("inserts the template with contract + blocks + v1 snapshot, enabled", async () => {
    const { result } = renderHook(() => usePromoteFbTemplate(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(derivation);
    });

    const tpl = inserts.find((i) => i.table === "fb_templates")!.payload as Record<string, unknown>;
    expect(tpl.name).toBe("P1 Pump");
    expect(tpl.source).toBe("custom");
    expect(tpl.is_equipment_module).toBe(false);
    expect(tpl.is_enabled).toBe(true);
    expect(tpl.version).toBe(1);
    expect(tpl.created_by).toBe("user-1");
    const contract = tpl.interface_contract as { pins: unknown[]; reviewed: boolean };
    expect(contract.pins.length).toBe(3);
    expect(contract.reviewed).toBe(true); // deterministic derivation is born reviewed

    const blocks = inserts.find((i) => i.table === "fb_template_blocks")!.payload as Array<
      Record<string, unknown>
    >;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      template_id: "tpl-1",
      block_name: "CM_P1_Pump",
      programming_language: "SCL",
    });

    const version = inserts.find((i) => i.table === "fb_template_versions")!.payload as Record<
      string,
      unknown
    >;
    expect(version.template_id).toBe("tpl-1");
    expect(version.version).toBe(1);
  });
});
