/**
 * A customer-spec section captured from an ingested `.docx`.
 *
 * Sections are bound to an equipment module at ingest time (register-aware
 * mapping) and fetched by `equipment_module_id` in the co-author, so there is
 * no longer any name-based selection at prompt time.
 */
export interface SourceSection {
  heading: string;
  body: string;
  order_index: number;
}
