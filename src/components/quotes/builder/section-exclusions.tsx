import { exclusions } from "@/hooks/use-doc-content";
import { ScopeLikeEditor } from "./_scope-like-editor";

export function SectionExclusions() {
  return (
    <ScopeLikeEditor
      crud={exclusions}
      title="Exclusions"
      description="Items explicitly outside the quoted price."
      emptyHint="No exclusions yet. Spell out what isn't covered."
      addLabel="Add exclusion"
      defaultTitle="New exclusion"
    />
  );
}
