import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { useSpecContract } from "@/hooks/use-spec-contract";
import { useMigrationDraft } from "@/hooks/use-migration-draft";
import { useMigrationProposal } from "@/hooks/use-migration-proposal";
import { useConfirmMigration } from "@/hooks/use-confirm-migration";
import { MigrateModesTab } from "@/components/spec-builder/migrate/migrate-modes-tab";
import { MigrateStatesTab } from "@/components/spec-builder/migrate/migrate-states-tab";
import { MigrateInterlocksTab } from "@/components/spec-builder/migrate/migrate-interlocks-tab";
import { MigrateConfirmBar } from "@/components/spec-builder/migrate/migrate-confirm-bar";
import type { OperatorMode } from "@/types/spec-contract-v2";
import type {
  MigrationDraft,
  ProposedInterlock,
  ProposedStateMapping,
} from "@/lib/spec-builder/migrate/types";

export default function SpecMigratePage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const navigate = useNavigate();

  const { data: contract, isLoading: contractLoading, isError: contractError } = useSpecContract(specId!);
  const { draft, isLoading: draftLoading, saveDraft } = useMigrationDraft(specId!);

  // Recompute the proposal only when there's no draft yet.
  const needsProposal = !draft && !!contract;
  const proposalQuery = useMigrationProposal(specId!, contract, needsProposal);

  // Tab-complete flags reported up from each tab.
  const [modesComplete, setModesComplete] = useState(false);
  const [statesComplete, setStatesComplete] = useState(false);
  const [interlocksComplete, setInterlocksComplete] = useState(false);

  // Hydrate the draft from the proposal once it's ready.
  useEffect(() => {
    if (draft || !proposalQuery.data) return;
    saveDraft({
      modes: { rows: proposalQuery.data.modes.modes, tabComplete: true },
      states: { rows: proposalQuery.data.states, tabComplete: false },
      interlocks: {
        rows: proposalQuery.data.interlocks,
        classifiedAt: new Date().toISOString(),
        tabComplete: false,
      },
    });
  }, [draft, proposalQuery.data, saveDraft]);

  const { confirm, isPending: confirmPending, error: confirmError } = useConfirmMigration(specId!);

  if (contractLoading || draftLoading || (needsProposal && proposalQuery.isLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (contractError) {
    return <Card className="m-4 p-4 text-red-900 bg-red-50">Failed to load spec contract.</Card>;
  }

  if (!contract) return null;

  // Redirect if already confirmed (race / direct nav).
  if (contract.confirmation_status === "confirmed") {
    return <Navigate to={`/specs/${projectId}/${specId}/editor`} replace />;
  }

  // Need a non-null draft to render the tabs.
  if (!draft || !draft.modes || !draft.states || !draft.interlocks) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canConfirm = modesComplete && statesComplete && interlocksComplete;
  const errorMessages = confirmError
    ? [confirmError instanceof Error ? confirmError.message : String(confirmError)]
    : [];

  function onConfirm() {
    if (!contract || !draft) return;
    confirm({ contract, draft }).then(() => navigate(`/specs/${projectId}/${specId}/editor`));
  }

  function onChangeModes(next: OperatorMode[]) {
    saveDraft({ modes: { rows: next, tabComplete: modesComplete } });
  }

  function onChangeStates(next: ProposedStateMapping[]) {
    saveDraft({ states: { rows: next, tabComplete: statesComplete } });
  }

  function onChangeInterlocks(next: ProposedInterlock[]) {
    saveDraft({
      interlocks: {
        rows: next,
        classifiedAt: draft!.interlocks!.classifiedAt,
        tabComplete: interlocksComplete,
      },
    });
  }

  function onReclassify() {
    // Drop the cached classified rows so useMigrationProposal re-runs on next mount.
    // For now: clear the draft's interlocks slice; the user will see a spinner
    // while it re-computes via useMigrationProposal.
    saveDraft({
      interlocks: undefined as never, // forces re-proposal
    } as Partial<MigrationDraft>);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b">
        <h1 className="text-lg font-semibold">Migrate to V2 — {contract.project.title}</h1>
        <p className="text-sm text-muted-foreground">
          Review modes, state vocabulary, and inter-assembly interlocks. Confirm at the bottom to
          unlock editing on every spec-builder route.
        </p>
      </header>

      <Tabs defaultValue="modes" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="modes">
            1. Modes {modesComplete && "✓"}
          </TabsTrigger>
          <TabsTrigger value="states">
            2. State vocabulary {statesComplete && "✓"}
          </TabsTrigger>
          <TabsTrigger value="interlocks">
            3. Interlock structure {interlocksComplete && "✓"}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto p-4">
          <TabsContent value="modes">
            <MigrateModesTab
              proposal={proposalQuery.data?.modes ?? { modes: draft.modes.rows, hints: [] }}
              value={draft.modes.rows}
              onChange={onChangeModes}
              onTabComplete={setModesComplete}
            />
          </TabsContent>
          <TabsContent value="states">
            <MigrateStatesTab
              proposal={draft.states.rows}
              value={draft.states.rows}
              onChange={onChangeStates}
              onTabComplete={setStatesComplete}
            />
          </TabsContent>
          <TabsContent value="interlocks">
            <MigrateInterlocksTab
              rows={draft.interlocks.rows}
              onChange={onChangeInterlocks}
              onTabComplete={setInterlocksComplete}
              onReclassify={onReclassify}
            />
          </TabsContent>
        </div>
      </Tabs>

      <MigrateConfirmBar
        canConfirm={canConfirm}
        isPending={confirmPending}
        errorMessages={errorMessages}
        onConfirm={onConfirm}
      />
    </div>
  );
}
