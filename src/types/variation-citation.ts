export const CITATION_TARGET_SECTIONS = [
  "scope",
  "inclusion",
  "exclusion",
  "assumption",
  "line_item",
] as const;
export type CitationTargetSection = (typeof CITATION_TARGET_SECTIONS)[number];

export type CitationSourceKind = "quote_revision" | "variation";

export interface VariationCitation {
  id: string;
  variation_id: string;
  target_section: CitationTargetSection;
  target_doc_id: string;
  source_kind: CitationSourceKind;
  source_id: string;
  source_section: CitationTargetSection;
  source_item_id: string | null;
  original_text_verbatim: string | null;
  created_at: string;
}

export type VariationCitationCreate = Pick<
  VariationCitation,
  | "variation_id"
  | "target_section"
  | "target_doc_id"
  | "source_kind"
  | "source_id"
  | "source_section"
  | "source_item_id"
  | "original_text_verbatim"
>;
