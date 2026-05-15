export const PARENT_TYPES = ["quote_revision", "variation"] as const;
export type ParentType = (typeof PARENT_TYPES)[number];

export const LINE_ITEM_CATEGORIES = [
  "labour",
  "hardware_materials",
  "software_licences",
  "software_development",
  "commissioning",
  "travel_accom",
  "subcontract",
  "other",
] as const;
export type LineItemCategory = (typeof LINE_ITEM_CATEGORIES)[number];

export const LINE_ITEM_CATEGORY_LABELS: Record<LineItemCategory, string> = {
  labour: "Labour",
  hardware_materials: "Hardware & Materials",
  software_licences: "Software & Licences",
  software_development: "Software Development",
  commissioning: "Commissioning",
  travel_accom: "Travel & Accom",
  subcontract: "Subcontract",
  other: "Other",
};

interface PolymorphicChild {
  id: string;
  parent_type: ParentType;
  parent_id: string;
  ordering: number;
  created_at: string;
  updated_at: string;
}

export interface DocScopeItem extends PolymorphicChild {
  title: string;
  body: string | null;
}
export type DocInclusion = DocScopeItem;
export type DocExclusion = DocScopeItem;

export interface DocAssumption extends PolymorphicChild {
  assumption_key: string | null;
  title: string | null;
  value: string | null;
  notes: string | null;
}

export interface DocLineItem extends PolymorphicChild {
  category: LineItemCategory;
  description: string;
  qty: string | null;
  unit: string | null;
  unit_price: string | null;
  hours: string | null;
  hour_rate: string | null;
  hour_rate_multiplier: string;
  subtotal: string | null;
  show_in_customer_doc: boolean;
  customer_doc_label: string | null;
}

export interface DocCommercialTerms {
  id: string;
  parent_type: ParentType;
  parent_id: string;
  payment_schedule: string | null;
  validity: string | null;
  gst_treatment: string | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssumptionLibraryEntry {
  id: string;
  assumption_key: string;
  title: string;
  default_value: string | null;
  ordering: number;
  created_at: string;
  updated_at: string;
}

type ChildCreateBase = Pick<PolymorphicChild, "parent_type" | "parent_id"> & {
  ordering?: number;
};

export type DocScopeItemCreate = ChildCreateBase & Pick<DocScopeItem, "title"> & { body?: string | null };
export type DocInclusionCreate = DocScopeItemCreate;
export type DocExclusionCreate = DocScopeItemCreate;

export type DocAssumptionCreate = ChildCreateBase & {
  assumption_key?: string | null;
  title?: string | null;
  value?: string | null;
  notes?: string | null;
};

export type DocLineItemCreate = ChildCreateBase &
  Pick<DocLineItem, "category" | "description"> & {
    qty?: string | null;
    unit?: string | null;
    unit_price?: string | null;
    hours?: string | null;
    hour_rate?: string | null;
    hour_rate_multiplier?: string;
    subtotal?: string | null;
    show_in_customer_doc?: boolean;
    customer_doc_label?: string | null;
  };

export type DocCommercialTermsUpsert = Pick<
  DocCommercialTerms,
  "parent_type" | "parent_id"
> &
  Partial<
    Pick<
      DocCommercialTerms,
      "payment_schedule" | "validity" | "gst_treatment" | "currency" | "notes"
    >
  >;

export type AssumptionLibraryEntryCreate = Pick<AssumptionLibraryEntry, "assumption_key" | "title"> & {
  default_value?: string | null;
  ordering?: number;
};
export type AssumptionLibraryEntryUpdate = Partial<
  Pick<AssumptionLibraryEntry, "title" | "default_value" | "ordering">
>;
