Add a new "Q&A Review" step to the forge wizard between Spec Upload and Project Setup. The PM agent reviews the spec analysis, identifies gaps, and asks the engineer clarifying questions.

## 1. Update step definitions

In src/types/forge.ts, add the new step:

FORGE_STEPS — add QA_REVIEW: "qa_review" between SPEC_UPLOAD and PROJECT_SETUP

FORGE_STEP_ORDER — update to: spec_upload, qa_review, project_setup, hardware_io, device_code, process_code, hmi, tia_export

FORGE_STEP_LABELS — add: qa_review: "Q&A Review"

On ForgeSession, add:
  qa_messages: QaMessage[];

interface QaMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: string;
}

## 2. Update forge store

In src/stores/forge-store.ts, update createInitialStepStatuses to include qa_review: "pending"

## 3. New prompt builder

In src/lib/forge-prompts.ts, add:

export function buildQaReviewPrompt(): string

This prompt tells the PM agent to:
- Review the spec analysis JSON provided
- Identify what information is MISSING or UNCLEAR
- Ask specific, targeted questions grouped by category
- Categories to check: PLC/hardware (CPU type, safety PLC needed?), IO (are all devices accounted for? any missing signals?), process sequences (any ambiguous steps? missing completion criteria?), safety (E-stop handling? safety interlocks?), HMI (panel type? screen requirements?), alarms (severity classifications complete?)
- Format questions as a numbered list, max 5-8 questions per round
- If the analysis looks complete, say so and recommend proceeding
- After the engineer answers, update the analysis with new information and ask follow-up questions if needed
- When all gaps are filled, output a final UPDATED spec analysis JSON block wrapped in ```json fences

export function buildQaFollowUpPrompt(): string

This prompt is for follow-up rounds — receives the conversation history and asks for any remaining gaps.

export function buildQaUpdateAnalysisPrompt(): string  

This prompt takes the original spec analysis + all Q&A answers and produces an updated SpecAnalysis JSON with the gaps filled in.

## 4. New hook

Create src/hooks/use-forge-qa-review.ts:

export function useForgeQaReview() {
  // Chat-style interaction with the PM agent
  // sendMessage(userMessage: string) => Promise<string> — sends user answer, gets next question
  // startReview(analysis: SpecAnalysis) => Promise<string> — kicks off the review, returns first batch of questions
  // finalizeAnalysis(messages: QaMessage[], originalAnalysis: SpecAnalysis) => Promise<SpecAnalysis> — produces updated analysis
  // messages: QaMessage[] — conversation history
  // loading: boolean
  // error: string | null
  // isComplete: boolean — PM has indicated all gaps are filled
}

Use callNonStreaming from use-generation.ts. Send the full conversation history each time so the PM has context. Max tokens: 4096 per response.

## 5. New component

Create src/components/forge/steps/forge-qa-review.tsx:

Layout:
- Left panel (40%): Spec analysis summary card (same compact view as spec upload step — project name, PLC type, device count, sequence count, alarm count). Highlight missing fields in amber/red.
- Right panel (60%): Chat-style Q&A interface
  - Message list (ScrollArea): PM questions and engineer answers
  - Input area at bottom: text input + send button
  - PM messages styled differently from user messages (use agent avatar/color for PM)
  - When PM says analysis is complete, show a "Confirm & Continue" button
  - Also show a "Skip Q&A" button for engineers who want to fill gaps manually later

Props:
interface ForgeQaReviewProps {
  specAnalysis: SpecAnalysis;
  onComplete: (updatedAnalysis: SpecAnalysis, messages: QaMessage[]) => void;
  onSkip: () => void;
}

## 6. Wire into route

In src/routes/forge.tsx:
- Import ForgeQaReview
- Add case "qa_review" to renderStep() switch
- Add handler handleQaComplete that saves updated analysis and messages to session
- When spec upload completes, advance to qa_review (not project_setup)
- When qa_review completes, advance to project_setup
- If spec upload is skipped (start from scratch), also skip qa_review

## 7. Update migration

In supabase/migrations/025_forge_sessions.sql (or create 027), add:
  qa_messages jsonb DEFAULT '[]'

## Important notes

- The Q&A should feel conversational, not like a form. The PM asks questions naturally.
- The PM should reference specific parts of the spec analysis ("I see you have 12 devices listed, but none have IO signal types specified — can you confirm...")
- If the engineer uploaded a spec and the analysis is comprehensive, the PM should acknowledge that and only ask about genuine gaps
- If starting from scratch (no spec), skip this step entirely
- Keep the Q&A focused — max 2-3 rounds of questions before allowing the engineer to proceed

Commit with: "forge-ui: add Q&A review step with PM agent gap analysis"
