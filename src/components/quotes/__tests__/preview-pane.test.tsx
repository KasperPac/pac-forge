import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PreviewPane } from "@/components/quotes/preview-pane";

vi.mock("@/hooks/use-generation", () => ({
  getAuthToken: vi.fn(() => Promise.resolve("test-token")),
  invalidateAuthToken: vi.fn(),
}));

const FAKE_BLOB_URL = "blob:test/00000000";

const createObjectURLMock = vi.fn(() => FAKE_BLOB_URL);
const revokeObjectURLMock = vi.fn();

const originalCreateObjectURL = (
  URL as unknown as { createObjectURL?: (b: Blob) => string }
).createObjectURL;
const originalRevokeObjectURL = (
  URL as unknown as { revokeObjectURL?: (u: string) => void }
).revokeObjectURL;

beforeEach(() => {
  vi.useFakeTimers();
  (URL as unknown as { createObjectURL: typeof createObjectURLMock }).createObjectURL =
    createObjectURLMock;
  (URL as unknown as { revokeObjectURL: typeof revokeObjectURLMock }).revokeObjectURL =
    revokeObjectURLMock;
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");

  globalThis.fetch = vi.fn(async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  }) as unknown as typeof fetch;

  createObjectURLMock.mockClear();
  revokeObjectURLMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (originalCreateObjectURL) {
    (URL as unknown as { createObjectURL: typeof originalCreateObjectURL }).createObjectURL =
      originalCreateObjectURL;
  }
  if (originalRevokeObjectURL) {
    (URL as unknown as { revokeObjectURL: typeof originalRevokeObjectURL }).revokeObjectURL =
      originalRevokeObjectURL;
  }
});

const sampleSnapshot = {
  schema_version: 1,
  quote_number: "CVL-2129-Q01",
  rev_number: 1,
};

describe("PreviewPane", () => {
  it("shows the empty state when snapshot is null", () => {
    render(<PreviewPane snapshot={null} />);
    expect(screen.getByText(/No content to preview yet/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Quote PDF preview")).toBeNull();
  });

  it("waits 800ms before fetching the preview", async () => {
    render(<PreviewPane snapshot={sampleSnapshot} />);

    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(799);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await vi.runAllTimersAsync();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("renders an iframe with the blob URL after a successful render", async () => {
    render(<PreviewPane snapshot={sampleSnapshot} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
      await vi.runAllTimersAsync();
    });

    const iframe = screen.getByTitle("Quote PDF preview");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", FAKE_BLOB_URL);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it("sends snapshot + dry_run:true with bearer auth to the edge function", async () => {
    render(<PreviewPane snapshot={sampleSnapshot} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
      await vi.runAllTimersAsync();
    });

    const [callUrl, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callUrl).toBe("https://supa.test/functions/v1/quote-render-pdf");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(init.body as string)).toEqual({
      snapshot: sampleSnapshot,
      dry_run: true,
    });
  });

  it("Refresh button forces a re-render without waiting for the debounce", async () => {
    render(<PreviewPane snapshot={sampleSnapshot} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
      await vi.runAllTimersAsync();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const refresh = screen.getByRole("button", { name: /refresh preview/i });

    await act(async () => {
      refresh.click();
      await vi.runAllTimersAsync();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("revokes the blob URL on unmount", async () => {
    const { unmount } = render(<PreviewPane snapshot={sampleSnapshot} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
      await vi.runAllTimersAsync();
    });
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    unmount();

    expect(revokeObjectURLMock).toHaveBeenCalledWith(FAKE_BLOB_URL);
  });

  it("surfaces an error message when the edge function fails", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("upstream went sideways", {
          status: 502,
          headers: { "content-type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    render(<PreviewPane snapshot={sampleSnapshot} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
      await vi.runAllTimersAsync();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /upstream went sideways/,
    );
    expect(screen.queryByTitle("Quote PDF preview")).toBeNull();
  });

  it("clears the preview when snapshot becomes null", async () => {
    const { rerender } = render(<PreviewPane snapshot={sampleSnapshot} />);

    await act(async () => {
      vi.advanceTimersByTime(800);
      await vi.runAllTimersAsync();
    });
    expect(screen.getByTitle("Quote PDF preview")).toBeInTheDocument();

    rerender(<PreviewPane snapshot={null} />);

    expect(screen.queryByTitle("Quote PDF preview")).toBeNull();
    expect(screen.getByText(/No content to preview yet/i)).toBeInTheDocument();
    expect(revokeObjectURLMock).toHaveBeenCalledWith(FAKE_BLOB_URL);
  });
});
