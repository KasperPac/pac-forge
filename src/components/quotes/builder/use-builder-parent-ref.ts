import { useParams } from "react-router";
import type { ParentRef } from "@/hooks/use-doc-content";
import { useVariationBuilderCtx } from "./variation-builder-context";

/**
 * Resolves the polymorphic parent ref for the active builder. When the
 * VariationBuilderContext is mounted we always emit a variation ref;
 * otherwise we fall back to the route param (revId for the quote builder,
 * or variationId for variation routes without the provider mounted).
 */
export function useBuilderParentRef(): ParentRef | null {
  const variation = useVariationBuilderCtx();
  const params = useParams<{ revId?: string; variationId?: string }>();
  if (variation) {
    return { parent_type: "variation", parent_id: variation.variationId };
  }
  if (params.variationId) {
    return { parent_type: "variation", parent_id: params.variationId };
  }
  if (params.revId) {
    return { parent_type: "quote_revision", parent_id: params.revId };
  }
  return null;
}
