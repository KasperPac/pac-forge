import { describe, it, expect } from "vitest";
import {
  parseDocNumber,
  folderCodeFromName,
  isVendorFolderName,
  classifyDoc,
  nextSequence,
  buildDocNumber,
  suggestAssignName,
} from "@/lib/doc-control";

describe("folderCodeFromName", () => {
  it("reads leading digits", () => {
    expect(folderCodeFromName("51 DOC")).toBe("51");
    expect(folderCodeFromName("01 REFERENCE DOCS")).toBe("01");
    expect(folderCodeFromName("REFERENCE DOCS")).toBeNull();
  });
});

describe("isVendorFolderName", () => {
  it("matches vendor folders by name", () => {
    expect(isVendorFolderName("06 VENDOR MANUALS")).toBe(true);
    expect(isVendorFolderName("07 VENDOR REFERENCE DOCS")).toBe(true);
    expect(isVendorFolderName("01 REFERENCE DOCS")).toBe(false);
  });
});

describe("parseDocNumber", () => {
  it("parses a conforming Pac number", () => {
    const p = parseDocNumber("SRE-2601-5101001 1.0.xlsx");
    expect(p).toEqual({
      projectNumber: "SRE-2601",
      folderCode: "51",
      subfolderCode: "01",
      seq: "001",
      version: "1.0",
      isPlaceholder: false,
    });
  });

  it("parses a placeholder/wrong-folder number", () => {
    const p = parseDocNumber("XXX-17XX-5003001 - 1.0 PLC CHANGELOG.xlsx");
    expect(p?.projectNumber).toBe("XXX-17XX");
    expect(p?.folderCode).toBe("50");
    expect(p?.subfolderCode).toBe("03");
    expect(p?.isPlaceholder).toBe(true);
  });

  it("returns null for an un-numbered customer file", () => {
    expect(parseDocNumber("Herrenknecht - Segment Wagon.pdf")).toBeNull();
    expect(parseDocNumber("SRL-Segment-Wagon-IO-List-v2.csv")).toBeNull();
  });
});

describe("classifyDoc", () => {
  const base = {
    docFolderCode: "51",
    projectNumber: "SRE-2601",
    isVendorFolder: false,
    hasOverride: false,
  };

  it("conforming when all parts match", () => {
    const r = classifyDoc({ ...base, filename: "SRE-2601-5101001 1.0.xlsx", subfolderCode: "01" });
    expect(r.state).toBe("conforming");
    expect(r.reasons).toEqual([]);
  });

  it("non_conforming on placeholder + wrong folder code", () => {
    const r = classifyDoc({
      ...base,
      filename: "XXX-17XX-5003001 - 1.0 PLC CHANGELOG.xlsx",
      subfolderCode: "03",
    });
    expect(r.state).toBe("non_conforming");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.suggestedName).toContain("SRE-2601-5103");
  });

  it("non_conforming on malformed placeholder that does not parse", () => {
    const r = classifyDoc({ ...base, filename: "XXX-18XX-5110-XXX1801.docx", subfolderCode: "10" });
    expect(r.state).toBe("non_conforming");
  });

  it("needs_review for unnumbered file with no override", () => {
    const r = classifyDoc({ ...base, filename: "Herrenknecht - Segment Wagon.pdf", subfolderCode: "01" });
    expect(r.state).toBe("needs_review");
  });

  it("customer_supplied when unnumbered + override", () => {
    const r = classifyDoc({
      ...base,
      filename: "Herrenknecht - Segment Wagon.pdf",
      subfolderCode: "01",
      hasOverride: true,
    });
    expect(r.state).toBe("customer_supplied");
  });

  it("customer_supplied when unnumbered + vendor folder", () => {
    const r = classifyDoc({
      ...base,
      filename: "Some Vendor Manual.pdf",
      subfolderCode: "06",
      isVendorFolder: true,
    });
    expect(r.state).toBe("customer_supplied");
  });

  it("non_conforming when sub-folder code mismatches location", () => {
    const r = classifyDoc({ ...base, filename: "SRE-2601-5101001 1.0.xlsx", subfolderCode: "04" });
    expect(r.state).toBe("non_conforming");
    expect(r.reasons.join(" ")).toMatch(/sub-folder/i);
  });

  it("is generic across a different project shape", () => {
    const r = classifyDoc({
      filename: "PAC-2614-6002005 2.1.docx",
      docFolderCode: "60",
      subfolderCode: "02",
      projectNumber: "PAC-2614",
      isVendorFolder: false,
      hasOverride: false,
    });
    expect(r.state).toBe("conforming");
  });
});

describe("nextSequence", () => {
  it("returns max+1 zero-padded for the folder+subfolder", () => {
    const files = [
      "SRE-2601-5101001 1.0.xlsx",
      "SRE-2601-5101004 1.0.pdf",
      "SRE-2601-5104002 1.0.docx", // different subfolder, ignored
      "Herrenknecht.pdf", // unnumbered, ignored
    ];
    expect(nextSequence(files, "51", "01")).toBe("005");
  });

  it("starts at 001 when none exist", () => {
    expect(nextSequence([], "51", "01")).toBe("001");
  });
});

describe("buildDocNumber + suggestAssignName", () => {
  it("builds the canonical number with default version", () => {
    expect(
      buildDocNumber({ projectNumber: "SRE-2601", folderCode: "51", subfolderCode: "01", seq: "002" }),
    ).toBe("SRE-2601-5101002 1.0");
  });

  it("prefixes an adopted customer file, preserving its name + extension", () => {
    const name = suggestAssignName("Herrenknecht - Segment Wagon.pdf", {
      projectNumber: "SRE-2601",
      folderCode: "51",
      subfolderCode: "01",
      seq: "005",
    });
    expect(name).toBe("SRE-2601-5101005 1.0 - Herrenknecht - Segment Wagon.pdf");
  });
});
