import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildBundleZip } from "@/hooks/use-generate-dashboard";

describe("buildBundleZip", () => {
  it("packs the file map into a readable zip", async () => {
    const files = new Map([["a.txt", "hello"], ["b/c.js", "//x"]]);
    const blob = await buildBundleZip(files);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file("a.txt")!.async("string")).toBe("hello");
    expect(await zip.file("b/c.js")!.async("string")).toBe("//x");
  });
});
