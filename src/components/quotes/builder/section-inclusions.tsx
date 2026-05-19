import { inclusions } from "@/hooks/use-doc-content";
import { ScopeLikeEditor } from "./_scope-like-editor";

export function SectionInclusions() {
  return (
    <ScopeLikeEditor
      crud={inclusions}
      title="Inclusions"
      description="Items explicitly inside the quoted price."
      emptyHint="No inclusions yet. Add what is explicitly included."
      addLabel="Add inclusion"
      defaultTitle="New inclusion"
      targetSection="inclusion"
    />
  );
}
