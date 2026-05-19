import { createContext, useContext, type ReactNode } from "react";

export interface VariationBuilderContextValue {
  variationId: string;
  projectId: string;
}

const Ctx = createContext<VariationBuilderContextValue | null>(null);

export function VariationBuilderProvider({
  value,
  children,
}: {
  value: VariationBuilderContextValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVariationBuilderCtx() {
  return useContext(Ctx);
}
