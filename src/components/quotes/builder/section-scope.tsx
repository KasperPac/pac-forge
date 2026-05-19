import { scopeItems } from "@/hooks/use-doc-content";
import { ScopeLikeEditor } from "./_scope-like-editor";

export function SectionScope() {
  return (
    <ScopeLikeEditor
      crud={scopeItems}
      title="Scope of Work"
      description="What's in this quote — listed top-to-bottom."
      emptyHint="No scope items yet. Add what you're delivering."
      addLabel="Add scope item"
      defaultTitle="New scope item"
      targetSection="scope"
    />
  );
}
