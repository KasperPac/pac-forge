// @deprecated — removed by Wave 5. Manual spec upload is no longer supported;
// forge requires an approved revision bound via forge_sessions.spec_revision_id.
// This file is retained as a stub so stale imports fail loudly at call-site.

import type { SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface ForgeSpecUploadProps {
  onComplete?: (analysis: SpecAnalysis) => void;
  onSkip?: () => void;
  fbTemplates?: FbTemplate[];
}

export function ForgeSpecUpload(_props: ForgeSpecUploadProps) { // eslint-disable-line @typescript-eslint/no-unused-vars
  throw new Error(
    "ForgeSpecUpload has been removed. Forge now requires an approved spec revision — open the Spec Builder instead.",
  );
}

export default ForgeSpecUpload;
